const fs = require("node:fs");
const path = require("node:path");

function normalizeVersion(value) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "");
}

function compareVersions(a, b) {
  const left = normalizeVersion(a).split(".").map((item) => Number(item) || 0);
  const right = normalizeVersion(b).split(".").map((item) => Number(item) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if ((left[index] || 0) > (right[index] || 0)) {
      return 1;
    }
    if ((left[index] || 0) < (right[index] || 0)) {
      return -1;
    }
  }
  return 0;
}

function localVersionFromFile() {
  const candidates = [
    path.join(__dirname, "..", "..", "version.json"),
    path.join(process.cwd(), "version.json"),
  ];
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed.version) {
        return normalizeVersion(parsed.version);
      }
    } catch {
      // Try the next path.
    }
  }
  return "0.2.1";
}

async function checkForUpdates(settings) {
  const currentVersion = localVersionFromFile();
  if (!settings.updates?.enabled) {
    return {
      enabled: false,
      currentVersion,
      updateAvailable: false,
    };
  }

  const repo = settings.updates?.repo || "CrazyDashTool/Local-Agent-Studio";
  const versionUrl = settings.updates?.versionUrl || `https://raw.githubusercontent.com/${repo}/main/version.json`;
  try {
    const response = await fetch(versionUrl, {
      headers: {
        Accept: "application/json,text/plain,*/*",
        "User-Agent": "Local-Agent-Studio",
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${text || "Version check failed"}`);
    }

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { version: text.trim() };
    }
    const latestVersion = normalizeVersion(data.version || data.tag_name || data.name || "");
    return {
      enabled: true,
      currentVersion,
      latestVersion,
      updateAvailable: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
      url: data.url || `https://github.com/${repo}/releases`,
      notes: data.notes || "",
    };
  } catch (error) {
    return {
      enabled: true,
      currentVersion,
      updateAvailable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

module.exports = {
  checkForUpdates,
};
