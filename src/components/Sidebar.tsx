import { Bot, Clock3, FileText, FolderOpen, Image, MessageSquare, Plug, Plus, RefreshCw, Settings as SettingsIcon, Terminal, Wrench, UserRound } from "lucide-react";
import { t } from "../i18n";
import type { LanguageCode, Settings } from "../types";

export type ActiveView = "chat" | "history" | "workspace" | "images" | "artifacts" | "tools" | "plugins" | "terminal";

interface SidebarProps {
  activeView: ActiveView;
  settings: Settings | null;
  onNavigate: (view: ActiveView) => void;
  onNewChat: () => void;
  onOpenSettings: () => void;
  onCheckUpdates: () => void;
}

export function Sidebar({ activeView, settings, onNavigate, onNewChat, onOpenSettings, onCheckUpdates }: SidebarProps) {
  const language = (settings?.appearance.language || "en") as LanguageCode;
  const userName = settings?.profile?.userName || "User";

  return (
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark">
          <Bot size={25} />
        </div>
        <div className="brand-copy">
          <strong>Local Agent Studio</strong>
          <span>v0.2.1</span>
        </div>
        <button className="icon-button new-chat-button" type="button" onClick={onNewChat} aria-label={t(language, "newChat")}>
          <Plus size={19} />
        </button>
      </div>

      <nav className="nav-list">
        <button className={activeView === "chat" ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate("chat")}>
          <MessageSquare size={18} />
          {t(language, "chat")}
        </button>
        <button className={activeView === "history" ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate("history")}>
          <Clock3 size={18} />
          {t(language, "history")}
        </button>
        <button className={activeView === "workspace" ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate("workspace")}>
          <FolderOpen size={18} />
          {t(language, "workspace")}
        </button>
        <button className={activeView === "images" ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate("images")}>
          <Image size={18} />
          Images
        </button>
        <button className={activeView === "artifacts" ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate("artifacts")}>
          <FileText size={18} />
          Artifacts
        </button>
        <button className={activeView === "tools" ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate("tools")}>
          <Wrench size={18} />
          Tools
        </button>
        <button className={activeView === "plugins" ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate("plugins")}>
          <Plug size={18} />
          Plugins
        </button>
        <button className={activeView === "terminal" ? "nav-item active" : "nav-item"} type="button" onClick={() => onNavigate("terminal")}>
          <Terminal size={18} />
          {t(language, "terminal")}
        </button>
        <button className="nav-item" type="button" onClick={onOpenSettings}>
          <SettingsIcon size={18} />
          {t(language, "settings")}
        </button>
      </nav>

      <div className="profile-block">
        <button className="profile-row" type="button" onClick={onOpenSettings}>
          <span className="profile-avatar">
            <UserRound size={17} />
          </span>
          <span>{userName}</span>
        </button>
        <button className="icon-button" type="button" onClick={onCheckUpdates} aria-label="Check for update" title="Check for update">
          <RefreshCw size={16} />
        </button>
      </div>
    </aside>
  );
}
