import { useEffect, useMemo, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, FolderOpen, Save, Search, UserRound, Zap } from "lucide-react";
import type { RemoteProviderPreset, SearchProvider, Settings } from "../types";

interface SetupWizardProps {
  settings: Settings;
  onChooseWorkspace: () => Promise<void>;
  onFinish: (settings: Settings) => Promise<void>;
}

const steps = ["Workspace", "Provider", "Search", "Profile"];

function applyPresetToSettings(settings: Settings, preset: RemoteProviderPreset): Settings {
  return {
    ...settings,
    remoteProviders: {
      ...settings.remoteProviders,
      activePresetId: preset.id,
    },
    runpod: {
      ...settings.runpod,
      enabled: false,
    },
    ollama: {
      ...settings.ollama,
      baseUrl: preset.ollamaBaseUrl || settings.ollama.baseUrl,
      apiFormat: preset.apiFormat || "ollama",
    },
    comfy: {
      ...settings.comfy,
      baseUrl: preset.comfyBaseUrl || settings.comfy.baseUrl,
    },
  };
}

export function SetupWizard({ settings, onChooseWorkspace, onFinish }: SetupWizardProps) {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState(settings);
  const activePreset = useMemo(
    () => draft.remoteProviders?.presets?.find((preset) => preset.id === draft.remoteProviders.activePresetId) || draft.remoteProviders?.presets?.[0],
    [draft.remoteProviders],
  );

  useEffect(() => {
    setDraft(settings);
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

  async function finish() {
    await onFinish({
      ...draft,
      setup: {
        ...draft.setup,
        firstLaunchComplete: true,
      },
    });
  }

  return (
    <div className="setup-screen">
      <section className="setup-panel setup-panel-wide">
        <div className="setup-topline">
          <div className="setup-mark">
            <Bot size={28} />
          </div>
          <div>
            <h1>Set up Local Agent Studio</h1>
            <p>{steps[step]} setup</p>
          </div>
        </div>

        <div className="setup-progress">
          {steps.map((label, index) => (
            <button className={index === step ? "setup-step active" : index < step ? "setup-step done" : "setup-step"} type="button" key={label} onClick={() => setStep(index)}>
              <span>{index + 1}</span>
              {label}
            </button>
          ))}
        </div>

        {step === 0 ? (
          <div className="setup-page">
            <p>Choose where the agent can create, edit, preview, and download files.</p>
            <div className="setup-workspace">
              <span>Workspace</span>
              <strong>{draft.workspacePath}</strong>
              <button className="quiet-button icon-text" type="button" onClick={onChooseWorkspace}>
                <FolderOpen size={15} />
                Choose folder
              </button>
            </div>
            <label className="setup-option">
              <input
                type="checkbox"
                checked={draft.context?.includeLocalDateTime ?? true}
                onChange={(event) => patch("context", { includeLocalDateTime: event.target.checked })}
              />
              <span>
                <strong>Share this PC date and time with the LLM</strong>
                <small>The assistant will know today from your computer instead of guessing or searching for the date.</small>
              </span>
            </label>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="setup-page">
            <div className="setup-section-title">
              <Zap size={17} />
              <strong>Choose provider and model</strong>
            </div>
            <div className="setup-provider-grid">
              {(draft.remoteProviders?.presets || []).map((preset) => (
                <button
                  className={activePreset?.id === preset.id ? "setup-provider-card active" : "setup-provider-card"}
                  type="button"
                  key={preset.id}
                  onClick={() => setDraft((current) => applyPresetToSettings(current, preset))}
                >
                  <strong>{preset.label}</strong>
                  <span>{preset.description}</span>
                  <small>{preset.kind}</small>
                </button>
              ))}
            </div>
            <div className="two-col">
              <label>
                Provider URL
                <input value={draft.ollama.baseUrl} onChange={(event) => patch("ollama", { baseUrl: event.target.value })} />
              </label>
              <label>
                Model
                <input value={draft.ollama.model} onChange={(event) => patch("ollama", { model: event.target.value })} placeholder="auto, llama-3.2, qwen..." />
              </label>
              <label>
                API key
                <input type="password" value={draft.ollama.apiKey} onChange={(event) => patch("ollama", { apiKey: event.target.value })} />
              </label>
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="setup-page">
            <div className="setup-section-title">
              <Search size={17} />
              <strong>Choose search provider</strong>
            </div>
            <div className="two-col">
              <label>
                Search provider
                <select value={draft.search.provider} onChange={(event) => patch("search", { provider: event.target.value as SearchProvider })}>
                  <option value="searxng">SearXNG</option>
                  <option value="serpapi">SerpAPI</option>
                  <option value="ollama">Ollama Web Search</option>
                  <option value="auto">Auto</option>
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
                Ollama Web Search key
                <input type="password" value={draft.ollamaSearch.apiKey} onChange={(event) => patch("ollamaSearch", { apiKey: event.target.value })} />
              </label>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="setup-page">
            <div className="setup-section-title">
              <UserRound size={17} />
              <strong>Personalization and memory</strong>
            </div>
            <label>
              What should the assistant call you?
              <input value={draft.profile?.userName || ""} onChange={(event) => patch("profile", { userName: event.target.value })} placeholder="Anatoly" />
            </label>
            <label className="setup-option">
              <input type="checkbox" checked={draft.memory?.enabled ?? false} onChange={(event) => patch("memory", { enabled: event.target.checked })} />
              <span>
                <strong>Enable personal memory between chats</strong>
                <small>Memory is stored locally in the app data folder and can be managed from Tools.</small>
              </span>
            </label>
            <label className="setup-option">
              <input type="checkbox" checked={draft.memory?.autoRemember ?? false} onChange={(event) => patch("memory", { autoRemember: event.target.checked })} />
              <span>
                <strong>Allow auto-remember suggestions</strong>
                <small>The agent may save stable preferences when it is clearly useful for future chats.</small>
              </span>
            </label>
          </div>
        ) : null}

        <div className="setup-actions split">
          <button className="quiet-button" type="button" onClick={finish}>
            Skip
          </button>
          <div>
            <button className="quiet-button icon-text" type="button" onClick={() => setStep((current) => Math.max(0, current - 1))} disabled={step === 0}>
              <ChevronLeft size={15} />
              Back
            </button>
            {step < steps.length - 1 ? (
              <button className="primary-button" type="button" onClick={() => setStep((current) => Math.min(steps.length - 1, current + 1))}>
                Next
                <ChevronRight size={15} />
              </button>
            ) : (
              <button className="primary-button" type="button" onClick={finish}>
                <Save size={15} />
                Launch
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
