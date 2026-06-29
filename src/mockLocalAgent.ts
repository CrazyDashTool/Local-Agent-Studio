import type {
  AgentResponse,
  AgentStreamEvent,
  ArtifactItem,
  ComfyQueueResponse,
  ProviderHealth,
  SearchResult,
  Settings,
  TerminalResult,
  WorkspaceFile,
  WorkspaceReadResult,
} from "./types";

const mockSettings: Settings = {
  version: 3,
  workspacePath: "C:\\LocalAgentStudio\\workspace",
  setup: {
    firstLaunchComplete: true,
  },
  profile: {
    userName: "Anatoly",
  },
  context: {
    includeLocalDateTime: true,
  },
  appearance: {
    theme: "system",
    language: "en",
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
        description: "Use local Ollama and ComfyUI endpoints.",
        kind: "full",
        ollamaBaseUrl: "http://localhost:11434",
        comfyBaseUrl: "http://localhost:8188",
        apiFormat: "ollama",
      },
      {
        id: "lm-studio",
        label: "LM Studio",
        description: "Use the local server started from LM Studio.",
        kind: "llm",
        ollamaBaseUrl: "http://localhost:1234",
        comfyBaseUrl: "",
        apiFormat: "openai-compatible",
      },
      {
        id: "llama-cpp",
        label: "llama.cpp",
        description: "Use a local llama.cpp server endpoint.",
        kind: "llm",
        ollamaBaseUrl: "http://localhost:8080",
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
    baseUrl: "http://localhost:11434",
    model: "auto",
    apiKey: "",
    apiFormat: "ollama",
    thinking: "off",
    temperature: 0.35,
    contextTokens: 8192,
    timeoutMs: 120000,
  },
  search: {
    provider: "searxng",
    maxResults: 5,
  },
  serpApi: {
    apiKey: "",
    engine: "google",
    location: "",
  },
  ollamaSearch: {
    apiKey: "",
    maxResults: 5,
  },
  searxng: {
    baseUrl: "http://localhost:8080",
  },
  runpod: {
    enabled: false,
    apiKey: "",
    endpointId: "",
    baseUrl: "",
    ollamaBaseUrl: "",
    comfyBaseUrl: "",
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
    baseUrl: "http://localhost:8188",
    workflowPath: "",
    defaultCheckpoint: "sd_xl_base_1.0.safetensors",
    negativePrompt: "low quality, blurry, distorted, watermark, text",
  },
  image: {
    model: "z-image-turbo",
    repeat: 1,
    ideogramEffort: "default",
    ideogramResolution: "2048x2048",
    zImageCheckpoint: "z_image_turbo.safetensors",
    fluxCheckpoint: "flux2_klein_9b.safetensors",
    zImageWorkflowPath: "electron\\workflows\\image_z_image_turbo.json",
    fluxWorkflowPath: "electron\\workflows\\image_flux2_text_to_image_9b.json",
    ideogramWorkflowPath: "electron\\workflows\\ideogram_v4.json",
    customModels: [],
  },
  sandbox: {
    mode: "subprocess",
    shell: "powershell",
    dockerImage: "ubuntu:24.04",
    timeoutMs: 60000,
  },
};

const mockFile: WorkspaceFile = {
  name: "note.txt",
  relativePath: "note.txt",
  absolutePath: `${mockSettings.workspacePath}\\note.txt`,
  type: "file",
  size: 12,
  modifiedAt: new Date().toISOString(),
  isText: true,
};

const mockArtifact: ArtifactItem = {
  id: "preview-artifact",
  name: "draft.md",
  kind: "markdown",
  relativePath: "draft.md",
  absolutePath: `${mockSettings.workspacePath}\\Artifacts\\draft.md`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  size: 18,
  content: "# Preview artifact\n",
};

const mockProviders: ProviderHealth[] = [
  {
    id: "ollama",
    name: "Ollama",
    kind: "LLM",
    endpoint: "http://localhost:11434",
    status: "healthy",
    latencyMs: 31,
    details: "Models: llama3.1:8b, qwen2.5-coder:7b",
  },
  {
    id: "comfy",
    name: "ComfyUI",
    kind: "Image/Video",
    endpoint: "http://localhost:8188",
    status: "healthy",
    latencyMs: 44,
    details: "system_stats OK",
  },
  {
    id: "searxng",
    name: "SearXNG",
    kind: "Search",
    endpoint: "http://localhost:8080",
    status: "healthy",
    latencyMs: 118,
    details: "JSON search OK",
  },
];

