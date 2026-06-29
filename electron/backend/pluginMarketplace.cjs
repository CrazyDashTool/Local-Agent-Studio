const fs = require("node:fs");
const path = require("node:path");
const { getPluginAccessToken, getPluginAuthSummary } = require("./pluginAuth.cjs");

const OFFICIAL_PLUGINS = [];

function pluginStatePath(userDataDir) {
  return path.join(userDataDir, "plugin-marketplace.json");
}

function marketplaceCatalogPath() {
  return path.join(__dirname, "..", "plugin-marketplace.json");
}

function installedPluginDir(userDataDir) {
  return path.join(userDataDir, "plugins", "installed");
}

function installedPluginPath(userDataDir, pluginId) {
  return path.join(installedPluginDir(userDataDir), pluginId, "plugin.json");
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readPluginState(userDataDir) {
  const parsed = readJson(pluginStatePath(userDataDir), { installed: [], enabled: {}, trustedCommunity: [] });
  return {
    installed: Array.isArray(parsed.installed) ? parsed.installed : [],
    enabled: parsed.enabled && typeof parsed.enabled === "object" ? parsed.enabled : {},
    trustedCommunity: Array.isArray(parsed.trustedCommunity) ? parsed.trustedCommunity : [],
  };
}

function writePluginState(userDataDir, state) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const next = {
    installed: Array.from(new Set(Array.isArray(state.installed) ? state.installed : [])),
    enabled: state.enabled && typeof state.enabled === "object" ? state.enabled : {},
    trustedCommunity: Array.from(new Set(Array.isArray(state.trustedCommunity) ? state.trustedCommunity : [])),
  };
  fs.writeFileSync(pluginStatePath(userDataDir), JSON.stringify(next, null, 2), "utf8");
  return next;
}

function normalizePlugin(raw, fallback = {}) {
  const id = String(raw.id || fallback.id || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,80}$/.test(id)) {
    throw new Error("Plugin manifest must include a valid id.");
  }
  const name = String(raw.name || raw.label || fallback.name || id).trim();
  const permissions = Array.isArray(raw.permissions) ? raw.permissions.map(String) : [];
  const capabilities = Array.isArray(raw.capabilities) ? raw.capabilities.map(String) : [];
  const categories = Array.isArray(raw.categories) ? raw.categories.map(String) : [];
  const tools = Array.isArray(raw.tools)
    ? raw.tools.map((tool) => ({
        name: String(tool.name || "").trim(),
        description: String(tool.description || "").trim(),
        inputSchema: tool.inputSchema || undefined,
      })).filter((tool) => tool.name)
    : [];
  const mcpServers = Array.isArray(raw.mcpServers)
    ? raw.mcpServers.map((server) => ({
        ...server,
        args: normalizeMcpArgs(server.args),
      }))
    : [];

  return {
    id,
    name,
    label: String(raw.label || name),
    description: String(raw.description || "No description provided."),
    version: String(raw.version || "0.0.0"),
    author: String(raw.author || fallback.author || "Unknown"),
    publisher: raw.publisher === "official" || fallback.publisher === "official" ? "official" : "community",
    status: raw.status === "ready" || raw.status === "planned" ? raw.status : "draft",
    homepage: raw.homepage || fallback.homepage || "",
    repository: raw.repository || fallback.repository || "",
    manifestUrl: raw.manifestUrl || fallback.manifestUrl || "",
    sourceUrl: raw.sourceUrl || raw.installUrl || fallback.sourceUrl || fallback.installUrl || "",
    bannerUrl: raw.bannerUrl || fallback.bannerUrl || "",
    verifiedAt: raw.verifiedAt || fallback.verifiedAt || "",
    categories,
    permissions,
    capabilities,
    tools,
    mcpServers,
    runtime: raw.runtime || null,
    auth: raw.auth || fallback.auth || null,
    prompts: Array.isArray(raw.prompts) ? raw.prompts : [],
    settingsSchema: raw.settingsSchema || null,
    readme: raw.readme || "",
  };
}

function normalizeMcpArgs(args) {
  if (!Array.isArray(args)) {
    return [];
  }
  return args.map((arg) => {
    const value = String(arg);
    const match = value.match(/^github\.com\/([^/\s]+)\/([^/\s]+)$/i);
    if (match) {
      return `github:${match[1]}/${match[2]}`;
    }
    return value;
  });
}

