const { getPluginAccessToken, savePluginAuth } = require("./pluginAuth.cjs");

const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Local-Agent-Studio",
    },
    body: new URLSearchParams(params),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.message || `${url} failed with ${response.status}`);
  }
  return data;
}

async function fetchGitHubUser(accessToken) {
  if (!accessToken) {
    return null;
  }
  const response = await fetch(USER_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "Local-Agent-Studio",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json();
  return {
    id: data.id,
    login: data.login,
    name: data.name || "",
    url: data.html_url || "",
    avatarUrl: data.avatar_url || "",
  };
}

function expiryFromSeconds(seconds) {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }
  return new Date(Date.now() + value * 1000).toISOString();
}

function resultPayload(pluginId, label, ok, stdout, stderr = "", extra = {}) {
  return {
    pluginId,
    label,
    ok,
    result: {
      exitCode: ok ? 0 : 1,
      stdout,
      stderr,
      timedOut: false,
    },
    check: ok
      ? {
          exitCode: 0,
          stdout,
          stderr: "",
          timedOut: false,
        }
      : null,
    install: null,
    ...extra,
  };
}

async function pollForToken(clientId, deviceCode, intervalSeconds, expiresInSeconds) {
  let interval = Math.max(1, Number(intervalSeconds || 5));
  const deadline = Date.now() + Math.max(60, Number(expiresInSeconds || 900)) * 1000;
  while (Date.now() < deadline) {
    await sleep(interval * 1000);
    const token = await postForm(ACCESS_TOKEN_URL, {
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });

    if (token.access_token) {
      return token;
    }
    if (token.error === "authorization_pending") {
      continue;
    }
    if (token.error === "slow_down") {
      interval += 5;
      continue;
    }
    if (token.error === "access_denied") {
      throw new Error("GitHub sign-in was denied.");
    }
    if (token.error === "expired_token") {
      throw new Error("GitHub sign-in code expired. Try signing in again.");
    }
    throw new Error(token.error_description || token.error || "GitHub sign-in failed.");
  }
  throw new Error("GitHub sign-in timed out.");
}

async function runGitHubDeviceAuth({ userDataDir, plugin, openDeviceCode }) {
  const auth = plugin.auth || {};
  const pluginId = plugin.id;
  const label = auth.label || "Sign in with GitHub";
  const clientId = auth.clientId || process.env.GITHUB_APP_CLIENT_ID || process.env.GITHUB_CLIENT_ID || "";
  if (!clientId) {
    throw new Error("GitHub Client ID is missing in plugin auth config.");
  }

  const existingToken = getPluginAccessToken(userDataDir, pluginId);
  const existingUser = await fetchGitHubUser(existingToken);
  if (existingUser) {
    return resultPayload(pluginId, label, true, `Already signed in to GitHub as ${existingUser.login}.`, "", {
      auth: {
        provider: "github",
        account: existingUser,
      },
    });
  }

  const device = await postForm(DEVICE_CODE_URL, {
    client_id: clientId,
  });
  if (!device.device_code || !device.user_code || !device.verification_uri) {
    throw new Error("GitHub did not return a valid device login code.");
  }

  await openDeviceCode?.({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    verificationUriComplete: device.verification_uri_complete || "",
    expiresIn: device.expires_in,
  });

  const token = await pollForToken(clientId, device.device_code, device.interval, device.expires_in);
  const account = await fetchGitHubUser(token.access_token);
  savePluginAuth(userDataDir, pluginId, {
    provider: "github",
    tokenType: token.token_type || "bearer",
    accessToken: token.access_token,
    refreshToken: token.refresh_token || "",
    expiresAt: expiryFromSeconds(token.expires_in),
    refreshExpiresAt: expiryFromSeconds(token.refresh_token_expires_in),
    scope: token.scope || "",
    account,
  });

  const login = account?.login || "GitHub";
  return resultPayload(pluginId, label, true, `Signed in to GitHub as ${login}. Token stored locally.`, "", {
    auth: {
      provider: "github",
      account,
      expiresAt: expiryFromSeconds(token.expires_in),
    },
  });
}

module.exports = {
  runGitHubDeviceAuth,
};