function previewResponse(): AgentResponse {
  return {
    content:
      "Preview mode: in Electron this message goes through the local Ollama API.\n\n```ts\nconst streaming = true;\n```\n\n**Markdown** is enabled.",
    thinking: "Preview reasoning is shown here when a model returns it.",
    model: mockSettings.ollama.model,
    toolResults: [],
  };
}

function mockRead(filePath = "note.txt", content = "Preview file"): WorkspaceReadResult {
  return {
    root: mockSettings.workspacePath,
    relativePath: filePath,
    absolutePath: `${mockSettings.workspacePath}\\${filePath}`,
    content,
    info: {
      ...mockFile,
      name: filePath,
      relativePath: filePath,
      absolutePath: `${mockSettings.workspacePath}\\${filePath}`,
      size: content.length,
    },
  };
}

export function installMockLocalAgent() {
  if (window.localAgent) {
    return;
  }

  window.localAgent = {
    getSettings: async () => mockSettings,
    saveSettings: async (settings: Settings) => settings,
    checkProviders: async () => mockProviders,
    checkUpdates: async () => ({
      enabled: true,
      currentVersion: "0.2.1",
      latestVersion: "0.2.1",
      updateAvailable: false,
    }),
    sendMessage: async (): Promise<AgentResponse> => previewResponse(),
    sendMessageStream: async (_payload, onEvent: (event: AgentStreamEvent) => void): Promise<AgentResponse> => {
      const response = previewResponse();
      for (const token of response.content.match(/.{1,18}/g) || []) {
        onEvent({ type: "token", token });
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
      onEvent({ type: "done", response });
      return response;
    },
    searchWeb: async (): Promise<{ provider: "searxng"; results: SearchResult[] }> => ({
      provider: "searxng",
      results: [
        {
          title: "SearXNG preview result",
          url: "http://localhost:8080",
          content: "Mock result used only when the renderer is opened without Electron preload.",
          source: "SearXNG",
        },
      ],
    }),
    queueComfy: async (): Promise<ComfyQueueResponse> => ({
      provider: "comfy",
      model: "z-image-turbo",
      count: 1,
      clientId: "preview-client",
      promptId: "preview-prompt",
      number: 1,
      jobs: [{ clientId: "preview-client", promptId: "preview-prompt", number: 1 }],
    }),
    getComfyHistory: async () => ({}),
    getComfyImages: async () => ({ promptId: "preview-prompt", images: [] }),
    saveComfyImage: async (payload) => ({
      root: mockSettings.workspacePath,
      relativePath: `Images\\${payload.image.filename}`,
      absolutePath: `${mockSettings.workspacePath}\\Images\\${payload.image.filename}`,
      size: 0,
      source: payload.image,
    }),
    getImageHistory: async () => ({ items: [] }),
    listMcpTools: async () => ({ tools: [] }),
    callMcpTool: async () => ({}),
    listMemory: async () => ({ entries: [] }),
    addMemory: async (payload) => ({
      entries: [{ id: "preview-memory", content: payload.content, createdAt: new Date().toISOString(), source: payload.source }],
    }),
    deleteMemory: async () => ({ entries: [] }),
    clearMemory: async () => ({ entries: [] }),
    listArtifacts: async () => ({ root: `${mockSettings.workspacePath}\\Artifacts`, artifacts: [mockArtifact] }),
    readArtifact: async () => mockArtifact,
    writeArtifact: async (payload) => ({
      root: `${mockSettings.workspacePath}\\Artifacts`,
      artifact: { ...mockArtifact, ...payload, id: payload.id || mockArtifact.id, relativePath: payload.name, absolutePath: `${mockSettings.workspacePath}\\Artifacts\\${payload.name}`, updatedAt: new Date().toISOString(), size: payload.content.length },
    }),
    appendArtifact: async (payload) => ({
      root: `${mockSettings.workspacePath}\\Artifacts`,
      artifact: { ...mockArtifact, id: payload.id, content: `${mockArtifact.content}${payload.content}` },
    }),
    listProjectTemplates: async () => ({
      templates: [
        {
          id: "work",
          label: "Work",
          description: "Preview work template",
          files: [{ path: "Work/README.md", content: "# Work\n" }],
        },
      ],
    }),
    applyProjectTemplate: async () => ({
      template: {
        id: "work",
        label: "Work",
        description: "Preview work template",
        files: [{ path: "Work/README.md", content: "# Work\n" }],
      },
      files: [mockRead("Work/README.md", "# Work\n")],
    }),
    listExecutionLog: async () => ({ filePath: "", entries: [] }),
    listPluginDrafts: async () => ({
      plugins: [
        {
          id: "telegram-connector",
          label: "Telegram Connector",
          description: "Connect Telegram chats and expose message tools to the agent.",
          version: "0.1.0",
          author: "Local Agent Studio",
          publisher: "community",
          status: "draft",
          categories: ["messenger", "telegram"],
          capabilities: ["agent_tool", "connector"],
          permissions: ["network", "messages:read", "messages:write"],
          tools: [{ name: "telegram.search_messages", description: "Search Telegram messages." }],
          installed: true,
          enabled: true,
          trusted: true,
        },
      ],
    }),
    installPluginFromUrl: async () => ({
      plugins: [
        {
          id: "github-workspace",
          label: "GitHub Workspace",
          description: "Browse repositories, prepare commits, and copy issue or PR data.",
          version: "0.1.0",
          author: "Local Agent Studio",
          publisher: "community",
          status: "draft",
          categories: ["github"],
          capabilities: ["agent_tool", "connector"],
          permissions: ["network", "files:read", "files:write"],
          tools: [{ name: "github_workspace.repo_summary", description: "Summarize repository status." }],
          installed: true,
          enabled: true,
          trusted: true,
        },
      ],
    }),
    runPluginAuth: async (payload) => ({
      pluginId: payload.pluginId,
      label: "Sign in with GitHub",
      ok: true,
      result: {
        exitCode: 0,
        stdout: "Logged in to github.com as preview-user",
        stderr: "",
      },
      check: {
        exitCode: 0,
        stdout: "Logged in to github.com account preview-user",
        stderr: "",
      },
    }),
    setPluginEnabled: async (payload) => ({
      plugins: [
        {
          id: payload.pluginId,
          label: "GitHub Workspace",
          description: "Browse repositories, prepare commits, and copy issue or PR data.",
          version: "0.1.0",
          author: "Local Agent Studio",
          publisher: "community",
          status: "draft",
          categories: ["github"],
          capabilities: ["agent_tool", "connector"],
          permissions: ["network", "files:read", "files:write"],
          installed: true,
          enabled: payload.enabled,
          trusted: true,
        },
      ],
    }),
    setPluginInstalled: async (payload) => ({
      plugins: [
        {
          id: payload.pluginId,
          label: "GitHub Workspace",
          description: "Browse repositories, prepare commits, and copy issue or PR data.",
          version: "0.1.0",
          author: "Local Agent Studio",
          publisher: "community",
          status: "draft",
          categories: ["github"],
          capabilities: ["agent_tool", "connector"],
          permissions: ["network", "files:read", "files:write"],
          installed: payload.installed,
          enabled: payload.installed,
          trusted: true,
        },
      ],
    }),
    runCommand: async (): Promise<TerminalResult> => ({
      exitCode: 0,
      stdout: "Preview command output",
      stderr: "",
      durationMs: 12,
      timedOut: false,
    }),
    listFiles: async () => ({
      root: mockSettings.workspacePath,
      directory: "",
      files: [mockFile],
    }),
    readFile: async (payload) => mockRead(payload.filePath),
    writeFile: async (payload) => mockRead(payload.filePath, payload.content),
    appendFile: async (payload) => mockRead(payload.filePath, payload.content),
    deleteFile: async (payload) => ({
      root: mockSettings.workspacePath,
      relativePath: payload.filePath,
      absolutePath: `${mockSettings.workspacePath}\\${payload.filePath}`,
    }),
    exportFile: async (payload) => ({
      sourcePath: `${mockSettings.workspacePath}\\${payload.filePath}`,
      savedPath: `${mockSettings.workspacePath}\\exports\\${payload.filePath}`,
    }),
    exportChat: async () => ({ savedPath: `${mockSettings.workspacePath}\\chat.json` }),
    importChat: async () => null,
    chooseWorkspace: async () => mockSettings,
    chooseAttachments: async () => [],
    importAttachments: async () => [],
    openPath: async () => undefined,
    showPath: async () => undefined,
  };
}
