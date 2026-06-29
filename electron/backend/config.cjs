const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function defaultSettings() {
  const homeWorkspace = path.join(os.homedir(), "LocalAgentStudio", "workspace");
  const workflowDir = path.join(__dirname, "..", "workflows");
  const defaultShell = process.platform === "win32" ? "powershell" : "bash";
  const envThinking = process.env.OLLAMA_THINKING || "off";
  const defaultThinking = ["off", "low", "medium", "high"].includes(envThinking) ? envThinking : "off";

  return {
    version: 3,
    workspacePath: process.env.LOCAL_AGENT_WORKSPACE || homeWorkspace,
    setup: {
      firstLaunchComplete: false,
    },
    profile: {
      userName: process.env.LOCAL_AGENT_USER_NAME || os.userInfo().username || "User",
    },
    context: {
      includeLocalDateTime: true,
    },
    appearance: {
      theme: process.env.LOCAL_AGENT_THEME || "system",
      language: process.env.LOCAL_AGENT_LANGUAGE || "en",
    },
    agent: {
      maxWebSearches: 3,
      maxImageJobs: 3,
      maxToolSteps: 5,
      taskQueue: true,
      permissionProfile: "balanced",
    },
    controlledExecution: {
      dryRun: false,
      sandboxPerTask: false,
      evaluatorPass: false,
      executionLog: true,
      approvalGates: {
        destructive: true,
        terminal: true,
        externalWrite: true,
        credentialUse: true,
        installs: true,
      },
    },
    memory: {
      enabled: false,
      autoRemember: false,
      maxEntries: 80,
    },
    remoteProviders: {
      activePresetId: "ollama",
      presets: [
        {
          id: "ollama",
          label: "Ollama",
          description: "Use local Ollama and local ComfyUI endpoints.",
          kind: "full",
          ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
          comfyBaseUrl: process.env.COMFYUI_BASE_URL || "http://localhost:8188",
          apiFormat: "ollama",
        },
        {
          id: "lm-studio",
          label: "LM Studio",
          description: "Use the local server started from LM Studio.",
          kind: "llm",
          ollamaBaseUrl: process.env.LM_STUDIO_BASE_URL || "http://localhost:1234",
          comfyBaseUrl: "",
          apiFormat: "openai-compatible",
        },
        {
          id: "llama-cpp",
          label: "llama.cpp",
          description: "Use a local llama.cpp server endpoint.",
          kind: "llm",
          ollamaBaseUrl: process.env.LLAMA_CPP_BASE_URL || "http://localhost:8080",
          comfyBaseUrl: "",
          apiFormat: "openai-compatible",
        },
      ],
    },
    permissions: {
      files: "allow",
      search: "allow",
      images: "allow",
      terminal: "ask",
      database: "allow",
      mcp: "ask",
    },
    ollama: {
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      model: process.env.OLLAMA_MODEL || "auto",
      apiKey: process.env.OLLAMA_API_KEY || "",
      apiFormat: process.env.LLM_API_FORMAT === "openai-compatible" ? "openai-compatible" : "ollama",
      thinking: defaultThinking,
      temperature: 0.35,
      contextTokens: 8192,
      timeoutMs: 120000,
    },
    search: {
      provider: process.env.SEARCH_PROVIDER || "searxng",
      maxResults: 5,
    },
    serpApi: {
      apiKey: process.env.SERPAPI_API_KEY || "",
      engine: "google",
      location: "",
    },
    ollamaSearch: {
      apiKey: process.env.OLLAMA_API_KEY || "",
      maxResults: 5,
    },
    searxng: {
      baseUrl: process.env.SEARXNG_BASE_URL || "http://localhost:8080",
    },
    runpod: {
      enabled: false,
      apiKey: process.env.RUNPOD_API_KEY || "",
      endpointId: process.env.RUNPOD_ENDPOINT_ID || "",
      baseUrl: process.env.RUNPOD_BASE_URL || "",
      ollamaBaseUrl: process.env.RUNPOD_OLLAMA_BASE_URL || "",
      comfyBaseUrl: process.env.RUNPOD_COMFY_BASE_URL || "",
    },
    mcp: {
      enabled: false,
      timeoutMs: 15000,
      servers: [],
    },
    updates: {
      enabled: true,
      checkOnStartup: false,
      repo: "CrazyDashTool/Local-Agent-Studio",
      currentVersion: "0.2.1",
      versionUrl: "https://raw.githubusercontent.com/CrazyDashTool/Local-Agent-Studio/main/version.json",
    },
    comfy: {
      baseUrl: process.env.COMFYUI_BASE_URL || "http://localhost:8188",
      workflowPath: "",
      defaultCheckpoint: "sd_xl_base_1.0.safetensors",
      negativePrompt: "low quality, blurry, distorted, watermark, text",
    },
    image: {
      model: process.env.IMAGE_MODEL || "z-image-turbo",
      repeat: 1,
      ideogramEffort: "default",
      ideogramResolution: "2048x2048",
      zImageCheckpoint: process.env.Z_IMAGE_CHECKPOINT || "z_image_turbo.safetensors",
      fluxCheckpoint: process.env.FLUX2_KLEIN_CHECKPOINT || "flux2_klein_9b.safetensors",
      zImageWorkflowPath: process.env.Z_IMAGE_WORKFLOW_PATH || path.join(workflowDir, "image_z_image_turbo.json"),
      fluxWorkflowPath: process.env.FLUX2_WORKFLOW_PATH || path.join(workflowDir, "image_flux2_text_to_image_9b.json"),
      ideogramWorkflowPath: process.env.IDEOGRAM_WORKFLOW_PATH || path.join(workflowDir, "ideogram_v4.json"),
      customModels: [],
    },
    sandbox: {
      mode: "subprocess",
      shell: defaultShell,
      dockerImage: "ubuntu:24.04",
      timeoutMs: 60000,
    },
  };
}

function settingsPath(userDataDir) {
  return path.join(userDataDir, "settings.json");
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function mergeDeep(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = mergeDeep(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function ensureWorkspace(settings) {
  if (settings.workspacePath) {
    fs.mkdirSync(settings.workspacePath, { recursive: true });
  }
}

function normalizeProviderPresets(settings) {
  const defaults = defaultSettings();
  settings.remoteProviders = {
    ...defaults.remoteProviders,
    ...(settings.remoteProviders || {}),
    presets: defaults.remoteProviders.presets,
  };
  if (!settings.remoteProviders.presets.some((preset) => preset.id === settings.remoteProviders.activePresetId)) {
    settings.remoteProviders.activePresetId = "ollama";
  }
  return settings;
}

function readSettings(userDataDir) {
  const filePath = settingsPath(userDataDir);
  const defaults = defaultSettings();

  if (!fs.existsSync(filePath)) {
    ensureWorkspace(defaults);
    return defaults;
  }

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed.setup) {
    parsed.setup = { firstLaunchComplete: true };
  }
  if (parsed.ollama && !["off", "low", "medium", "high"].includes(parsed.ollama.thinking)) {
    parsed.ollama.thinking = "off";
  }
  const merged = normalizeProviderPresets(mergeDeep(defaults, parsed));
  ensureWorkspace(merged);
  return merged;
}

function saveSettings(userDataDir, settings) {
  const merged = normalizeProviderPresets(mergeDeep(defaultSettings(), settings));
  ensureWorkspace(merged);
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(settingsPath(userDataDir), JSON.stringify(merged, null, 2), "utf8");
  return merged;
}

module.exports = {
  defaultSettings,
  readSettings,
  saveSettings,
  settingsPath,
};
