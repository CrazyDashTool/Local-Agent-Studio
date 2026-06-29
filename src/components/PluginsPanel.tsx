import { useCallback, useEffect, useMemo, useState } from "react";
import { BadgeCheck, ExternalLink, KeyRound, PackagePlus, Plug, RefreshCw, ShieldCheck, ShieldQuestion, Trash2, X } from "lucide-react";
import type { PluginDraft } from "../types";

interface PluginsPanelProps {
  onSettingsChanged?: () => Promise<void>;
}

function publisherLabel(plugin: PluginDraft) {
  return plugin.publisher === "official" ? "Official" : "Community";
}

function bannerStyle(plugin: PluginDraft) {
  const versionedBannerUrl = plugin.bannerUrl
    ? `${plugin.bannerUrl}${plugin.bannerUrl.includes("?") ? "&" : "?"}v=${encodeURIComponent(plugin.version || "latest")}`
    : "";
  return plugin.bannerUrl
    ? {
        backgroundImage: `linear-gradient(180deg, rgb(0 0 0 / 0.04), rgb(0 0 0 / 0.38)), url("${versionedBannerUrl}")`,
      }
    : undefined;
}

function pluginRiskLabel(plugin: PluginDraft) {
  const tools = (plugin.tools || []).map((tool) => tool.name).join(" ");
  if (/(push|delete|upload|post|send|publish|commit)/i.test(tools)) {
    return "write-capable";
  }
  if ((plugin.permissions || []).some((permission) => /(files:write|terminal|network)/i.test(permission))) {
    return "elevated";
  }
  return "read-oriented";
}

