import type {
  AgentResponse,
  AgentStreamEvent,
  Attachment,
  ComfyImage,
  ComfyImageSaveResult,
  ComfyQueueResponse,
  ArtifactItem,
  IdeogramEffort,
  ImageModel,
  ImageHistoryItem,
  MemoryStore,
  McpToolInfo,
  PluginDraft,
  ProviderHealth,
  ProjectTemplate,
  SearchProvider,
  SearchResult,
  Settings,
  TerminalResult,
  UpdateCheckResult,
  WorkspaceListResult,
  WorkspaceReadResult,
  WorkspaceWriteResult,
} from "./types";

export type CompactChatMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};

declare global {
  interface Window {
    localAgent: {
      getSettings: () => Promise<Settings>;
      saveSettings: (settings: Settings) => Promise<Settings>;
      checkProviders: () => Promise<ProviderHealth[]>;
      checkUpdates: () => Promise<UpdateCheckResult>;
      sendMessage: (payload: {
        messages: CompactChatMessage[];
        toolMode: "auto" | "web" | "none";
      }) => Promise<AgentResponse>;
      sendMessageStream: (
        payload: {
          messages: CompactChatMessage[];
          toolMode: "auto" | "web" | "none";
        },
        onEvent: (event: AgentStreamEvent) => void,
      ) => Promise<AgentResponse>;
      searchWeb: (payload: { query: string; provider?: SearchProvider }) => Promise<{
        provider: SearchProvider;
        results: SearchResult[];
      }>;
      queueComfy: (payload: {
        prompt: string;
        negativePrompt?: string;
        imageModel?: ImageModel;
        ideogramEffort?: IdeogramEffort;
        count?: number;
      }) => Promise<ComfyQueueResponse>;
      getComfyHistory: (payload: { promptId?: string }) => Promise<unknown>;
      getComfyImages: (payload: { promptId: string }) => Promise<{ promptId: string; images: ComfyImage[] }>;
      saveComfyImage: (payload: { image: ComfyImage }) => Promise<ComfyImageSaveResult>;
      getImageHistory: () => Promise<{ items: ImageHistoryItem[] }>;
      listMcpTools: () => Promise<{ tools: McpToolInfo[] }>;
      callMcpTool: (payload: { serverName: string; toolName: string; args?: Record<string, unknown> }) => Promise<unknown>;
      listMemory: () => Promise<MemoryStore>;
      addMemory: (payload: { content: string; source?: string }) => Promise<MemoryStore>;
      deleteMemory: (payload: { id: string }) => Promise<MemoryStore>;
      clearMemory: () => Promise<MemoryStore>;
      listArtifacts: () => Promise<{ root: string; artifacts: ArtifactItem[] }>;
      readArtifact: (payload: { id: string }) => Promise<ArtifactItem>;
      writeArtifact: (payload: { id?: string; name: string; kind: ArtifactItem["kind"]; content: string }) => Promise<{ root: string; artifact: ArtifactItem }>;
      appendArtifact: (payload: { id: string; content: string }) => Promise<{ root: string; artifact: ArtifactItem }>;
      listProjectTemplates: () => Promise<{ templates: ProjectTemplate[] }>;
      applyProjectTemplate: (payload: { templateId: string }) => Promise<{ template: ProjectTemplate; files: WorkspaceWriteResult[] }>;
      listExecutionLog: (payload?: { limit?: number }) => Promise<{ filePath: string; entries: import("./types").ExecutionLogEntry[] }>;
      listPluginDrafts: () => Promise<{ plugins: PluginDraft[] }>;
      installPluginFromUrl: (payload: { url: string }) => Promise<{ plugins: PluginDraft[] }>;
      runPluginAuth: (payload: { pluginId: string }) => Promise<{
        pluginId: string;
        label: string;
        ok: boolean;
        result: { exitCode: number; stdout: string; stderr: string; timedOut?: boolean };
        check?: { exitCode: number; stdout: string; stderr: string; timedOut?: boolean } | null;
        install?: { exitCode: number; stdout: string; stderr: string; timedOut?: boolean } | null;
        auth?: {
          provider?: string;
          account?: {
            id?: number | string;
            login?: string;
            name?: string;
            url?: string;
            avatarUrl?: string;
          } | null;
          expiresAt?: string;
        };
      }>;
      setPluginEnabled: (payload: { pluginId: string; enabled: boolean }) => Promise<{ plugins: PluginDraft[] }>;
      setPluginInstalled: (payload: { pluginId: string; installed: boolean }) => Promise<{ plugins: PluginDraft[] }>;
      runCommand: (payload: { command: string }) => Promise<TerminalResult>;
      listFiles: (payload?: { directory?: string; depth?: number }) => Promise<WorkspaceListResult>;
      readFile: (payload: { filePath: string }) => Promise<WorkspaceReadResult>;
      writeFile: (payload: { filePath: string; content: string; overwrite?: boolean }) => Promise<WorkspaceWriteResult>;
      appendFile: (payload: { filePath: string; content: string }) => Promise<WorkspaceWriteResult>;
      deleteFile: (payload: { filePath: string }) => Promise<{ root: string; relativePath: string; absolutePath: string }>;
      exportFile: (payload: { filePath: string }) => Promise<{ sourcePath: string; savedPath: string } | null>;
      exportChat: (payload: { version: number; exportedAt: string; messages: unknown[] }) => Promise<{ savedPath: string } | null>;
      importChat: () => Promise<{ sourcePath: string; data: unknown } | null>;
      chooseWorkspace: () => Promise<Settings | null>;
      chooseAttachments: () => Promise<Attachment[]>;
      importAttachments: (payload: {
        items: Array<{
          path?: string;
          name?: string;
          mimeType?: string;
          dataBase64?: string;
        }>;
      }) => Promise<Attachment[]>;
      openPath: (targetPath: string) => Promise<void>;
      showPath: (targetPath: string) => Promise<void>;
    };
  }
}

export {};
