const fs = require("node:fs");
const path = require("node:path");

function authStorePath(userDataDir) {
  return path.join(userDataDir, "plugin-auth.json");
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function getSafeStorage() {
  try {
    return require("electron").safeStorage;
  } catch {
    return null;
  }
}

function encryptSecret(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  const safeStorage = getSafeStorage();
  if (safeStorage?.isEncryptionAvailable?.()) {
    try {
      return `safe:v1:${safeStorage.encryptString(text).toString("base64")}`;
    } catch {
      // Fall through to portable storage if the OS keychain is unavailable.
    }
  }
  return `plain:v1:${Buffer.from(text, "utf8").toString("base64")}`;
}

function decryptSecret(value) {
  const text = String(value || "");
  if (!text) {
    return "";
  }
  if (text.startsWith("safe:v1:")) {
    const safeStorage = getSafeStorage();
    if (!safeStorage?.isEncryptionAvailable?.()) {
      return "";
    }
    try {
      return safeStorage.decryptString(Buffer.from(text.slice("safe:v1:".length), "base64"));
    } catch {
      return "";
    }
  }
  if (text.startsWith("plain:v1:")) {
    try {
      return Buffer.from(text.slice("plain:v1:".length), "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return text;
}

function readAuthStore(userDataDir) {
  const parsed = readJson(authStorePath(userDataDir), { plugins: {} });
  return {
    plugins: parsed.plugins && typeof parsed.plugins === "object" ? parsed.plugins : {},
  };
}

function writeAuthStore(userDataDir, store) {
  writeJson(authStorePath(userDataDir), {
    plugins: store.plugins && typeof store.plugins === "object" ? store.plugins : {},
  });
}

function readPluginAuth(userDataDir, pluginId) {
  const raw = readAuthStore(userDataDir).plugins[String(pluginId || "")] || null;
  if (!raw) {
    return null;
  }
  return {
    ...raw,
    accessToken: decryptSecret(raw.accessToken),
    refreshToken: decryptSecret(raw.refreshToken),
  };
}

function savePluginAuth(userDataDir, pluginId, auth) {
  const store = readAuthStore(userDataDir);
  store.plugins[String(pluginId)] = {
    provider: auth.provider || "github",
    tokenType: auth.tokenType || "bearer",
    accessToken: encryptSecret(auth.accessToken),
    refreshToken: encryptSecret(auth.refreshToken),
    expiresAt: auth.expiresAt || "",
    refreshExpiresAt: auth.refreshExpiresAt || "",
    scope: auth.scope || "",
    account: auth.account || null,
    updatedAt: new Date().toISOString(),
  };
  writeAuthStore(userDataDir, store);
  return readPluginAuth(userDataDir, pluginId);
}

function deletePluginAuth(userDataDir, pluginId) {
  const store = readAuthStore(userDataDir);
  delete store.plugins[String(pluginId || "")];
  writeAuthStore(userDataDir, store);
}

function tokenIsFresh(auth, skewMs = 5 * 60 * 1000) {
  if (!auth?.accessToken) {
    return false;
  }
  if (!auth.expiresAt) {
    return true;
  }
  const expiresAtMs = Date.parse(auth.expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs - skewMs > Date.now();
}

function getPluginAccessToken(userDataDir, pluginId) {
  const auth = readPluginAuth(userDataDir, pluginId);
  return tokenIsFresh(auth) ? auth.accessToken : "";
}

function getPluginAuthSummary(userDataDir, pluginId) {
  const auth = readPluginAuth(userDataDir, pluginId);
  if (!auth?.accessToken) {
    return {
      signedIn: false,
    };
  }
  return {
    signedIn: tokenIsFresh(auth),
    provider: auth.provider || "github",
    account: auth.account || null,
    expiresAt: auth.expiresAt || "",
    updatedAt: auth.updatedAt || "",
  };
}

module.exports = {
  deletePluginAuth,
  getPluginAccessToken,
  getPluginAuthSummary,
  readPluginAuth,
  savePluginAuth,
  tokenIsFresh,
};
