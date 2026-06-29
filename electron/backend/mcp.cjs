const { spawn } = require("node:child_process");
const { resolveSpawnCommand } = require("./commands.cjs");
const { pluginMcpServers } = require("./pluginMarketplace.cjs");

function enabledServers(settings) {
  const manualServers = settings.mcp?.enabled
    ? (settings.mcp.servers || []).filter((server) => server.enabled && server.name && server.command).map((server) => ({ ...server, source: "manual" }))
    : [];
  const pluginServers = settings._userDataDir ? pluginMcpServers(settings._userDataDir, settings) : [];
  return [...manualServers, ...pluginServers];
}

function findServer(settings, serverName) {
  const server = enabledServers(settings).find((item) => item.name === serverName);
  if (!server) {
    throw new Error(`MCP server is not configured or enabled: ${serverName}`);
  }
  return server;
}

function parseArgs(args) {
  if (Array.isArray(args)) {
    return args.map(String);
  }
  if (!args) {
    return [];
  }
  return String(args)
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function createMcpSession(server, timeoutMs) {
  const resolved = resolveSpawnCommand(server.command, parseArgs(server.args), server.env || {});
  const child = spawn(resolved.command, resolved.args, {
    env: resolved.env,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    shell: resolved.shell,
  });

  let nextId = 1;
  let buffer = "";
  let stderr = "";
  const pending = new Map();

  const timeout = setTimeout(() => {
    child.kill();
    for (const { reject } of pending.values()) {
      reject(new Error(`MCP server timed out after ${timeoutMs} ms`));
    }
    pending.clear();
  }, timeoutMs);

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!message.id || !pending.has(message.id)) {
        continue;
      }
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message || JSON.stringify(message.error)));
      } else {
        resolve(message.result);
      }
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("error", (error) => {
    for (const { reject } of pending.values()) {
      reject(error);
    }
    pending.clear();
  });

  function request(method, params = {}) {
    const id = nextId++;
    const payload = { jsonrpc: "2.0", id, method, params };
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(`${JSON.stringify(payload)}\n`);
    });
  }

  async function notify(method, params = {}) {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async function initialize() {
    await request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "Local Agent Studio",
        version: "0.2.1",
      },
    });
    await notify("notifications/initialized");
  }

  function close() {
    clearTimeout(timeout);
    child.kill();
  }

  return { initialize, request, close, stderr: () => stderr };
}

async function withMcpSession(settings, serverName, fn, toolName = "") {
  const server = findServer(settings, serverName);
  await ensurePluginAuth(server, toolName);
  const session = createMcpSession(server, Number(settings.mcp?.timeoutMs || 15000));
  try {
    await session.initialize();
    return await fn(session, server);
  } finally {
    session.close();
  }
}

function runCommand(command, args = [], env = {}, timeoutMs = 30000) {
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
      resolve({ exitCode: -1, stdout, stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    const timeout = setTimeout(() => {
      child.kill();
      resolve({ exitCode: -1, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs} ms`.trim() });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      resolve({ exitCode: -1, stdout, stderr: error.message });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({ exitCode: exitCode ?? 0, stdout, stderr });
    });
  });
}

async function ensurePluginAuth(server, toolName = "") {
  if (server.source !== "plugin" || !server.auth) {
    return;
  }
  const requiredTools = Array.isArray(server.auth.requiredTools) ? server.auth.requiredTools.map(String) : [];
  if (requiredTools.length && !requiredTools.includes(toolName)) {
    return;
  }
  if (server.auth.type === "github_device_flow") {
    if (server.env?.GITHUB_TOKEN) {
      return;
    }
    const error = new Error(`${server.pluginLabel || server.name} requires GitHub sign-in before this tool can run.`);
    error.code = "PLUGIN_AUTH_REQUIRED";
    error.pluginId = server.pluginId;
    error.pluginLabel = server.pluginLabel || server.name;
    error.authLabel = server.auth.label || "Sign in";
    error.stdout = "";
    error.stderr = "GitHub token is not available.";
    throw error;
  }
  if (!server.auth.checkCommand) {
    return;
  }
  const result = await runCommand(server.auth.checkCommand, server.auth.checkArgs || [], server.env || {}, 30000);
  if (result.exitCode === 0) {
    return;
  }
  const error = new Error(`${server.pluginLabel || server.name} requires sign-in before this tool can run.`);
  error.code = "PLUGIN_AUTH_REQUIRED";
  error.pluginId = server.pluginId;
  error.pluginLabel = server.pluginLabel || server.name;
  error.authLabel = server.auth.label || "Sign in";
  error.stdout = result.stdout;
  error.stderr = result.stderr;
  throw error;
}

async function listMcpTools({ settings }) {
  const servers = enabledServers(settings);
  const allTools = [];
  for (const server of servers) {
    try {
      const result = await withMcpSession(settings, server.name, (session) => session.request("tools/list"));
      for (const tool of result?.tools || []) {
        allTools.push({
          serverName: server.name,
          name: tool.name,
          description: tool.description || "",
          inputSchema: tool.inputSchema || {},
        });
      }
    } catch (error) {
      allTools.push({
        serverName: server.name,
        name: "__error__",
        description: error instanceof Error ? error.message : String(error),
        inputSchema: {},
      });
    }
  }
  return { tools: allTools };
}

async function callMcpTool({ settings, serverName, toolName, args = {} }) {
  if (!toolName) {
    throw new Error("MCP tool name is empty");
  }
  return withMcpSession(settings, serverName, async (session, server) => {
    const result = await session.request("tools/call", {
      name: toolName,
      arguments: args,
    });
    return {
      serverName: server.name,
      toolName,
      result,
    };
  }, toolName);
}

module.exports = {
  callMcpTool,
  enabledServers,
  listMcpTools,
};