export function PluginsPanel({ onSettingsChanged }: PluginsPanelProps) {
  const [plugins, setPlugins] = useState<PluginDraft[]>([]);
  const [selectedPluginId, setSelectedPluginId] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState("");
  const [status, setStatus] = useState("");
  const [filter, setFilter] = useState<"all" | "installed" | "official" | "community">("all");

  const selectedPlugin = plugins.find((plugin) => plugin.id === selectedPluginId) || null;

  const refresh = useCallback(async () => {
    const result = await window.localAgent.listPluginDrafts();
    setPlugins(result.plugins || []);
    await onSettingsChanged?.();
  }, [onSettingsChanged]);

  useEffect(() => {
    refresh().catch((error) => setStatus(error instanceof Error ? error.message : String(error)));
  }, [refresh]);

  const visiblePlugins = useMemo(() => {
    return plugins.filter((plugin) => {
      if (filter === "installed") {
        return plugin.installed;
      }
      if (filter === "official") {
        return plugin.publisher === "official";
      }
      if (filter === "community") {
        return plugin.publisher !== "official";
      }
      return true;
    });
  }, [filter, plugins]);

  async function installFromUrl() {
    const url = installUrl.trim();
    if (!url) {
      return;
    }
    setStatus("Downloading plugin manifest...");
    try {
      const result = await window.localAgent.installPluginFromUrl({ url });
      setPlugins(result.plugins || []);
      await onSettingsChanged?.();
      setInstallUrl("");
      setStatus("Plugin installed. Plugin MCP is ready; enable the plugin to let the agent use it.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function setInstalled(plugin: PluginDraft, installed: boolean) {
    const result = await window.localAgent.setPluginInstalled({ pluginId: plugin.id, installed });
    setPlugins(result.plugins || []);
    await onSettingsChanged?.();
    setStatus(`${installed ? "Installed" : "Removed"} ${plugin.label}.${installed ? " Plugin MCP is ready." : ""}`);
  }

  async function setEnabled(plugin: PluginDraft, enabled: boolean) {
    const result = await window.localAgent.setPluginEnabled({ pluginId: plugin.id, enabled });
    setPlugins(result.plugins || []);
    setStatus(`${enabled ? "Enabled" : "Disabled"} ${plugin.label}.`);
  }

  async function signIn(plugin: PluginDraft) {
    setStatus(`Starting ${plugin.auth?.label || "browser sign-in"}...`);
    try {
      const result = await window.localAgent.runPluginAuth({ pluginId: plugin.id });
      await refresh();
      const installDetail = result.install ? `Installer: ${result.install.stdout || result.install.stderr || "completed"}. ` : "";
      const detail = result.check?.stdout || result.check?.stderr || result.result.stdout || result.result.stderr;
      setStatus(result.ok ? `${installDetail}Signed in for ${plugin.label}. ${detail}` : `${installDetail}Sign-in did not complete. ${detail}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function copySource(plugin: PluginDraft) {
    await navigator.clipboard.writeText(plugin.sourceUrl || plugin.manifestUrl || plugin.repository || plugin.homepage || "");
    setStatus("Plugin source URL copied.");
  }

  return (
    <section className="plugins-view">
      <header className="workspace-header">
        <div>
          <h1>Plugins</h1>
          <button className="link-button" type="button">
            Square marketplace cards, GitHub installs, and hidden Plugin MCP
          </button>
        </div>
        <button className="quiet-button icon-text" type="button" onClick={refresh}>
          <RefreshCw size={15} />
          Refresh
        </button>
      </header>

      <div className="plugins-layout">
        <section className="plugin-install-panel">
          <div className="tool-panel-title">
            <PackagePlus size={17} />
            Install from GitHub
          </div>
          <p className="settings-note">
            Paste a GitHub repository URL or a raw <code>plugin.json</code> URL. Verified plugins can also be bundled into this marketplace list in the next app update.
          </p>
          <div className="plugin-url-row">
            <input value={installUrl} onChange={(event) => setInstallUrl(event.target.value)} placeholder="https://github.com/user/las-plugin" />
            <button className="primary-button" type="button" onClick={installFromUrl}>
              <PackagePlus size={15} />
              Install
            </button>
          </div>
          <div className="plugin-filter-row">
            {(["all", "installed", "official", "community"] as const).map((item) => (
              <button className={filter === item ? "segmented active" : "segmented"} type="button" key={item} onClick={() => setFilter(item)}>
                {item}
              </button>
            ))}
          </div>
        </section>

        <section className="plugin-market-grid">
          {visiblePlugins.map((plugin) => (
            <button className="market-plugin-card" type="button" key={plugin.id} onClick={() => setSelectedPluginId(plugin.id)}>
              <div className="plugin-card-banner" style={bannerStyle(plugin)}>
                <span className={plugin.publisher === "official" ? "publisher-badge official" : "publisher-badge community"}>
                  {plugin.publisher === "official" ? <BadgeCheck size={13} /> : <ShieldQuestion size={13} />}
                  {publisherLabel(plugin)}
                </span>
              </div>
              <div className="plugin-card-compact">
                <h2>{plugin.label}</h2>
                <p>{plugin.description}</p>
                <div className="plugin-meta">
                  <span>v{plugin.version || "0.0.0"}</span>
                  {plugin.installed ? <span>installed</span> : <span>marketplace</span>}
                  <span>{pluginRiskLabel(plugin)}</span>
                  {plugin.authState?.signedIn ? <span>signed in</span> : null}
                  {plugin.enabled ? <span>enabled</span> : null}
                </div>
              </div>
            </button>
          ))}
        </section>
      </div>

      {selectedPlugin ? (
        <div className="plugin-detail-backdrop" role="dialog" aria-modal="true">
          <article className="plugin-detail-panel">
            <div className="plugin-detail-hero" style={bannerStyle(selectedPlugin)}>
              <button className="icon-button plugin-detail-close" type="button" onClick={() => setSelectedPluginId(null)} aria-label="Close plugin details">
                <X size={17} />
              </button>
              <span className={selectedPlugin.publisher === "official" ? "publisher-badge official" : "publisher-badge community"}>
                {selectedPlugin.publisher === "official" ? <BadgeCheck size={13} /> : <ShieldQuestion size={13} />}
                {publisherLabel(selectedPlugin)}
              </span>
              <div>
                <h1>{selectedPlugin.label}</h1>
                <p>{selectedPlugin.description}</p>
              </div>
            </div>

            <div className="plugin-detail-body">
              <section>
                <h3>Overview</h3>
                <div className="plugin-meta">
                  <span>v{selectedPlugin.version || "0.0.0"}</span>
                  <span>{selectedPlugin.status}</span>
                  {selectedPlugin.installed ? <span>installed</span> : <span>marketplace</span>}
                  {selectedPlugin.enabled ? <span>enabled</span> : null}
                  {selectedPlugin.authState?.signedIn ? <span>signed in as {selectedPlugin.authState.account?.login || "GitHub"}</span> : null}
                  {selectedPlugin.trusted ? (
                    <span>
                      <ShieldCheck size={12} />
                      trusted
                    </span>
                  ) : null}
                  <span>{pluginRiskLabel(selectedPlugin)}</span>
                </div>
                <div className="plugin-tag-row">
                  {(selectedPlugin.capabilities || []).map((capability) => (
                    <span key={capability}>{capability}</span>
                  ))}
                </div>
              </section>

              <section>
                <h3>Permissions</h3>
                <div className="plugin-tag-row">
                  {selectedPlugin.permissions.map((permission) => (
                    <span key={permission}>{permission}</span>
                  ))}
                </div>
              </section>

              {selectedPlugin.tools?.length ? (
                <section>
                  <h3>Agent Tools</h3>
                  <div className="plugin-detail-list">
                    {selectedPlugin.tools.map((tool) => (
                      <div key={tool.name}>
                        <strong>{tool.name}</strong>
                        <span>{tool.description || "No description"}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {selectedPlugin.mcpServers?.length ? (
                <section>
                  <h3>Plugin MCP</h3>
                  <div className="plugin-detail-list">
                    {selectedPlugin.mcpServers.map((server) => (
                      <div key={server.name}>
                        <strong>{server.name}</strong>
                        <span>{server.command} {(server.args || []).join(" ")}</span>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              <section>
                <h3>Source</h3>
                <div className="plugin-detail-list">
                  <div>
                    <strong>Repository</strong>
                    <span>{selectedPlugin.repository || selectedPlugin.homepage || selectedPlugin.sourceUrl || "No source URL"}</span>
                  </div>
                  {selectedPlugin.bannerUrl ? (
                    <div>
                      <strong>Header image</strong>
                      <span>{selectedPlugin.bannerUrl}</span>
                    </div>
                  ) : null}
                </div>
              </section>
            </div>

            <footer className="plugin-detail-actions">
              {selectedPlugin.sourceUrl || selectedPlugin.manifestUrl || selectedPlugin.repository || selectedPlugin.homepage ? (
                <button className="quiet-button icon-text" type="button" onClick={() => copySource(selectedPlugin)}>
                  <ExternalLink size={14} />
                  Source
                </button>
              ) : null}
              {selectedPlugin.installed ? (
                <>
                  {selectedPlugin.auth ? (
                    <button className="quiet-button icon-text" type="button" onClick={() => signIn(selectedPlugin)}>
                      <KeyRound size={14} />
                      {selectedPlugin.auth.label || "Sign in"}
                    </button>
                  ) : null}
                  <button className="quiet-button icon-text" type="button" onClick={() => setEnabled(selectedPlugin, !selectedPlugin.enabled)}>
                    <Plug size={14} />
                    {selectedPlugin.enabled ? "Disable" : "Enable"}
                  </button>
                  <button className="quiet-button icon-text danger" type="button" onClick={() => setInstalled(selectedPlugin, false)}>
                    <Trash2 size={14} />
                    Remove
                  </button>
                </>
              ) : (
                <button className="primary-button" type="button" onClick={() => setInstalled(selectedPlugin, true)}>
                  <PackagePlus size={15} />
                  Install
                </button>
              )}
            </footer>
          </article>
        </div>
      ) : null}

      {status ? <div className="floating-status">{status}</div> : null}
    </section>
  );
}
