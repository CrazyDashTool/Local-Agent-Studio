import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Brain,
  Check,
  ChevronDown,
  Copy,
  Database,
  Download,
  FileText,
  FolderOpen,
  Globe2,
  Image,
  KeyRound,
  Mic,
  Paperclip,
  Pencil,
  Plug,
  Search,
  Send,
  Settings as SettingsIcon,
  Terminal,
  Type,
  User,
  X,
} from "lucide-react";
import { languageLabels, t } from "../i18n";
import { MarkdownMessage } from "./MarkdownMessage";
import type { Attachment, ChatMessage, ComfyImage, IdeogramEffort, ImageModel, Settings, ToolMode, ToolResult } from "../types";

interface ChatWorkspaceProps {
  messages: ChatMessage[];
  busy: boolean;
  toolMode: ToolMode;
  settings: Settings | null;
  onToolModeChange: (mode: ToolMode) => void;
  onImageSettingsChange: (patch: Partial<Settings["image"]>) => void;
  onOllamaModelChange: (model: string) => void;
  onThinkingChange: (thinking: Settings["ollama"]["thinking"]) => void;
  onEditUserMessage: (messageId: string, content: string) => void;
  onSend: (message: string, attachments: Attachment[]) => void;
  onChooseWorkspace: () => void;
  onOpenSettings: () => void;
  queueEnabled: boolean;
  queueLength: number;
}

const imageModelLabels: Record<string, string> = {
  "z-image-turbo": "Z-Image-Turbo",
  "flux2-klein-9b": "Flux.2 klein 9b",
  "ideogram-v4": "Ideogram v4",
};

const ollamaModelPresets = ["auto", "gemma4:e2b", "gemma4:e4b"];
const thinkingLabels: Record<string, string> = {
  off: "Reasoning off",
  low: "Low",
  medium: "Medium",
  high: "High",
};

interface LASSelectOption {
  value: string;
  label: string;
}

interface LASSelectProps {
  id: string;
  icon?: ReactNode;
  value: string;
  options: LASSelectOption[];
  disabled?: boolean;
  openId: string | null;
  setOpenId: (id: string | null) => void;
  onChange: (value: string) => void;
  ariaLabel: string;
}

