export type ChatRole = "user" | "assistant";
export type LogLevel = "INFO" | "WARN" | "ERROR";
export type ToolMode = "auto" | "web" | "none";
export type SearchProvider = "auto" | "searxng" | "serpapi" | "ollama";
export type ThemeMode = "system" | "light" | "dark";
export type LanguageCode = "en" | "ru" | "uk" | "de" | "pl";
export type ThinkingMode = "off" | "low" | "medium" | "high";
export type LlmApiFormat = "ollama" | "openai-compatible";
export type BuiltInImageModel = "z-image-turbo" | "flux2-klein-9b" | "ideogram-v4";
export type ImageModel = BuiltInImageModel | string;
export type IdeogramEffort = "turbo" | "default" | "quality";
export type ToolPermission = "allow" | "ask" | "deny";
export type AgentPermissionProfile = "read-only" | "balanced" | "builder" | "full";

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  source: string;
}

export interface Attachment {
  id: string;
  name: string;
  path: string;
  mimeType: string;
  kind: "image" | "audio" | "video" | "text" | "file";
  size: number;
}

export interface WorkspaceFile {
  name: string;
  relativePath: string;
  absolutePath: string;
  type: "directory" | "file";
  size: number;
  modifiedAt: string;
  isText: boolean;
}

export interface WorkspaceListResult {
  root: string;
  directory: string;
  files: WorkspaceFile[];
}

export interface WorkspaceReadResult {
  root: string;
  relativePath: string;
  absolutePath: string;
  content: string;
  info: WorkspaceFile;
}

export interface WorkspaceWriteResult extends WorkspaceReadResult {}

export interface ToolResult {
  type: "search" | "comfy" | "terminal" | "file" | "database" | "mcp" | "update" | "memory" | "artifact";
  label: string;
  status?: "running" | "done" | "error";
  query?: string;
  results?: SearchResult[];
  payload?: any;
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
  toolResults?: ToolResult[];
  attachments?: Attachment[];
  thinking?: string;
  pending?: boolean;
  editedAt?: string;
}

export interface AppLog {
  id: string;
  time: string;
  level: LogLevel;
  source: string;
  message: string;
  durationMs?: number | null;
}

export interface ProviderHealth {
  id: string;
  name: string;
  kind: string;
  endpoint: string;
  status: "healthy" | "warning" | "error";
  latencyMs: number | null;
  details: string;
}

export interface Settings {
  version: number;
  workspacePath: string;
  setup: {
    firstLaunchComplete: boolean;
  };
  profile: {
    userName: string;
  };
  context: {
    includeLocalDateTime: boolean;
  };
  appearance: {
    theme: ThemeMode;
    language: LanguageCode;
  };
  agent: {
    maxWebSearches: number;
    maxImageJobs: number;
    maxToolSteps: number;
    taskQueue: boolean;
    permissionProfile: AgentPermissionProfile;
  };
  controlledExecution: {
    dryRun: boolean;
    sandboxPerTask: boolean;
    evaluatorPass: boolean;
    executionLog: boolean;
    approvalGates: {
      destructive: boolean;
      terminal: boolean;
      externalWrite: boolean;
      credentialUse: boolean;
      installs: boolean;
    };
  };
  memory: {
    enabled: boolean;
    autoRemember: boolean;
    maxEntries: number;
  };
  remoteProviders: {
    activePresetId: string;
    presets: RemoteProviderPreset[];
  };
  permissions: {
    files: ToolPermission;
    search: ToolPermission;
    images: ToolPermission;
    terminal: ToolPermission;
    database: ToolPermission;
    mcp: ToolPermission;
  };
  ollama: {
    baseUrl: string;
    model: string;
    apiKey: string;
    apiFormat: LlmApiFormat;
    thinking: ThinkingMode;
    temperature: number;
    contextTokens: number;
    timeoutMs: number;
  };
  search: {
    provider: SearchProvider;
    maxResults: number;
  };
  serpApi: {
    apiKey: string;
    engine: string;
    location: string;
  };
  ollamaSearch: {
    apiKey: string;
    maxResults: number;
  };
  searxng: {
    baseUrl: string;
  };
  runpod: {
    enabled: boolean;
    apiKey: string;
    endpointId: string;
    baseUrl: string;
    ollamaBaseUrl: string;
    comfyBaseUrl: string;
  };
  mcp: {
    enabled: boolean;
    timeoutMs: number;
    servers: McpServerConfig[];
  };
  updates: {
    enabled: boolean;
    checkOnStartup: boolean;
    repo: string;
    currentVersion: string;
    versionUrl: string;
  };
  comfy: {
    baseUrl: string;
    workflowPath: string;
    defaultCheckpoint: string;
    negativePrompt: string;
  };
  image: {
    model: ImageModel;
    repeat: number;
    ideogramEffort: IdeogramEffort;
    ideogramResolution: string;
    zImageCheckpoint: string;
    fluxCheckpoint: string;
    zImageWorkflowPath: string;
    fluxWorkflowPath: string;
    ideogramWorkflowPath: string;
    customModels: CustomImageModel[];
  };
  sandbox: {
    mode: "subprocess" | "docker";
    shell: "powershell" | "cmd" | "bash" | "zsh" | "sh";
    dockerImage: string;
    timeoutMs: number;
  };
}

