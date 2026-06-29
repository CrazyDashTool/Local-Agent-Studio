const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { readSettings, saveSettings } = require("./backend/config.cjs");
const { checkProviders } = require("./backend/providers.cjs");
const { sendAgentMessage, sendAgentMessageStream } = require("./backend/llm.cjs");
const { searchWeb } = require("./backend/search.cjs");
const { queueComfyPrompt, getComfyHistory, getComfyImages, saveComfyImageToWorkspace } = require("./backend/comfy.cjs");
const { appendArtifact, listArtifacts, readArtifact, writeArtifact } = require("./backend/artifacts.cjs");
const { addImageHistoryJob, readImageHistory, updateImageHistoryImages } = require("./backend/imageHistory.cjs");
const { addMemory, clearMemory, deleteMemory, readMemory } = require("./backend/memory.cjs");
const { listMcpTools, callMcpTool } = require("./backend/mcp.cjs");
const { installPluginFromUrl, listPlugins, setPluginEnabled, setPluginInstalled } = require("./backend/pluginMarketplace.cjs");
const { checkForUpdates } = require("./backend/updates.cjs");
const { runCommand } = require("./backend/sandbox.cjs");
const { resolveSpawnCommand } = require("./backend/commands.cjs");
const { readExecutionLog } = require("./backend/executionLog.cjs");
const { runGitHubDeviceAuth } = require("./backend/githubDeviceAuth.cjs");
const { describeAttachments } = require("./backend/attachments.cjs");
const { applyProjectTemplate, listProjectTemplates } = require("./backend/templates.cjs");
const {
  appendTextFile,
  deleteWorkspacePath,
  listFiles,
  readTextFile,
  resolveWorkspacePath,
  writeTextFile,
} = require("./backend/files.cjs");

let mainWindow;

app.setName("Local Agent Studio");

function userDataDir() {
  return app.getPath("userData");
}

function getSettings() {
  return readSettings(userDataDir());
}

function getRuntimeSettings() {
  return {
    ...getSettings(),
    _userDataDir: userDataDir(),
  };
}

function hydratePluginEnv(env, settings) {
  const next = {};
  for (const [key, value] of Object.entries(env || {})) {
    next[key] = String(value || "")
      .replaceAll("${workspacePath}", settings.workspacePath || "")
      .replaceAll("${settings.workspacePath}", settings.workspacePath || "");
  }
  return next;
}

function syncPluginMcpServers(pluginsResult) {
  const plugins = Array.isArray(pluginsResult?.plugins) ? pluginsResult.plugins : [];
  const settings = getSettings();
  const pluginServerNames = new Set(plugins.flatMap((plugin) => (plugin.mcpServers || []).map((server) => server.name).filter(Boolean)));
  const existingServers = Array.isArray(settings.mcp?.servers) ? settings.mcp.servers : [];
  const nextServers = existingServers.filter((server) => !pluginServerNames.has(server.name));
  if (nextServers.length !== existingServers.length) {
    saveSettings(userDataDir(), {
      ...settings,
      mcp: {
        ...settings.mcp,
        servers: nextServers,
      },
    });
  }
  return pluginsResult;
}