function LASSelect({ id, icon, value, options, disabled, openId, setOpenId, onChange, ariaLabel }: LASSelectProps) {
  const open = openId === id;
  const selected = options.find((option) => option.value === value) || options[0];

  return (
    <div className={`las-select ${open ? "open" : ""}`}>
      <button
        className="las-select-trigger"
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-expanded={open}
        onClick={() => setOpenId(open ? null : id)}
      >
        {icon ? <span className="las-select-icon">{icon}</span> : null}
        <span>{selected?.label || value}</span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="las-select-menu" role="listbox">
          {options.map((option) => (
            <button
              className={option.value === value ? "las-select-option active" : "las-select-option"}
              type="button"
              key={option.value}
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpenId(null);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={14} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MessageIcon({ role }: { role: ChatMessage["role"] }) {
  return <span className={`message-icon ${role}`}>{role === "assistant" ? <Bot size={17} /> : <User size={17} />}</span>;
}

function iconForTool(tool: ToolResult) {
  if (tool.type === "search") {
    return <Search size={13} />;
  }
  if (tool.type === "comfy") {
    return <Image size={13} />;
  }
  if (tool.type === "terminal") {
    return <Terminal size={13} />;
  }
  if (tool.type === "database") {
    return <Database size={13} />;
  }
  if (tool.type === "mcp") {
    return <Plug size={13} />;
  }
  if (tool.type === "memory") {
    return <Brain size={13} />;
  }
  if (tool.type === "artifact") {
    return <FileText size={13} />;
  }
  return <FileText size={13} />;
}

function imageSrc(pathOrUrl?: string) {
  if (!pathOrUrl) {
    return "";
  }
  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }
  return `file:///${pathOrUrl.replace(/\\/g, "/")}`;
}

async function fileToAttachmentItem(file: File) {
  const fileWithPath = file as File & { path?: string };
  if (fileWithPath.path) {
    return {
      path: fileWithPath.path,
      name: file.name,
      mimeType: file.type,
    };
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return {
    name: file.name || `clipboard-${Date.now()}.png`,
    mimeType: file.type || "application/octet-stream",
    dataBase64: btoa(binary),
  };
}

function getPayloadJobs(tool: ToolResult) {
  return (tool.payload?.jobs || []) as Array<{
    promptId?: string;
    number?: number;
    images?: Array<ComfyImage & { path?: string; resolution?: string; isSafe?: boolean }>;
  }>;
}

function AttachmentChips({ attachments, onRemove }: { attachments: Attachment[]; onRemove?: (id: string) => void }) {
  if (!attachments.length) {
    return null;
  }

  return (
    <div className="attachment-row">
      {attachments.map((attachment) => (
        <span className="attachment-chip" key={attachment.id} title={attachment.path}>
          {attachment.kind === "image" ? <Image size={13} /> : attachment.kind === "audio" || attachment.kind === "video" ? <Paperclip size={13} /> : <FileText size={13} />}
          {attachment.name}
          {onRemove ? (
            <button type="button" onClick={() => onRemove(attachment.id)} aria-label={`Remove ${attachment.name}`}>
              <X size={12} />
            </button>
          ) : null}
        </span>
      ))}
    </div>
  );
}

function ToolResultDetails({ tool, language }: { tool: ToolResult; language: Settings["appearance"]["language"] }) {
  const [loadedImages, setLoadedImages] = useState<Record<string, ComfyImage[]>>({});
  const [savedImages, setSavedImages] = useState<Record<string, string>>({});
  const [imageStatus, setImageStatus] = useState<Record<string, string>>({});
  const [authStatus, setAuthStatus] = useState("");

  async function loadComfyImages(promptId: string) {
    setImageStatus((current) => ({ ...current, [promptId]: "Loading..." }));
    try {
      const result = await window.localAgent.getComfyImages({ promptId });
      setLoadedImages((current) => ({ ...current, [promptId]: result.images || [] }));
      setImageStatus((current) => ({ ...current, [promptId]: result.images?.length ? "" : "No finished images yet" }));
    } catch (error) {
      setImageStatus((current) => ({ ...current, [promptId]: error instanceof Error ? error.message : String(error) }));
    }
  }

  async function saveComfyImage(image: ComfyImage) {
    const key = `${image.type || "output"}/${image.subfolder || ""}/${image.filename}`;
    setSavedImages((current) => ({ ...current, [key]: "Saving..." }));
    try {
      const result = await window.localAgent.saveComfyImage({ image });
      setSavedImages((current) => ({ ...current, [key]: result.relativePath }));
    } catch (error) {
      setSavedImages((current) => ({ ...current, [key]: error instanceof Error ? error.message : String(error) }));
    }
  }

  if (tool.type === "search" && tool.results?.length) {
    return (
      <details className="tool-details">
        <summary>
          {t(language, "sources")} {tool.query ? `- "${tool.query}"` : ""} · {tool.results.length}
        </summary>
        <div className="source-list">
          {tool.results.slice(0, 8).map((result, index) => (
            <a key={`${result.url}-${index}`} href={result.url} target="_blank" rel="noreferrer">
              <span>{index + 1}</span>
              <strong>{result.title}</strong>
              <small>{result.source}</small>
            </a>
          ))}
        </div>
      </details>
    );
  }

  if (tool.type === "comfy") {
    const jobs = getPayloadJobs(tool);
    return (
      <details className="tool-details" open>
        <summary>{tool.label}</summary>
        <div className="image-job-list">
          {jobs.map((job, index) => {
            const images = [...(job.images || []), ...(job.promptId ? loadedImages[job.promptId] || [] : [])];
            return (
              <div className="image-job" key={`${job.promptId || "image"}-${index}`}>
                {job.promptId ? <code>{job.promptId}</code> : <strong>Image job {index + 1}</strong>}
                {typeof job.number === "number" ? <span>Queue #{job.number}</span> : null}
                {job.promptId ? (
                  <div className="image-actions">
                    <button className="tiny-button" type="button" onClick={() => loadComfyImages(job.promptId!)}>
                      <Image size={13} />
                      Load images
                    </button>
                    {imageStatus[job.promptId] ? <span>{imageStatus[job.promptId]}</span> : null}
                  </div>
                ) : null}
                {images.length ? (
                  <div className="generated-grid">
                    {images.map((item, imageIndex) => {
                      const imageItem = item as ComfyImage & { path?: string; resolution?: string };
                      const key = `${item.type || "output"}/${item.subfolder || ""}/${item.filename || item.url || imageIndex}`;
                      return (
                        <div className="generated-image-card" key={key}>
                          <a href={imageItem.url || imageSrc(imageItem.path)} target="_blank" rel="noreferrer">
                            <img src={imageSrc(imageItem.path || imageItem.url)} alt={`Generated ${imageIndex + 1}`} />
                            <span>{imageItem.filename || imageItem.resolution || "generated"}</span>
                          </a>
                          {imageItem.filename ? (
                            <button className="tiny-button" type="button" onClick={() => saveComfyImage(imageItem)}>
                              <Download size={13} />
                              Download
                            </button>
                          ) : null}
                          {savedImages[key] ? <small>{savedImages[key]}</small> : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </details>
    );
  }

  if (tool.type === "file" || tool.type === "database") {
    const payload = tool.payload || {};
    const paths = [
      payload.relativePath,
      payload.jsonRelativePath,
      payload.csvRelativePath,
      payload.sqliteRelativePath,
    ].filter(Boolean);
    return (
      <details className="tool-details" open>
        <summary>{tool.label}</summary>
        <div className="file-result-list">
          {paths.length ? paths.map((item: string) => <code key={item}>{item}</code>) : <span>{tool.status}</span>}
          {payload.absolutePath || payload.jsonPath ? (
            <button className="tiny-button" type="button" onClick={() => window.localAgent.showPath(payload.absolutePath || payload.jsonPath)}>
              <FolderOpen size={13} />
              Show
            </button>
          ) : null}
        </div>
      </details>
    );
  }

  if (tool.type === "artifact" || tool.type === "memory" || tool.type === "mcp") {
    const payload = tool.payload || {};
    async function signInPlugin() {
      if (!payload.pluginId) {
        return;
      }
      setAuthStatus(`Starting ${payload.authLabel || "Sign in"}...`);
      try {
        const result = await window.localAgent.runPluginAuth({ pluginId: payload.pluginId });
        const detail = result.check?.stdout || result.check?.stderr || result.result.stdout || result.result.stderr;
        setAuthStatus(result.ok ? `Signed in. Try your request again. ${detail}` : `Sign-in did not complete. ${detail}`);
      } catch (error) {
        setAuthStatus(error instanceof Error ? error.message : String(error));
      }
    }
    return (
      <details className="tool-details" open={tool.status === "error"}>
        <summary>{tool.label}</summary>
        <div className="file-result-list">
          {payload.artifact?.relativePath ? <code>Artifacts/{payload.artifact.relativePath}</code> : null}
          {payload.relativePath ? <code>{payload.relativePath}</code> : null}
          {payload.content ? <span>{payload.content}</span> : null}
          {payload.message ? <span>{payload.message}</span> : null}
          {payload.authRequired ? (
            <button className="tiny-button" type="button" onClick={signInPlugin}>
              <KeyRound size={13} />
              {payload.authLabel || "Sign in"}
            </button>
          ) : null}
          {authStatus ? <small>{authStatus}</small> : null}
          {tool.type === "mcp" ? <code>{JSON.stringify(payload.result ?? payload, null, 2).slice(0, 1200)}</code> : null}
        </div>
      </details>
    );
  }

  return null;
}

function ToolResultStrip({ message, language }: { message: ChatMessage; language: Settings["appearance"]["language"] }) {
  const toolResults = message.toolResults || [];
  if (!toolResults.length) {
    return null;
  }

  return (
    <div className="tool-result-strip">
      <div className="tool-pill-row">
        {toolResults.map((tool, index) => (
          <span key={`${tool.label}-${tool.query || index}`} className={`tool-pill ${tool.status || "done"}`}>
            {iconForTool(tool)}
            {tool.label}
          </span>
        ))}
      </div>
      {toolResults.map((tool, index) => (
        <ToolResultDetails key={`${tool.label}-details-${index}`} tool={tool} language={language} />
      ))}
    </div>
  );
}

function ReasoningPanel({ thinking, language }: { thinking?: string; language: Settings["appearance"]["language"] }) {
  if (!thinking?.trim()) {
    return null;
  }

  return (
    <details className="reasoning-panel">
      <summary>
        <Brain size={14} />
        {t(language, "reasoning")}
      </summary>
      <pre>{thinking}</pre>
    </details>
  );
}

function modelCapabilities(settings: Settings | null) {
  const model = settings?.ollama.model || "auto";
  const lower = model.toLowerCase();
  const hasVision = lower.includes("gemma") || lower.includes("llava") || lower.includes("vision") || lower.includes("qwen2.5vl");
  const hasAudio = lower.includes("gemma4:e2b") || lower.includes("gemma4:e4b") || lower.includes("audio");
  return [
    { label: "Text", icon: <Type size={12} /> },
    ...(hasVision ? [{ label: "Image", icon: <Image size={12} /> }] : []),
    ...(hasAudio ? [{ label: "Audio", icon: <Mic size={12} /> }] : []),
    ...(settings?.mcp?.enabled ? [{ label: "MCP", icon: <Plug size={12} /> }] : []),
  ];
}

function ActivityTimeline({ messages }: { messages: ChatMessage[] }) {
  const events = messages
    .flatMap((message) =>
      (message.toolResults || []).map((tool) => ({
        id: `${message.id}-${tool.label}-${tool.query || ""}`,
        label: tool.label,
        status: tool.status || "done",
        type: tool.type,
      })),
    )
    .slice(-6);

  if (!events.length) {
    return null;
  }

  return (
    <div className="activity-timeline" aria-label="Tool activity timeline">
      {events.map((event) => (
        <span className={`activity-step ${event.status}`} key={event.id}>
          {iconForTool({ type: event.type, label: event.label })}
          {event.label}
        </span>
      ))}
    </div>
  );
}

export function ChatWorkspace({
  messages,
  busy,
  toolMode,
  settings,
  onToolModeChange,
  onImageSettingsChange,
  onOllamaModelChange,
  onThinkingChange,
  onEditUserMessage,
  onSend,
  onChooseWorkspace,
  onOpenSettings,
  queueEnabled,
  queueLength,
}: ChatWorkspaceProps) {
  const [composer, setComposer] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [openSelectId, setOpenSelectId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const language = settings?.appearance.language || "en";

  useEffect(() => {
    function closeSelect(event: PointerEvent) {
      if (!(event.target as HTMLElement | null)?.closest(".las-select")) {
        setOpenSelectId(null);
      }
    }
    document.addEventListener("pointerdown", closeSelect);
    return () => document.removeEventListener("pointerdown", closeSelect);
  }, []);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ block: "end" });
    });
  }, [messages, busy]);

  const placeholder = useMemo(() => {
    if (toolMode === "web") {
      return `${t(language, "askAnything")} (${t(language, "web")})`;
    }
    if (toolMode === "none") {
      return t(language, "askAnything");
    }
    return t(language, "askAnything");
  }, [language, toolMode]);

  const ollamaOptions = useMemo(() => {
    const current = settings?.ollama.model || "auto";
    const list = ollamaModelPresets.includes(current) ? ollamaModelPresets : [...ollamaModelPresets, current];
    return list.map((model) => ({ value: model, label: model }));
  }, [settings?.ollama.model]);
  const thinkingValue = ["low", "medium", "high"].includes(settings?.ollama.thinking || "") ? settings!.ollama.thinking : "off";
  const thinkingOptions = useMemo(
    () => [
      { value: "off", label: "Off" },
      { value: "low", label: "Low" },
      { value: "medium", label: "Medium" },
      { value: "high", label: "High" },
    ],
    [],
  );
  const imageModelOptions = useMemo(() => {
    const builtIns = Object.keys(imageModelLabels).map((id) => ({ value: id, label: imageModelLabels[id] }));
    const custom = settings?.image.customModels?.map((model) => ({ value: model.id, label: model.label || model.id })) || [];
    const current = settings?.image.model || "z-image-turbo";
    const merged = [...builtIns, ...custom].filter((model) => model.value);
    return merged.some((model) => model.value === current) ? merged : [...merged, { value: current, label: current }];
  }, [settings?.image.customModels, settings?.image.model]);

  async function attachFiles() {
    const selected = await window.localAgent.chooseAttachments();
    if (selected.length) {
      setAttachments((current) => [...current, ...selected]);
    }
  }

  async function importFiles(files: File[] | FileList) {
    const list = Array.from(files).filter(Boolean);
    if (!list.length) {
      return;
    }
    const items = await Promise.all(list.map(fileToAttachmentItem));
    const imported = await window.localAgent.importAttachments({ items });
    if (imported.length) {
      setAttachments((current) => [...current, ...imported]);
    }
  }

  function beginEdit(message: ChatMessage) {
    setEditingMessageId(message.id);
    setEditingText(message.content);
  }

  function saveEditedMessage() {
    if (!editingMessageId) {
      return;
    }
    onEditUserMessage(editingMessageId, editingText);
    setEditingMessageId(null);
    setEditingText("");
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if ((!composer.trim() && !attachments.length) || (busy && !queueEnabled)) {
      return;
    }
    onSend(composer, attachments);
    setComposer("");
    setAttachments([]);
  }

  const imageSettings = settings?.image;
  const workspaceLabel = settings?.workspacePath ? settings.workspacePath.split(/[\\/]/).pop() || settings.workspacePath : t(language, "noDirectory");
  const capabilities = modelCapabilities(settings);

  return (
    <section
      className="chat-view"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={(event) => {
        event.preventDefault();
        void importFiles(event.dataTransfer.files);
      }}
    >
      <header className="chat-header">
        <div className="chat-title-block">
          <h1>{t(language, "localAgent")}</h1>
          <div className="header-select-row">
            <LASSelect
              id="ollama-model"
              value={settings?.ollama.model || "auto"}
              options={ollamaOptions}
              disabled={!settings}
              openId={openSelectId}
              setOpenId={setOpenSelectId}
              onChange={onOllamaModelChange}
              ariaLabel="Ollama model"
            />
            <LASSelect
              id="reasoning"
              icon={<Brain size={14} />}
              value={thinkingValue}
              options={thinkingOptions}
              disabled={!settings}
              openId={openSelectId}
              setOpenId={setOpenSelectId}
              onChange={(value) => onThinkingChange(value as Settings["ollama"]["thinking"])}
              ariaLabel="Reasoning"
            />
            <LASSelect
              id="image-model"
              icon={<Image size={14} />}
              value={imageSettings?.model || "z-image-turbo"}
              options={imageModelOptions}
              disabled={!settings}
              openId={openSelectId}
              setOpenId={setOpenSelectId}
              onChange={(value) => onImageSettingsChange({ model: value as ImageModel })}
              ariaLabel="Image model"
            />
            {(imageSettings?.model || "z-image-turbo") === "ideogram-v4" ? (
              <LASSelect
                id="ideogram-effort"
                value={imageSettings?.ideogramEffort || "default"}
                options={[
                  { value: "turbo", label: "Turbo" },
                  { value: "default", label: "Default" },
                  { value: "quality", label: "Quality" },
                ]}
                disabled={!settings}
                openId={openSelectId}
                setOpenId={setOpenSelectId}
                onChange={(value) => onImageSettingsChange({ ideogramEffort: value as IdeogramEffort })}
                ariaLabel="Ideogram effort"
              />
            ) : null}
          </div>
          <div className="capability-row">
            {capabilities.map((capability) => (
              <span className="capability-badge" key={capability.label}>
                {capability.icon}
                {capability.label}
              </span>
            ))}
          </div>
        </div>

        <div className="chat-header-actions">
          <div className="mode-switch" aria-label="Tool mode">
            {(["auto", "web", "none"] as ToolMode[]).map((mode) => (
              <button key={mode} className={toolMode === mode ? "segmented active" : "segmented"} type="button" onClick={() => onToolModeChange(mode)}>
                {mode}
              </button>
            ))}
          </div>
          <span className={`stream-status ${busy ? "busy" : ""}`}>
            {busy ? t(language, "streaming") : t(language, "ready")}
            {queueLength ? ` · Queue ${queueLength}` : ""}
          </span>
          <button className="icon-button" type="button" onClick={onOpenSettings} aria-label="Open settings">
            <SettingsIcon size={18} />
          </button>
        </div>
      </header>
      <ActivityTimeline messages={messages} />

      <div className="message-list">
        <div className="message-column">
          {messages.map((message) => (
            <article key={message.id} className={`message ${message.role}${message.pending ? " pending" : ""}`}>
              <MessageIcon role={message.role} />
              <div className="message-body">
                {message.role === "assistant" ? (
                  <div className="message-meta">
                    <strong>{t(language, "localAgent")}</strong>
                    <span>{message.createdAt}</span>
                  </div>
                ) : null}
                {message.role === "user" && editingMessageId === message.id ? (
                  <div className="edit-message-box">
                    <textarea value={editingText} rows={3} onChange={(event) => setEditingText(event.target.value)} autoFocus />
                    <div className="edit-message-actions">
                      <button className="quiet-button icon-text" type="button" onClick={() => setEditingMessageId(null)}>
                        <X size={14} />
                        Cancel
                      </button>
                      <button className="primary-button" type="button" onClick={saveEditedMessage}>
                        <Check size={14} />
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <MarkdownMessage content={message.content} />
                )}
                <AttachmentChips attachments={message.attachments || []} />
                {message.role === "user" && message.editedAt ? <small className="edited-label">Edited {message.editedAt}</small> : null}
                <ReasoningPanel thinking={message.thinking} language={language} />
                <ToolResultStrip message={message} language={language} />
                {message.role === "user" && !message.pending ? (
                  <div className="message-actions">
                    <button type="button" aria-label="Edit message" disabled={busy} onClick={() => beginEdit(message)}>
                      <Pencil size={15} />
                    </button>
                  </div>
                ) : null}
                {message.role === "assistant" && message.content ? (
                  <div className="message-actions">
                    <button type="button" aria-label="Copy response" onClick={() => navigator.clipboard?.writeText(message.content)}>
                      <Copy size={15} />
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      <form className="composer" onSubmit={submit}>
        <div className="composer-card">
          <AttachmentChips attachments={attachments} onRemove={(id) => setAttachments((current) => current.filter((attachment) => attachment.id !== id))} />
          <textarea
            value={composer}
            placeholder={placeholder}
            rows={1}
            onChange={(event) => setComposer(event.target.value)}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                void importFiles(event.clipboardData.files);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-actions">
            <div className="composer-left-actions">
              <button className="icon-button flat" type="button" onClick={attachFiles} title={t(language, "attach")} aria-label={t(language, "attach")}>
                <Paperclip size={18} />
              </button>
              <button
                className={`icon-button flat ${toolMode === "web" ? "active" : ""}`}
                type="button"
                onClick={() => onToolModeChange(toolMode === "web" ? "auto" : "web")}
                title={t(language, "web")}
                aria-label={t(language, "web")}
              >
                <Globe2 size={18} />
              </button>
            </div>

            <div className="composer-right-actions">
              <button className="workspace-button" type="button" onClick={onChooseWorkspace} title={settings?.workspacePath || ""}>
                <FolderOpen size={16} />
                <span>{workspaceLabel}</span>
              </button>
              <span className="language-mini">{languageLabels[language]}</span>
              <button className="send-button" type="submit" disabled={(busy && !queueEnabled) || (!composer.trim() && !attachments.length)} aria-label="Send message">
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      </form>
    </section>
  );
}