export interface RemoteProviderPreset {
  id: string;
  label: string;
  description: string;
  kind: "llm" | "image" | "full";
  ollamaBaseUrl: string;
  comfyBaseUrl: string;
  apiKeyEnv?: string;
  apiFormat?: LlmApiFormat;
}

export interface ProjectTemplate {
  id: string;
  label: string;
  description: string;
  files: Array<{
    path: string;
    content: string;
  }>;
}

export interface PluginDraft {
  id: string;
  name?: string;
  label: string;
  description: string;
  status: "planned" | "draft" | "ready";
  version?: string;
  author?: string;
  publisher?: "official" | "community";
  homepage?: string;
  repository?: string;
  manifestUrl?: string;
  sourceUrl?: string;
  bannerUrl?: string;
  verifiedAt?: string;
  categories?: string[];
  capabilities?: string[];
  tools?: Array<{
    name: string;
    description?: string;
    inputSchema?: unknown;
  }>;
  mcpServers?: McpServerConfig[];
  auth?: {
    type: "browser_command" | "github_device_flow";
    label?: string;
    provider?: "github" | string;
    clientId?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    checkCommand?: string;
    checkArgs?: string[];
    requiredTools?: string[];
    autoInstall?: {
      windows?: {
        label?: string;
        command: string;
        args?: string[];
      };
    };
  };
  authState?: {
    signedIn: boolean;
    provider?: string;
    account?: {
      id?: number | string;
      login?: string;
      name?: string;
      url?: string;
      avatarUrl?: string;
    } | null;
    expiresAt?: string;
    updatedAt?: string;
  } | null;
  runtime?: unknown;
  prompts?: unknown[];
  settingsSchema?: unknown;
  readme?: string;
  permissions: string[];
  installed?: boolean;
  enabled?: boolean;
  trusted?: boolean;
}

export interface MemoryEntry {
  id: string;
  content: string;
  createdAt: string;
  source?: string;
}

export interface MemoryStore {
  entries: MemoryEntry[];
}

export interface ActivityEvent {
  id: string;
  time: string;
  title: string;
  detail?: string;
  status: "running" | "done" | "error" | "info";
  type: ToolResult["type"] | "agent";
}

export interface ExecutionLogEntry {
  id: string;
  time: string;
  event: string;
  model?: string;
  taskId?: string;
  action?: string;
  tool?: string;
  status?: string;
  workspacePath?: string;
  decision?: unknown;
  result?: unknown;
  reason?: string;
}

export interface ImageHistoryItem {
  id: string;
  createdAt: string;
  prompt: string;
  negativePrompt?: string;
  model: ImageModel;
  ideogramEffort?: IdeogramEffort;
  count: number;
  status: "queued" | "ready" | "error";
  promptIds: string[];
  images: ComfyImage[];
  error?: string;
}

export interface ArtifactItem {
  id: string;
  name: string;
  kind: "text" | "code" | "markdown" | "json" | "design" | "other";
  relativePath: string;
  absolutePath: string;
  createdAt: string;
  updatedAt: string;
  size: number;
  content?: string;
}

export interface CustomImageModel {
  id: string;
  label: string;
  workflowPath: string;
  checkpoint: string;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  enabled: boolean;
}

export interface McpToolInfo {
  serverName: string;
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface UpdateCheckResult {
  enabled: boolean;
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  url?: string;
  notes?: string;
  error?: string;
}

export interface AgentResponse {
  content: string;
  thinking?: string;
  model: string;
  metrics?: {
    totalDurationNs?: number;
    promptTokens?: number;
    completionTokens?: number;
  };
  toolResults?: ToolResult[];
}

export type AgentStreamEvent =
  | { type: "status"; message: string }
  | { type: "tool-start"; toolResult: ToolResult }
  | { type: "tool-finish"; toolResult: ToolResult }
  | { type: "thinking"; token: string }
  | { type: "token"; token: string }
  | { type: "done"; response: AgentResponse }
  | { type: "error"; message: string };

export interface TerminalResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ComfyQueueResponse {
  clientId: string;
  promptId?: string;
  number?: number;
  nodeErrors?: unknown;
  provider?: "comfy" | "ideogram";
  model?: ImageModel;
  count?: number;
  jobs?: Array<{
    clientId?: string;
    promptId?: string;
    number?: number;
    nodeErrors?: unknown;
    images?: Array<{
      url?: string;
      path?: string;
      seed?: number;
      resolution?: string;
      isSafe?: boolean;
    }>;
  }>;
}

export interface ComfyImage {
  nodeId?: string;
  filename: string;
  subfolder?: string;
  type?: string;
  url?: string;
}

export interface ComfyImageSaveResult {
  root: string;
  relativePath: string;
  absolutePath: string;
  size: number;
  source: ComfyImage;
}
