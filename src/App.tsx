import { useCallback, useEffect, useState } from "react";
import { ChatWorkspace } from "./components/ChatWorkspace";
import { ArtifactsPanel } from "./components/ArtifactsPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { ImageGalleryPanel } from "./components/ImageGalleryPanel";
import { PluginsPanel } from "./components/PluginsPanel";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { ActiveView, Sidebar } from "./components/Sidebar";
import { SetupWizard } from "./components/SetupWizard";
import { TerminalPanel } from "./components/TerminalPanel";
import { ToolsPanel } from "./components/ToolsPanel";
import { WorkspacePanel } from "./components/WorkspacePanel";
import type {
  AgentStreamEvent,
  Attachment,
  ChatMessage,
  Settings,
  TerminalResult,
  ToolMode,
  ToolResult,
} from "./types";

interface QueuedTask {
  text: string;
  attachments: Attachment[];
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function timestamp() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function welcomeMessage(): ChatMessage {
  return {
    id: "welcome",
    role: "assistant",
    createdAt: timestamp(),
    content:
      "Ready. I can chat normally, search the web when it is useful, create and edit workspace files, queue ComfyUI image jobs, and build local databases from JSON/CSV objects. Markdown, code blocks, file tools, streaming, and reasoning panels are enabled.",
  };
}

function compactMessage(message: ChatMessage) {
  return {
    role: message.role,
    content: message.content,
    attachments: message.attachments || [],
  };
}

function terminalSummary(result: TerminalResult) {
  const body = [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n\n");
  return `**Exit code:** ${result.exitCode}${result.timedOut ? " (timeout)" : ""}\n\n**Duration:** ${result.durationMs} ms${
    body ? `\n\n\`\`\`text\n${body}\n\`\`\`` : ""
  }`;
}

function replaceToolResult(current: ToolResult[] | undefined, toolResult: ToolResult) {
  const list = current || [];
  const filtered = list.filter((item) => !(item.type === toolResult.type && item.query === toolResult.query && item.status === "running"));
  return [...filtered, toolResult];
}

export function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage()]);
  const [busy, setBusy] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>("auto");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("chat");
  const [queuedTasks, setQueuedTasks] = useState<QueuedTask[]>([]);

  useEffect(() => {
    window.localAgent.getSettings().then(setSettings).catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings?.appearance?.theme || "system";
  }, [settings?.appearance?.theme]);

  const updateAssistant = useCallback((id: string, patch: Partial<ChatMessage> | ((message: ChatMessage) => Partial<ChatMessage>)) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== id) {
          return message;
        }
        const nextPatch = typeof patch === "function" ? patch(message) : patch;
        return {
          ...message,
          ...nextPatch,
        };
      }),
    );
  }, []);

  const finishAssistant = useCallback(
    (id: string, content: string, toolResults?: ToolResult[], thinking?: string) => {
      updateAssistant(id, {
        content,
        thinking,
        toolResults,
        pending: false,
      });
    },
    [updateAssistant],
  );

  const handleSaveSettings = useCallback(async (nextSettings: Settings) => {
    const saved = await window.localAgent.saveSettings(nextSettings);
    setSettings(saved);
    setSettingsOpen(false);
  }, []);

  const refreshSettings = useCallback(async () => {
    const latest = await window.localAgent.getSettings();
    setSettings(latest);
  }, []);

  const saveSettingsPatch = useCallback((patcher: (settings: Settings) => Settings) => {
    setSettings((current) => {
      if (!current) {
        return current;
      }
      const next = patcher(current);
      window.localAgent.saveSettings(next).then(setSettings).catch(() => undefined);
      return next;
    });
  }, []);

  const handleImageSettingsChange = useCallback(
    (patch: Partial<Settings["image"]>) => {
      saveSettingsPatch((current) => ({
        ...current,
        image: {
          ...current.image,
          ...patch,
          repeat: Math.max(1, Math.min(Number(patch.repeat ?? current.image.repeat), 3)),
        },
      }));
    },
    [saveSettingsPatch],
  );

  const handleOllamaModelChange = useCallback(
    (model: string) => {
      saveSettingsPatch((current) => ({
        ...current,
        ollama: {
          ...current.ollama,
          model,
        },
      }));
    },
    [saveSettingsPatch],
  );

  const handleThinkingChange = useCallback(
    (thinking: Settings["ollama"]["thinking"]) => {
      saveSettingsPatch((current) => ({
        ...current,
        ollama: {
          ...current.ollama,
          thinking,
        },
      }));
    },
    [saveSettingsPatch],
  );

  const handleChooseWorkspace = useCallback(async () => {
    const selected = await window.localAgent.chooseWorkspace();
    if (selected) {
      setSettings(selected);
    }
  }, []);

  const handleContextDateToggle = useCallback(
    (enabled: boolean) => {
      saveSettingsPatch((current) => ({
        ...current,
        context: {
          ...current.context,
          includeLocalDateTime: enabled,
        },
      }));
    },
    [saveSettingsPatch],
  );

  const handleCheckUpdates = useCallback(async () => {
    const result = await window.localAgent.checkUpdates();
    const content = result.error
      ? `Update check failed: ${result.error}`
      : result.updateAvailable
        ? `Update available: **${result.latestVersion}**\n\n${result.url || ""}`
        : `You're up to date. Current version: **${result.currentVersion}**.`;
    setMessages((current) => [
      ...current,
      {
        id: makeId("update"),
        role: "assistant",
        createdAt: timestamp(),
        content,
        toolResults: [
          {
            type: "update",
            label: "Update check",
            status: result.error ? "error" : "done",
            payload: result,
          },
        ],
      },
    ]);
    setActiveView("chat");
  }, []);

  const handleFinishSetup = useCallback(async (nextSettings?: Settings) => {
    const base = nextSettings || settings;
    if (!base) {
      return;
    }
    const saved = await window.localAgent.saveSettings({
      ...base,
      setup: {
        ...base.setup,
        firstLaunchComplete: true,
      },
    });
    setSettings(saved);
    setSetupOpen(false);
  }, [settings]);

  const handleExportChat = useCallback(async () => {
    await window.localAgent.exportChat({
      version: 1,
      exportedAt: new Date().toISOString(),
      messages,
    });
  }, [messages]);

  const handleImportChat = useCallback(async () => {
    const imported = await window.localAgent.importChat();
    const data = imported?.data as { messages?: ChatMessage[] } | ChatMessage[] | null | undefined;
    const importedMessages = Array.isArray(data) ? data : data?.messages;
    if (importedMessages?.length) {
      setMessages(importedMessages);
      setActiveView("chat");
    }
  }, []);

  const handleEditUserMessage = useCallback((messageId: string, content: string) => {
    if (busy) {
      return;
    }
    setQueuedTasks([]);
    setMessages((current) => {
      const index = current.findIndex((message) => message.id === messageId && message.role === "user");
      if (index < 0) {
        return current;
      }
      return [
        ...current.slice(0, index),
        {
          ...current[index],
          content,
          editedAt: timestamp(),
        },
      ];
    });
    setActiveView("chat");
  }, [busy]);

  const handleStreamEvent = useCallback(
    (assistantId: string, event: AgentStreamEvent) => {
      if (event.type === "token") {
        updateAssistant(assistantId, (message) => ({
          content: `${message.content}${event.token}`,
        }));
        return;
      }

      if (event.type === "thinking") {
        updateAssistant(assistantId, (message) => ({
          thinking: `${message.thinking || ""}${event.token}`,
        }));
        return;
      }

      if (event.type === "tool-start" || event.type === "tool-finish") {
        updateAssistant(assistantId, (message) => ({
          toolResults: replaceToolResult(message.toolResults, event.toolResult),
        }));
        return;
      }

      if (event.type === "done") {
        updateAssistant(assistantId, (message) => ({
          content: event.response.content || message.content || "The model returned an empty answer.",
          thinking: event.response.thinking || message.thinking,
          toolResults: event.response.toolResults || message.toolResults,
          pending: false,
        }));
        return;
      }

      if (event.type === "error") {
        finishAssistant(assistantId, event.message);
      }
    },
    [finishAssistant, updateAssistant],
  );

  const runSlashCommand = useCallback(
    async (text: string, assistantId: string) => {
      if (!text.trim().toLowerCase().startsWith("/run")) {
        return false;
      }
      const command = text.replace(/^\/run\s*/i, "");
      const result = await window.localAgent.runCommand({ command });
      finishAssistant(assistantId, terminalSummary(result), [{ type: "terminal", label: "Terminal run", status: "done", payload: result }]);
      return true;
    },
    [finishAssistant],
  );

  const sendMessage = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      if (!settings) {
        return;
      }

      if (busy) {
        if (settings.agent.taskQueue) {
          setQueuedTasks((current) => [...current, { text, attachments }]);
        }
        return;
      }

      const trimmed = text.trim();
      if (!trimmed && !attachments.length) {
        return;
      }

      const userMessage: ChatMessage = {
        id: makeId("user"),
        role: "user",
        content: trimmed,
        attachments,
        createdAt: timestamp(),
      };
      const assistantId = makeId("assistant");
      const pendingMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: "",
        createdAt: timestamp(),
        pending: true,
      };

      const baseMessages = messages.filter((message) => !message.pending);
      const nextMessages = [...baseMessages, userMessage];
      setMessages([...nextMessages, pendingMessage]);
      setBusy(true);
      setActiveView("chat");

      try {
        const handled = trimmed.startsWith("/") ? await runSlashCommand(trimmed, assistantId) : false;
        if (handled) {
          return;
        }

        const isSearchCommand = trimmed.toLowerCase().startsWith("/search");
        const agentMessages = nextMessages.map(compactMessage);
        const response = await window.localAgent.sendMessageStream(
          {
            messages: agentMessages,
            toolMode: isSearchCommand ? "web" : toolMode,
          },
          (event) => handleStreamEvent(assistantId, event),
        );
        finishAssistant(
          assistantId,
          response.content || "The model returned an empty answer.",
          response.toolResults,
          response.thinking,
        );
      } catch (error) {
        finishAssistant(assistantId, error instanceof Error ? error.message : String(error));
      } finally {
        setBusy(false);
      }
    },
    [busy, finishAssistant, handleStreamEvent, messages, runSlashCommand, settings, toolMode],
  );

  useEffect(() => {
    if (busy || !queuedTasks.length || !settings) {
      return;
    }
    const [next] = queuedTasks;
    setQueuedTasks((current) => current.slice(1));
    void sendMessage(next.text, next.attachments);
  }, [busy, queuedTasks, sendMessage, settings]);

  const runTerminal = useCallback(async (command: string) => window.localAgent.runCommand({ command }), []);

  const newChat = useCallback(() => {
    if (busy) {
      return;
    }
    setMessages([welcomeMessage()]);
    setActiveView("chat");
  }, [busy]);

  return (
    <div className="app-shell">
      {settings && (setupOpen || !settings.setup?.firstLaunchComplete) ? (
        <SetupWizard
          settings={settings}
          onChooseWorkspace={handleChooseWorkspace}
          onFinish={handleFinishSetup}
        />
      ) : null}
      <Sidebar
        activeView={activeView}
        settings={settings}
        onNavigate={setActiveView}
        onNewChat={newChat}
        onOpenSettings={() => setSettingsOpen(true)}
        onCheckUpdates={handleCheckUpdates}
      />

      <main className="main-area">
        {activeView === "chat" ? (
          <ChatWorkspace
            busy={busy}
            messages={messages}
            settings={settings}
            toolMode={toolMode}
            onToolModeChange={setToolMode}
            onImageSettingsChange={handleImageSettingsChange}
            onOllamaModelChange={handleOllamaModelChange}
            onThinkingChange={handleThinkingChange}
            onEditUserMessage={handleEditUserMessage}
            onSend={sendMessage}
            onChooseWorkspace={handleChooseWorkspace}
            onOpenSettings={() => setSettingsOpen(true)}
            queueEnabled={Boolean(settings?.agent.taskQueue)}
            queueLength={queuedTasks.length}
          />
        ) : null}

        {activeView === "history" ? (
          <HistoryPanel
            messages={messages}
            settings={settings}
            onNewChat={newChat}
            onBackToChat={() => setActiveView("chat")}
            onExportChat={handleExportChat}
            onImportChat={handleImportChat}
          />
        ) : null}

        {activeView === "workspace" ? <WorkspacePanel settings={settings} onChooseWorkspace={handleChooseWorkspace} /> : null}

        {activeView === "images" ? <ImageGalleryPanel settings={settings} /> : null}

        {activeView === "artifacts" ? <ArtifactsPanel settings={settings} /> : null}

        {activeView === "tools" ? (
          <ToolsPanel settings={settings} onSaveSettings={handleSaveSettings} onOpenSettings={() => setSettingsOpen(true)} />
        ) : null}

        {activeView === "plugins" ? <PluginsPanel onSettingsChanged={refreshSettings} /> : null}

        {activeView === "terminal" ? <TerminalPanel settings={settings} onRun={runTerminal} /> : null}
      </main>

      {settingsOpen && settings ? (
        <SettingsDrawer
          settings={settings}
          onCancel={() => setSettingsOpen(false)}
          onSave={handleSaveSettings}
          onChooseWorkspace={handleChooseWorkspace}
          onRunSetupWizard={() => {
            setSettingsOpen(false);
            setSetupOpen(true);
          }}
        />
      ) : null}
    </div>
  );
}