function readMarketplaceCatalog() {
  const catalog = readJson(marketplaceCatalogPath(), { plugins: [] });
  const plugins = Array.isArray(catalog.plugins) ? catalog.plugins : [];
  return plugins
    .map((plugin) => {
      try {
        return normalizePlugin(plugin, { publisher: "community" });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readInstalledPlugins(userDataDir) {
  const root = installedPluginDir(userDataDir);
  if (!fs.existsSync(root)) {
    return [];
  }
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return normalizePlugin(readJson(path.join(root, entry.name, "plugin.json"), {}), { id: entry.name });
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function listPlugins(userDataDir) {
  const state = readPluginState(userDataDir);
  const installed = readInstalledPlugins(userDataDir);
  const catalog = readMarketplaceCatalog();
  const merged = new Map();
  for (const plugin of [...installed, ...OFFICIAL_PLUGINS.map((plugin) => normalizePlugin(plugin)), ...catalog]) {
    const existing = merged.get(plugin.id) || {};
    merged.set(plugin.id, {
      ...existing,
      ...plugin,
      auth: plugin.auth || existing.auth || null,
      bannerUrl: plugin.bannerUrl || existing.bannerUrl || "",
      manifestUrl: plugin.manifestUrl || existing.manifestUrl || "",
      sourceUrl: plugin.sourceUrl || existing.sourceUrl || "",
      installed: state.installed.includes(plugin.id),
      enabled: state.enabled[plugin.id] !== false && state.installed.includes(plugin.id),
      trusted: plugin.publisher === "official" || Boolean(plugin.verifiedAt) || state.trustedCommunity.includes(plugin.id),
      authState: plugin.auth || existing.auth ? getPluginAuthSummary(userDataDir, plugin.id) : null,
    });
  }
  return { plugins: Array.from(merged.values()).sort((a, b) => a.label.localeCompare(b.label)) };
}

function setPluginInstalled(userDataDir, pluginId, installed) {
  const state = readPluginState(userDataDir);
  const known = listPlugins(userDataDir).plugins.find((plugin) => plugin.id === pluginId);
  if (!known) {
    throw new Error(`Unknown plugin: ${pluginId}`);
  }
  if (installed && !known.installed && (known.manifestUrl || known.sourceUrl)) {
    return installPluginFromUrl(userDataDir, known.manifestUrl || known.sourceUrl, {
      trusted: known.trusted,
      publisher: known.publisher,
      verifiedAt: known.verifiedAt,
    });
  }
  const current = new Set(state.installed);
  const enabled = { ...state.enabled };
  if (installed) {
    current.add(pluginId);
    enabled[pluginId] = true;
  } else {
    current.delete(pluginId);
    enabled[pluginId] = false;
  }
  writePluginState(userDataDir, { ...state, installed: Array.from(current), enabled });
  return listPlugins(userDataDir);
}

function setPluginEnabled(userDataDir, pluginId, enabled) {
  const state = readPluginState(userDataDir);
  if (!state.installed.includes(pluginId)) {
    throw new Error("Install the plugin before enabling it.");
  }
  writePluginState(userDataDir, {
    ...state,
    enabled: {
      ...state.enabled,
      [pluginId]: Boolean(enabled),
    },
  });
  return listPlugins(userDataDir);
}

function hydratePluginEnv(env, settings) {
  const next = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (key === "LAS_WORKSPACE" && !value) {
      next[key] = settings.workspacePath || "";
      continue;
    }
    next[key] = String(value || "")
      .replaceAll("${workspacePath}", settings.workspacePath || "")
      .replaceAll("${settings.workspacePath}", settings.workspacePath || "");
  }
  return next;
}

function hydratePluginAuthEnv(plugin, env, userDataDir) {
  if (plugin.auth?.type === "github_device_flow" && !env.GITHUB_TOKEN) {
    const token = getPluginAccessToken(userDataDir, plugin.id);
    if (token) {
      return {
        ...env,
        GITHUB_TOKEN: token,
      };
    }
  }
  return env;
}

function pluginMcpServers(userDataDir, settings = {}) {
  return listPlugins(userDataDir).plugins
    .filter((plugin) => plugin.installed && plugin.enabled && Array.isArray(plugin.mcpServers))
    .flatMap((plugin) =>
      plugin.mcpServers.map((server) => {
        const env = hydratePluginAuthEnv(plugin, hydratePluginEnv(server.env, settings), userDataDir);
        return {
          name: server.name,
          command: server.command || "",
          args: Array.isArray(server.args) ? server.args : [],
          env,
          enabled: true,
          source: "plugin",
          pluginId: plugin.id,
          pluginLabel: plugin.label,
          auth: plugin.auth || null,
          authState: plugin.auth ? getPluginAuthSummary(userDataDir, plugin.id) : null,
        };
      }),
    )
    .filter((server) => server.name && server.command);
}

function resolveGitHubManifestUrl(input) {
  const url = new URL(input);
  if (url.hostname === "raw.githubusercontent.com") {
    return url.toString();
  }
  if (url.hostname !== "github.com") {
    return url.toString();
  }
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    throw new Error("GitHub plugin URL must point to a repository or plugin.json file.");
  }
  const [owner, repo] = parts;
  if (parts[2] === "blob" && parts.length >= 5) {
    const branch = parts[3];
    const filePath = parts.slice(4).join("/");
    return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${filePath}`;
  }
  const branch = parts[2] === "tree" && parts[3] ? parts[3] : "main";
  const subdir = parts[2] === "tree" && parts.length > 4 ? `${parts.slice(4).join("/")}/` : "";
  return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${subdir}plugin.json`;
}

async function fetchManifest(url) {
  const response = await fetch(url, { headers: { Accept: "application/json,text/plain,*/*" } });
  if (!response.ok) {
    throw new Error(`Could not download plugin manifest (${response.status}).`);
  }
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Downloaded plugin manifest is not valid JSON.");
  }
}

async function installPluginFromUrl(userDataDir, sourceUrl, options = {}) {
  const manifestUrl = resolveGitHubManifestUrl(sourceUrl);
  const manifest = await fetchManifest(manifestUrl);
  const plugin = normalizePlugin(manifest, {
    manifestUrl,
    sourceUrl,
    repository: sourceUrl,
    homepage: sourceUrl,
    publisher: options.publisher || "community",
    verifiedAt: options.verifiedAt || "",
  });
  const targetDir = path.dirname(installedPluginPath(userDataDir, plugin.id));
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(installedPluginPath(userDataDir, plugin.id), JSON.stringify(plugin, null, 2), "utf8");

  const state = readPluginState(userDataDir);
  const trustedCommunity = new Set(state.trustedCommunity);
  if (options.trusted || options.verifiedAt) {
    trustedCommunity.add(plugin.id);
  }
  writePluginState(userDataDir, {
    ...state,
    installed: [...state.installed, plugin.id],
    trustedCommunity: Array.from(trustedCommunity),
    enabled: {
      ...state.enabled,
      [plugin.id]: true,
    },
  });
  return listPlugins(userDataDir);
}

function enabledPluginContext(userDataDir) {
  const enabled = listPlugins(userDataDir).plugins.filter((plugin) => plugin.enabled);
  if (!enabled.length) {
    return "";
  }
  return enabled
    .map((plugin) => {
      const serverNames = (plugin.mcpServers || []).map((server) => server.name).filter(Boolean);
      const tools = plugin.tools?.length
        ? plugin.tools
            .map((tool) => {
              const schema = tool.inputSchema ? ` inputSchema: ${JSON.stringify(tool.inputSchema)}` : "";
              return `  - serverName: ${serverNames[0] || "plugin"}, toolName: ${tool.name}: ${tool.description || "No description"}${schema}`;
            })
            .join("\n")
        : "  - No executable tools yet; use this plugin as capability guidance.";
      return `- ${plugin.label} (${plugin.publisher}, ${plugin.version})\n${tools}`;
    })
    .join("\n");
}

module.exports = {
  enabledPluginContext,
  installPluginFromUrl,
  listPlugins,
  pluginMcpServers,
  setPluginEnabled,
  setPluginInstalled,
};