function runPluginCommand(command, args = [], env = {}, timeoutMs = 300000) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let child;
    try {
      const resolved = resolveSpawnCommand(command, args, env);
      child = spawn(resolved.command, resolved.args, {
        env: resolved.env,
        windowsHide: true,
        shell: resolved.shell,
      });
    } catch (error) {
      resolve({ exitCode: -1, stdout, stderr: error instanceof Error ? error.message : String(error), timedOut: false });
      return;
    }
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs} ms`.trim(), timedOut: true });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: -1, stdout, stderr: error.message, timedOut: false });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 0, stdout, stderr, timedOut: false });
    });
  });
}

function isMissingCommandResult(result, command) {
  const text = `${result?.stdout || ""}\n${result?.stderr || ""}`;
  return result?.exitCode !== 0 && new RegExp(`Required command "${String(command).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" was not found`, "i").test(text);
}

function authAutoInstallCommand(auth) {
  if (process.platform === "win32") {
    return auth.autoInstall?.windows || null;
  }
  return null;
}

async function runPluginAuth(pluginId) {
  const plugin = listPlugins(userDataDir()).plugins.find((item) => item.id === pluginId);
  if (!plugin?.auth) {
    throw new Error("This plugin does not define browser sign-in.");
  }
  if (plugin.auth.type === "github_device_flow") {
    return runGitHubDeviceAuth({
      userDataDir: userDataDir(),
      plugin,
      openDeviceCode: async (device) => {
        clipboard.writeText(device.userCode);
        await shell.openExternal(device.verificationUriComplete || device.verificationUri);
        if (!device.verificationUriComplete) {
          await dialog.showMessageBox(mainWindow, {
            type: "info",
            title: "GitHub sign in",
            message: "Complete GitHub sign in in your browser",
            detail: `Enter this code on GitHub:\n\n${device.userCode}\n\nThe code was copied to your clipboard.`,
            buttons: ["OK"],
          });
        }
      },
    });
  }
  if (plugin.auth.type !== "browser_command") {
    throw new Error("This plugin does not define a supported sign-in method.");
  }
  const settings = getSettings();
  const authEnv = hydratePluginEnv(plugin.auth.env || {}, settings);

  let initialCheck = null;
  if (plugin.auth.checkCommand) {
    initialCheck = await runPluginCommand(plugin.auth.checkCommand, plugin.auth.checkArgs || [], authEnv, 30000);
    if (initialCheck.exitCode === 0) {
      return {
        pluginId,
        label: plugin.auth.label || "Sign in",
        ok: true,
        result: { exitCode: 0, stdout: "Already signed in.", stderr: "", timedOut: false },
        check: initialCheck,
        install: null,
      };
    }
  }

  let install = null;
  let result = await runPluginCommand(plugin.auth.command, plugin.auth.args || [], authEnv);
  if (isMissingCommandResult(result, plugin.auth.command)) {
    const installer = authAutoInstallCommand(plugin.auth);
    if (installer?.command) {
      install = await runPluginCommand(installer.command, installer.args || [], authEnv, 600000);
      if (install.exitCode === 0) {
        result = await runPluginCommand(plugin.auth.command, plugin.auth.args || [], authEnv);
      }
    }
  }

  let check = null;
  if (plugin.auth.checkCommand) {
    check = await runPluginCommand(plugin.auth.checkCommand, plugin.auth.checkArgs || [], authEnv, 30000);
  }
  return {
    pluginId,
    label: plugin.auth.label || "Sign in",
    result,
    check,
    install,
    ok: result.exitCode === 0 && (!check || check.exitCode === 0),
  };
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#f7f9f8",
    title: "Local Agent Studio",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (process.env.LOCAL_AGENT_DEV) {
    await mainWindow.loadURL("http://127.0.0.1:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    await mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function registerHandlers() {
  ipcMain.handle("settings:get", () => getSettings());

  ipcMain.handle("settings:save", (_event, settings) => saveSettings(userDataDir(), settings));

  ipcMain.handle("providers:check", async () => checkProviders(getSettings()));

  ipcMain.handle("updates:check", async () => checkForUpdates(getSettings()));

  ipcMain.handle("agent:message", async (_event, payload) =>
    sendAgentMessage({
      messages: payload.messages,
      toolMode: payload.toolMode,
      settings: getRuntimeSettings(),
    }),
  );

  ipcMain.handle("agent:stream", async (event, payload) =>
    sendAgentMessageStream({
      messages: payload.messages,
      toolMode: payload.toolMode,
      settings: getRuntimeSettings(),
      onEvent: (streamEvent) => {
        event.sender.send("agent:stream:event", {
          requestId: payload.requestId,
          event: streamEvent,
        });
      },
    }),
  );

  ipcMain.handle("search:web", async (_event, payload) =>
    searchWeb({
      query: payload.query,
      provider: payload.provider,
      settings: getSettings(),
    }),
  );

  ipcMain.handle("comfy:queue", async (_event, payload) => {
    const settings = getRuntimeSettings();
    const result = await queueComfyPrompt({
      prompt: payload.prompt,
      negativePrompt: payload.negativePrompt,
      imageModel: payload.imageModel,
      ideogramEffort: payload.ideogramEffort,
      count: payload.count,
      settings,
    });
    addImageHistoryJob(
      userDataDir(),
      {
        prompt: payload.prompt,
        negativePrompt: payload.negativePrompt,
        imageModel: payload.imageModel,
        ideogramEffort: payload.ideogramEffort,
        count: payload.count,
      },
      result,
    );
    return result;
  });

  ipcMain.handle("comfy:history", async (_event, payload) =>
    getComfyHistory({
      promptId: payload.promptId,
      settings: getSettings(),
    }),
  );

  ipcMain.handle("comfy:images", async (_event, payload) => {
    const result = await getComfyImages({
      promptId: payload.promptId,
      settings: getSettings(),
    });
    updateImageHistoryImages(userDataDir(), payload.promptId, result.images || []);
    return result;
  });

  ipcMain.handle("images:history", async () => readImageHistory(userDataDir()));

  ipcMain.handle("comfy:save-image", async (_event, payload) =>
    saveComfyImageToWorkspace({
      image: payload.image,
      settings: getSettings(),
    }),
  );

  ipcMain.handle("mcp:list-tools", async () =>
    listMcpTools({
      settings: getRuntimeSettings(),
    }),
  );

  ipcMain.handle("mcp:call-tool", async (_event, payload) =>
    callMcpTool({
      settings: getRuntimeSettings(),
      serverName: payload.serverName,
      toolName: payload.toolName,
      args: payload.args || {},
    }),
  );

  ipcMain.handle("memory:list", async () => readMemory(userDataDir()));
  ipcMain.handle("memory:add", async (_event, payload) => addMemory(userDataDir(), payload.content, payload.source || "manual", getSettings().memory?.maxEntries));
  ipcMain.handle("memory:delete", async (_event, payload) => deleteMemory(userDataDir(), payload.id));
  ipcMain.handle("memory:clear", async () => clearMemory(userDataDir()));

  ipcMain.handle("artifacts:list", async () => listArtifacts({ settings: getSettings() }));
  ipcMain.handle("artifacts:read", async (_event, payload) => readArtifact({ settings: getSettings(), id: payload.id }));
  ipcMain.handle("artifacts:write", async (_event, payload) =>
    writeArtifact({
      settings: getSettings(),
      id: payload.id,
      name: payload.name,
      kind: payload.kind,
      content: payload.content,
    }),
  );
  ipcMain.handle("artifacts:append", async (_event, payload) =>
    appendArtifact({
      settings: getSettings(),
      id: payload.id,
      content: payload.content,
    }),
  );

  ipcMain.handle("templates:list", async () => listProjectTemplates());
  ipcMain.handle("templates:apply", async (_event, payload) => applyProjectTemplate({ settings: getSettings(), templateId: payload.templateId }));
  ipcMain.handle("execution-log:list", async (_event, payload = {}) => readExecutionLog(userDataDir(), payload.limit || 200));
  ipcMain.handle("plugins:list", async () => syncPluginMcpServers(listPlugins(userDataDir())));
  ipcMain.handle("plugins:install-url", async (_event, payload) => syncPluginMcpServers(await installPluginFromUrl(userDataDir(), payload.url)));
  ipcMain.handle("plugins:auth", async (_event, payload) => runPluginAuth(payload.pluginId));
  ipcMain.handle("plugins:set-enabled", async (_event, payload) => setPluginEnabled(userDataDir(), payload.pluginId, Boolean(payload.enabled)));
  ipcMain.handle("plugins:set-installed", async (_event, payload) => syncPluginMcpServers(await setPluginInstalled(userDataDir(), payload.pluginId, Boolean(payload.installed))));

  ipcMain.handle("terminal:run", async (_event, payload) =>
    runCommand({
      command: payload.command,
      settings: getSettings(),
    }),
  );

  ipcMain.handle("files:list", async (_event, payload = {}) =>
    listFiles({
      settings: getSettings(),
      directory: payload.directory || "",
      depth: payload.depth ?? 2,
    }),
  );

  ipcMain.handle("files:read", async (_event, payload) =>
    readTextFile({
      settings: getSettings(),
      filePath: payload.filePath,
    }),
  );

  ipcMain.handle("files:write", async (_event, payload) =>
    writeTextFile({
      settings: getSettings(),
      filePath: payload.filePath,
      content: payload.content || "",
      overwrite: payload.overwrite ?? true,
    }),
  );

  ipcMain.handle("files:append", async (_event, payload) =>
    appendTextFile({
      settings: getSettings(),
      filePath: payload.filePath,
      content: payload.content || "",
    }),
  );

  ipcMain.handle("files:delete", async (_event, payload) =>
    deleteWorkspacePath({
      settings: getSettings(),
      filePath: payload.filePath,
    }),
  );

  ipcMain.handle("files:export", async (_event, payload) => {
    const settings = getSettings();
    const file = resolveWorkspacePath(settings, payload.filePath);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save workspace file",
      defaultPath: path.basename(file.relativePath),
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    fs.copyFileSync(file.absolutePath, result.filePath);
    return {
      sourcePath: file.absolutePath,
      savedPath: result.filePath,
    };
  });

  ipcMain.handle("dialog:attachments", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openFile", "multiSelections"],
      title: "Attach files",
      filters: [
        { name: "Supported files", extensions: ["png", "jpg", "jpeg", "webp", "gif", "txt", "md", "json", "csv", "pdf", "mp3", "wav", "m4a", "mp4", "webm", "mov"] },
        { name: "All files", extensions: ["*"] },
      ],
    });

    if (result.canceled || !result.filePaths.length) {
      return [];
    }

    return describeAttachments(result.filePaths);
  });

  ipcMain.handle("attachments:import", async (_event, payload) => {
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const importedPaths = [];
    const tempDir = path.join(app.getPath("temp"), "LocalAgentStudio", "attachments");
    fs.mkdirSync(tempDir, { recursive: true });

    for (const item of items) {
      if (item.path && fs.existsSync(item.path)) {
        importedPaths.push(item.path);
        continue;
      }
      if (!item.dataBase64) {
        continue;
      }
      const safeName = path.basename(item.name || `clipboard-${Date.now()}.png`).replace(/[<>:"/\\|?*]+/g, "-");
      const targetPath = path.join(tempDir, `${Date.now()}-${safeName}`);
      fs.writeFileSync(targetPath, Buffer.from(item.dataBase64, "base64"));
      importedPaths.push(targetPath);
    }

    return describeAttachments(importedPaths);
  });

  ipcMain.handle("dialog:workspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory", "createDirectory"],
      title: "Select Local Agent workspace",
    });

    if (result.canceled || !result.filePaths.length) {
      return null;
    }

    const settings = getSettings();
    settings.workspacePath = result.filePaths[0];
    settings.setup = {
      ...(settings.setup || {}),
      firstLaunchComplete: true,
    };
    return saveSettings(userDataDir(), settings);
  });

  ipcMain.handle("chat:export", async (_event, payload) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Export chat",
      defaultPath: `local-agent-chat-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePath) {
      return null;
    }
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), "utf8");
    return { savedPath: result.filePath };
  });

  ipcMain.handle("chat:import", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import chat",
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (result.canceled || !result.filePaths.length) {
      return null;
    }
    const raw = fs.readFileSync(result.filePaths[0], "utf8");
    return {
      sourcePath: result.filePaths[0],
      data: JSON.parse(raw),
    };
  });

  ipcMain.handle("path:open", async (_event, targetPath) => {
    if (!targetPath) {
      return;
    }
    await shell.openPath(targetPath);
  });

  ipcMain.handle("path:show", async (_event, targetPath) => {
    if (!targetPath) {
      return;
    }
    shell.showItemInFolder(targetPath);
  });
}

app.whenReady().then(async () => {
  registerHandlers();
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
