import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw, Save, X } from "lucide-react";
import { languageLabels } from "../i18n";
import type { AgentPermissionProfile, IdeogramEffort, ImageModel, LanguageCode, McpServerConfig, SearchProvider, Settings, ThemeMode, ThinkingMode, ToolPermission } from "../types";

interface SettingsDrawerProps {
  settings: Settings;
  onCancel: () => void;
  onSave: (settings: Settings) => Promise<void>;
  onChooseWorkspace: () => void;
  onRunSetupWizard: () => void;
}

function cloneSettings(settings: Settings): Settings {
  return JSON.parse(JSON.stringify(settings)) as Settings;
}

export function SettingsDrawer({ settings, onCancel, onSave, onChooseWorkspace, onRunSetupWizard }: SettingsDrawerProps) {
  const [draft, setDraft] = useState<Settings>(() => cloneSettings(settings));
  const [customModelsText, setCustomModelsText] = useState(() => JSON.stringify(settings.image.customModels || [], null, 2));
  const [mcpServersText, setMcpServersText] = useState(() => JSON.stringify(settings.mcp?.servers || [], null, 2));
  const [jsonError, setJsonError] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(cloneSettings(settings));
    setCustomModelsText(JSON.stringify(settings.image.customModels || [], null, 2));
    setMcpServersText(JSON.stringify(settings.mcp?.servers || [], null, 2));
  }, [settings]);

  function patch<T extends keyof Settings>(section: T, value: Partial<Settings[T]>) {
    setDraft((current) => ({
      ...current,
      [section]: {
        ...(current[section] as object),
        ...value,
      },
    }));
  }

  async function save() {
    setSaving(true);
    try {
      const customModels = JSON.parse(customModelsText || "[]");
      const mcpServers = JSON.parse(mcpServersText || "[]") as McpServerConfig[];
      setJsonError("");
      await onSave({
        ...draft,
        image: {
          ...draft.image,
          customModels,
        },
        mcp: {
          ...draft.mcp,
          servers: mcpServers,
        },
      });
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const permissionOptions: ToolPermission[] = ["allow", "ask", "deny"];

  async function checkUpdatesNow() {
    setUpdateStatus("Checking...");
    const result = await window.localAgent.checkUpdates();
    if (result.error) {
      setUpdateStatus(result.error);
    } else if (result.updateAvailable) {
      setUpdateStatus(`Update available: ${result.latestVersion} (${result.url || "release page"})`);
    } else {
      setUpdateStatus(`Up to date: ${result.currentVersion}`);
    }
  }

  return (
    <div className="drawer-backdrop">
      <aside className="settings-drawer">
        <div className="drawer-header">
          <div>
            <h2>Settings</h2>
          </div>
          <button className="icon-button" type="button" onClick={onCancel} aria-label="Close settings">
            <X size={18} />
          </button>
        </div>

        <div className="settings-sections">
          <section>
            <h3>Appearance</h3>
            <label>
              Your name
              <input value={draft.profile?.userName || ""} onChange={(event) => patch("profile", { userName: event.target.value })} />
            </label>
            <label>
              Theme
              <select value={draft.appearance.theme} onChange={(event) => patch("appearance", { theme: event.target.value as ThemeMode })}>
                <option value="system">system</option>
                <option value="light">light</option>
                <option value="dark">dark</option>
              </select>
            </label>
            <label>
              Language
              <select value={draft.appearance.language} onChange={(event) => patch("appearance", { language: event.target.value as LanguageCode })}>
                {(Object.keys(languageLabels) as LanguageCode[]).map((language) => (
                  <option key={language} value={language}>
                    {languageLabels[language]}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section>
            <h3>Workspace</h3>
            <label>
              Path
              <div className="field-row">
                <input value={draft.workspacePath} onChange={(event) => setDraft({ ...draft, workspacePath: event.target.value })} />
                <button className="quiet-button icon-text" type="button" onClick={onChooseWorkspace}>
                  <FolderOpen size={15} />
                  Browse
                </button>
              </div>
            </label>
            <button className="quiet-button icon-text" type="button" onClick={onRunSetupWizard}>
              <RefreshCw size={15} />
              Run setup wizard again
            </button>
            <p className="settings-note">Open the first-launch setup screen again without deleting your saved settings.</p>
          </section>

          <section>
            <h3>Local Context</h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.context?.includeLocalDateTime ?? true}
                onChange={(event) => patch("context", { includeLocalDateTime: event.target.checked })}
              />
              Share this PC date and time with the LLM
            </label>
            <p className="settings-note">The assistant will use your computer date/time for date awareness instead of guessing or searching for the date.</p>
          </section>

          <section>
            <h3>Agent Limits</h3>
            <div className="two-col">
              <label>
                Permission profile
                <select value={draft.agent.permissionProfile || "balanced"} onChange={(event) => patch("agent", { permissionProfile: event.target.value as AgentPermissionProfile })}>
                  <option value="read-only">read-only</option>
                  <option value="balanced">balanced</option>
                  <option value="builder">builder</option>
                  <option value="full">full</option>
                </select>
              </label>
              <label>
                Web searches
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={draft.agent.maxWebSearches}
                  onChange={(event) => patch("agent", { maxWebSearches: Number(event.target.value) })}
                />
              </label>
              <label>
                Image jobs
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={draft.agent.maxImageJobs}
                  onChange={(event) => patch("agent", { maxImageJobs: Number(event.target.value) })}
                />
              </label>
              <label>
                Tool steps
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={draft.agent.maxToolSteps}
                  onChange={(event) => patch("agent", { maxToolSteps: Number(event.target.value) })}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={draft.agent.taskQueue}
                  onChange={(event) => patch("agent", { taskQueue: event.target.checked })}
                />
                Agent task queue
              </label>
            </div>
          </section>

          <section>
            <h3>Controlled Execution</h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.controlledExecution?.dryRun ?? false}
                onChange={(event) => patch("controlledExecution", { dryRun: event.target.checked })}
              />
              Dry-run mode
            </label>
            <p className="settings-note">Show exact planned tool/file/API actions without executing them.</p>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.controlledExecution?.executionLog ?? true}
                onChange={(event) => patch("controlledExecution", { executionLog: event.target.checked })}
              />
              Execution log
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.controlledExecution?.sandboxPerTask ?? false}
                onChange={(event) => patch("controlledExecution", { sandboxPerTask: event.target.checked })}
              />
              Sandbox each task in <code>.las-tasks</code>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.controlledExecution?.evaluatorPass ?? false}
                onChange={(event) => patch("controlledExecution", { evaluatorPass: event.target.checked })}
              />
              Evaluator pass
            </label>
            <h4>Approval gates</h4>
            <div className="two-col">
              {(["destructive", "terminal", "externalWrite", "credentialUse", "installs"] as const).map((key) => (
                <label className="checkbox-label" key={key}>
                  <input
                    type="checkbox"
                    checked={draft.controlledExecution?.approvalGates?.[key] ?? true}
                    onChange={(event) =>
                      patch("controlledExecution", {
                        approvalGates: {
                          ...draft.controlledExecution.approvalGates,
                          [key]: event.target.checked,
                        },
                      })
                    }
                  />
                  {key}
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3>Personal Memory</h3>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.memory?.enabled ?? false}
                onChange={(event) => patch("memory", { enabled: event.target.checked })}
              />
              Enable memory between chats
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={draft.memory?.autoRemember ?? false}
                onChange={(event) => patch("memory", { autoRemember: event.target.checked })}
              />
              Let the agent suggest memory saves
            </label>
            <label>
              Max memory entries
              <input
                type="number"
                min="1"
                max="500"
                value={draft.memory?.maxEntries ?? 80}
                onChange={(event) => patch("memory", { maxEntries: Number(event.target.value) })}
              />
            </label>
            <p className="settings-note">Memory is stored in the app data folder and can be managed from Tools.</p>
          </section>

          <section>
            <h3>Tool Permissions</h3>
            <div className="two-col">
              {(Object.keys(draft.permissions) as Array<keyof Settings["permissions"]>).map((key) => (
                <label key={key}>
                  {key}
                  <select value={draft.permissions[key]} onChange={(event) => patch("permissions", { [key]: event.target.value as ToolPermission })}>
                    {permissionOptions.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </section>

          <section>
            <h3>LLM provider</h3>
            <label>
              Base URL
              <input value={draft.ollama.baseUrl} onChange={(event) => patch("ollama", { baseUrl: event.target.value })} />
            </label>
            <label>
              Model
              <input list="ollama-model-presets" value={draft.ollama.model} onChange={(event) => patch("ollama", { model: event.target.value })} />
              <datalist id="ollama-model-presets">
                <option value="auto" />
                <option value="gemma4:e2b" />
                <option value="gemma4:e4b" />
              </datalist>
            </label>
            <label>
              API key
              <input type="password" value={draft.ollama.apiKey} onChange={(event) => patch("ollama", { apiKey: event.target.value })} />
            </label>
            <label>
              Reasoning
              <select value={draft.ollama.thinking} onChange={(event) => patch("ollama", { thinking: event.target.value as ThinkingMode })}>
                <option value="off">off</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </select>
            </label>
            <div className="two-col">
              <label>
                Temperature
                <input
                  type="number"
                  min="0"
                  max="2"
                  step="0.05"
                  value={draft.ollama.temperature}
                  onChange={(event) => patch("ollama", { temperature: Number(event.target.value) })}
                />
              </label>
              <label>
                Context
                <input
                  type="number"
                  min="1024"
                  step="1024"
                  value={draft.ollama.contextTokens}
                  onChange={(event) => patch("ollama", { contextTokens: Number(event.target.value) })}
                />
              </label>
            </div>
          </section>

          <section>
            <h3>Search</h3>
            <label>
              Provider
              <select value={draft.search.provider} onChange={(event) => patch("search", { provider: event.target.value as SearchProvider })}>
                <option value="auto">auto</option>
                <option value="searxng">SearXNG</option>
                <option value="serpapi">SerpAPI</option>
                <option value="ollama">Ollama Web Search</option>
              </select>
            </label>
            <label>
              SearXNG URL
              <input value={draft.searxng.baseUrl} onChange={(event) => patch("searxng", { baseUrl: event.target.value })} />
            </label>
            <label>
              SerpAPI key
              <input type="password" value={draft.serpApi.apiKey} onChange={(event) => patch("serpApi", { apiKey: event.target.value })} />
            </label>
            <label>
              Ollama search key
              <input
                type="password"
                value={draft.ollamaSearch.apiKey}
                onChange={(event) => patch("ollamaSearch", { apiKey: event.target.value })}
              />
            </label>
          </section>

          <section>
            <h3>Runpod</h3>
            <label className="checkbox-label">
              <input type="checkbox" checked={draft.runpod.enabled} onChange={(event) => patch("runpod", { enabled: event.target.checked })} />
              Enable Runpod provider
            </label>
            <label>
              API key
              <input type="password" value={draft.runpod.apiKey} onChange={(event) => patch("runpod", { apiKey: event.target.value })} />
            </label>
            <label>
              Endpoint ID
              <input value={draft.runpod.endpointId} onChange={(event) => patch("runpod", { endpointId: event.target.value })} />
            </label>
            <label>
              Base URL
              <input value={draft.runpod.baseUrl} onChange={(event) => patch("runpod", { baseUrl: event.target.value })} />
            </label>
            <label>
              Ollama-compatible URL
              <input value={draft.runpod.ollamaBaseUrl} onChange={(event) => patch("runpod", { ollamaBaseUrl: event.target.value })} />
            </label>
            <label>
              ComfyUI URL
              <input value={draft.runpod.comfyBaseUrl} onChange={(event) => patch("runpod", { comfyBaseUrl: event.target.value })} />
            </label>
          </section>

          <section>
            <h3>MCP</h3>
            <label className="checkbox-label">
              <input type="checkbox" checked={draft.mcp.enabled} onChange={(event) => patch("mcp", { enabled: event.target.checked })} />
              Enable MCP tools
            </label>
            <label>
              Timeout ms
              <input type="number" min="1000" step="1000" value={draft.mcp.timeoutMs} onChange={(event) => patch("mcp", { timeoutMs: Number(event.target.value) })} />
            </label>
            <label>
              Servers JSON
              <textarea rows={8} value={mcpServersText} onChange={(event) => setMcpServersText(event.target.value)} spellCheck={false} />
            </label>
          </section>

          <section>
            <h3>ComfyUI</h3>
            <label>
              Base URL
              <input value={draft.comfy.baseUrl} onChange={(event) => patch("comfy", { baseUrl: event.target.value })} />
            </label>
            <label>
              Legacy fallback workflow JSON path
              <input value={draft.comfy.workflowPath} onChange={(event) => patch("comfy", { workflowPath: event.target.value })} />
            </label>
            <label>
              Checkpoint
              <input value={draft.comfy.defaultCheckpoint} onChange={(event) => patch("comfy", { defaultCheckpoint: event.target.value })} />
            </label>
            <label>
              Negative prompt
              <textarea value={draft.comfy.negativePrompt} rows={3} onChange={(event) => patch("comfy", { negativePrompt: event.target.value })} />
            </label>
          </section>

          <section>
            <h3>Image Models</h3>
            <label>
              Default model
              <select value={draft.image.model} onChange={(event) => patch("image", { model: event.target.value as ImageModel })}>
                <option value="z-image-turbo">Z-Image-Turbo</option>
                <option value="flux2-klein-9b">Flux.2 klein 9b</option>
                <option value="ideogram-v4">Ideogram v4</option>
              </select>
            </label>
            <div className="two-col">
              <label>
                Repeat
                <input
                  type="number"
                  min="1"
                  max="3"
                  value={draft.image.repeat}
                  onChange={(event) => patch("image", { repeat: Number(event.target.value) })}
                />
              </label>
              <label>
                Ideogram effort
                <select value={draft.image.ideogramEffort} onChange={(event) => patch("image", { ideogramEffort: event.target.value as IdeogramEffort })}>
                  <option value="turbo">turbo</option>
                  <option value="default">default</option>
                  <option value="quality">quality</option>
                </select>
              </label>
            </div>
            <label>
              Resolution
              <input value={draft.image.ideogramResolution} onChange={(event) => patch("image", { ideogramResolution: event.target.value })} />
            </label>
            <label>
              Z-Image checkpoint
              <input value={draft.image.zImageCheckpoint} onChange={(event) => patch("image", { zImageCheckpoint: event.target.value })} />
            </label>
            <label>
              Flux checkpoint
              <input value={draft.image.fluxCheckpoint} onChange={(event) => patch("image", { fluxCheckpoint: event.target.value })} />
            </label>
            <label>
              Z-Image workflow
              <input value={draft.image.zImageWorkflowPath} onChange={(event) => patch("image", { zImageWorkflowPath: event.target.value })} />
            </label>
            <label>
              Flux workflow
              <input value={draft.image.fluxWorkflowPath} onChange={(event) => patch("image", { fluxWorkflowPath: event.target.value })} />
            </label>
            <label>
              Ideogram v4 workflow
              <input value={draft.image.ideogramWorkflowPath} onChange={(event) => patch("image", { ideogramWorkflowPath: event.target.value })} />
            </label>
            <label>
              Custom models JSON
              <textarea rows={8} value={customModelsText} onChange={(event) => setCustomModelsText(event.target.value)} spellCheck={false} />
            </label>
          </section>

          <section>
            <h3>Sandbox</h3>
            <label>
              Mode
              <select value={draft.sandbox.mode} onChange={(event) => patch("sandbox", { mode: event.target.value as Settings["sandbox"]["mode"] })}>
                <option value="subprocess">subprocess</option>
                <option value="docker">docker</option>
              </select>
            </label>
            <label>
              Subprocess shell
              <select value={draft.sandbox.shell} onChange={(event) => patch("sandbox", { shell: event.target.value as Settings["sandbox"]["shell"] })}>
                <option value="powershell">PowerShell</option>
                <option value="cmd">cmd.exe</option>
                <option value="bash">bash</option>
                <option value="zsh">zsh</option>
                <option value="sh">sh</option>
              </select>
            </label>
            <label>
              Docker image
              <input value={draft.sandbox.dockerImage} onChange={(event) => patch("sandbox", { dockerImage: event.target.value })} />
            </label>
          </section>

          <section>
            <h3>Updates</h3>
            <label className="checkbox-label">
              <input type="checkbox" checked={draft.updates.enabled} onChange={(event) => patch("updates", { enabled: event.target.checked })} />
              Enable update checks
            </label>
            <label>
              GitHub repo
              <input value={draft.updates.repo} onChange={(event) => patch("updates", { repo: event.target.value })} />
            </label>
            <label>
              Version file URL
              <input value={draft.updates.versionUrl} onChange={(event) => patch("updates", { versionUrl: event.target.value })} />
            </label>
            <label>
              Current version
              <input value={draft.updates.currentVersion} onChange={(event) => patch("updates", { currentVersion: event.target.value })} disabled />
            </label>
            <button className="quiet-button icon-text" type="button" onClick={checkUpdatesNow}>
              <RefreshCw size={15} />
              Check for update
            </button>
            {updateStatus ? <span className="workspace-status">{updateStatus}</span> : null}
          </section>
        </div>

        <div className="drawer-footer">
          {jsonError ? <span className="settings-error">{jsonError}</span> : null}
          <button className="quiet-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="button" onClick={save} disabled={saving}>
            <Save size={15} />
            Save
          </button>
        </div>
      </aside>
    </div>
  );
}
