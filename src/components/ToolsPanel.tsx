import { useCallback, useEffect, useMemo, useState } from "react";
import { Brain, Cloud, DownloadCloud, Layers3, ListChecks, Plug, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import type { ExecutionLogEntry, McpToolInfo, MemoryEntry, ProjectTemplate, RemoteProviderPreset, Settings } from "../types";

interface ToolsPanelProps {
  settings: Settings | null;
  onSaveSettings: (settings: Settings) => Promise<void>;
  onOpenSettings: () => void;
}

function groupTools(tools: McpToolInfo[]) {
  const grouped = new Map<string, McpToolInfo[]>();
  for (const tool of tools) {
    const server = tool.serverName || "default";
    grouped.set(server, [...(grouped.get(server) || []), tool]);
  }
  return Array.from(grouped.entries());
}

export function ToolsPanel({ settings, onSaveSettings, onOpenSettings }: ToolsPanelProps) {
  const [mcpTools, setMcpTools] = useState<McpToolInfo[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [memory, setMemory] = useState<MemoryEntry[]>([]);
  const [executionLog, setExecutionLog] = useState<ExecutionLogEntry[]>([]);
  const [executionLogPath, setExecutionLogPath] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [toolArgs, setToolArgs] = useState("{}");
  const [selectedTool, setSelectedTool] = useState<McpToolInfo | null>(null);
  const [status, setStatus] = useState("");

  const presets = useMemo(() => settings?.remoteProviders?.presets || [], [settings?.remoteProviders?.presets]);

  const refresh = useCallback(async () => {
    const [toolResult, templateResult, memoryResult, logResult] = await Promise.all([
      window.localAgent.listMcpTools().catch(() => ({ tools: [] })),
      window.localAgent.listProjectTemplates(),
      window.localAgent.listMemory(),
      window.localAgent.listExecutionLog({ limit: 80 }).catch(() => ({ filePath: "", entries: [] })),
    ]);
    setMcpTools(toolResult.tools || []);
    setTemplates(templateResult.templates || []);
    setMemory(memoryResult.entries || []);
    setExecutionLog(logResult.entries || []);
    setExecutionLogPath(logResult.filePath || "");
  }, []);

  useEffect(() => {
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [refresh]);

  async function applyPreset(preset: RemoteProviderPreset) {
    if (!settings) {
      return;
    }
    await onSaveSettings({
      ...settings,
      remoteProviders: {
        ...settings.remoteProviders,
        activePresetId: preset.id,
      },
      runpod: {
        ...settings.runpod,
        enabled: false,
        ollamaBaseUrl: preset.ollamaBaseUrl || settings.runpod.ollamaBaseUrl,
        comfyBaseUrl: preset.comfyBaseUrl || settings.runpod.comfyBaseUrl,
      },
      ollama: {
        ...settings.ollama,
        baseUrl: preset.ollamaBaseUrl || settings.ollama.baseUrl,
        apiFormat: preset.apiFormat || settings.ollama.apiFormat,
      },
      comfy: {
        ...settings.comfy,
        baseUrl: preset.comfyBaseUrl || settings.comfy.baseUrl,
      },
    });
    setStatus(`Applied provider preset: ${preset.label}`);
  }

  async function toggleMemory(enabled: boolean) {
    if (!settings) {
      return;
    }
    await onSaveSettings({
      ...settings,
      memory: {
        ...settings.memory,
        enabled,
      },
    });
  }

  async function addMemory() {
    if (!memoryDraft.trim()) {
      return;
    }
    const result = await window.localAgent.addMemory({ content: memoryDraft, source: "manual" });
    setMemory(result.entries);
    setMemoryDraft("");
  }

  async function runMcpTool() {
    if (!selectedTool) {
      return;
    }
    setStatus("Running MCP tool...");
    const parsed = JSON.parse(toolArgs || "{}");
    const result = await window.localAgent.callMcpTool({
      serverName: selectedTool.serverName,
      toolName: selectedTool.name,
      args: parsed,
    });
    setStatus(JSON.stringify(result, null, 2).slice(0, 1200));
  }

  async function applyTemplate(template: ProjectTemplate) {
    const result = await window.localAgent.applyProjectTemplate({ templateId: template.id });
    setStatus(`Created ${result.files.length} file(s) for ${template.label}.`);
  }

  return (
    <section className="tools-view">
      <header className="workspace-header">
        <div>
          <h1>Tools</h1>
          <button className="link-button" type="button" onClick={onOpenSettings}>
            Provider presets, MCP tools, templates, memory, and task queue
          </button>
        </div>
        <button className="quiet-button icon-text" type="button" onClick={refresh}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </header>

      <div className="tools-grid">
        <section className="tool-panel wide">
          <div className="tool-panel-title">
            <Cloud size={17} />
            Provider presets
          </div>
          <div className="preset-grid">
            {presets.map((preset) => (
              <button
                className={settings?.remoteProviders?.activePresetId === preset.id ? "preset-card active" : "preset-card"}
                type="button"
                key={preset.id}
                onClick={() => applyPreset(preset)}
              >
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
                <small>{preset.kind}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="tool-panel">
          <div className="tool-panel-title">
            <Plug size={17} />
            MCP tools
          </div>
          <div className="mcp-tool-list">
            {groupTools(mcpTools).length ? (
              groupTools(mcpTools).map(([server, tools]) => (
                <div key={server} className="mcp-server-group">
                  <strong>{server}</strong>
                  {tools.map((tool) => (
                    <button className={selectedTool?.name === tool.name && selectedTool.serverName === tool.serverName ? "mcp-tool active" : "mcp-tool"} type="button" key={`${tool.serverName}-${tool.name}`} onClick={() => setSelectedTool(tool)}>
                      <span>{tool.name}</span>
                      <small>{tool.description || "No description"}</small>
                    </button>
                  ))}
                </div>
              ))
            ) : (
              <p className="settings-note">No MCP tools available. Enable MCP servers in Settings.</p>
            )}
          </div>
          {selectedTool ? (
            <div className="tool-runner">
              <textarea value={toolArgs} rows={4} onChange={(event) => setToolArgs(event.target.value)} spellCheck={false} />
              <button className="primary-button" type="button" onClick={runMcpTool}>
                <Plug size={15} />
                Run tool
              </button>
            </div>
          ) : null}
        </section>

        <section className="tool-panel">
          <div className="tool-panel-title">
            <Layers3 size={17} />
            Project templates
          </div>
          <div className="template-grid">
            {templates.map((template) => (
              <button className="template-card" type="button" key={template.id} onClick={() => applyTemplate(template)}>
                <strong>{template.label}</strong>
                <span>{template.description}</span>
                <small>{template.files.length} starter files</small>
              </button>
            ))}
          </div>
        </section>

        <section className="tool-panel">
          <div className="tool-panel-title">
            <Brain size={17} />
            Personal memory
          </div>
          <label className="checkbox-label">
            <input type="checkbox" checked={Boolean(settings?.memory?.enabled)} onChange={(event) => toggleMemory(event.target.checked)} />
            Enable memory between chats
          </label>
          <div className="memory-compose">
            <textarea value={memoryDraft} rows={3} onChange={(event) => setMemoryDraft(event.target.value)} placeholder="Remember that..." />
            <button className="quiet-button icon-text" type="button" onClick={addMemory}>
              <Save size={15} />
              Save memory
            </button>
          </div>
          <div className="memory-list">
            {memory.map((entry) => (
              <div className="memory-row" key={entry.id}>
                <span>{entry.content}</span>
                <button
                  type="button"
                  onClick={async () => {
                    const result = await window.localAgent.deleteMemory({ id: entry.id });
                    setMemory(result.entries);
                  }}
                  aria-label="Delete memory"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="tool-panel">
          <div className="tool-panel-title">
            <Sparkles size={17} />
            Task queue
          </div>
          <p className="settings-note">Agent task queue is {settings?.agent?.taskQueue ? "enabled" : "disabled"}. Queued prompts are processed after the current response finishes.</p>
          <button
            className="quiet-button icon-text"
            type="button"
            onClick={() =>
              settings &&
              onSaveSettings({
                ...settings,
                agent: {
                  ...settings.agent,
                  taskQueue: !settings.agent.taskQueue,
                },
              })
            }
          >
            <DownloadCloud size={15} />
            Toggle queue
          </button>
        </section>

        <section className="tool-panel wide">
          <div className="tool-panel-title">
            <ListChecks size={17} />
            Execution log
          </div>
          <p className="settings-note">Auditable record of model selection, tool decisions, workspace scope, approval gates, and results.</p>
          {executionLogPath ? <p className="settings-note">Stored at <code>{executionLogPath}</code></p> : null}
          <div className="execution-log-list">
            {executionLog.length ? (
              executionLog.map((entry) => (
                <div className="execution-log-row" key={entry.id}>
                  <strong>{entry.event}</strong>
                  <span>{new Date(entry.time).toLocaleString()}</span>
                  <small>{[entry.model, entry.action, entry.tool, entry.status, entry.reason].filter(Boolean).join(" | ")}</small>
                  {entry.workspacePath ? <code>{entry.workspacePath}</code> : null}
                </div>
              ))
            ) : (
              <p className="settings-note">No execution log entries yet.</p>
            )}
          </div>
        </section>
      </div>

      {status ? <pre className="tool-status-output">{status}</pre> : null}
    </section>
  );
}
