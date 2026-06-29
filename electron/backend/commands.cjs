const fs = require("node:fs");
const path = require("node:path");

function pathKey(env) {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") || "Path";
}

function unique(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const value = String(item || "").trim();
    const key = process.platform === "win32" ? value.toLowerCase() : value;
    if (!value || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}

function windowsCommandDirs(env) {
  if (process.platform !== "win32") {
    return [];
  }
  const localAppData = env.LOCALAPPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, "AppData", "Local") : "");
  const appData = env.APPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, "AppData", "Roaming") : "");
  return [
    env.ProgramFiles ? path.join(env.ProgramFiles, "nodejs") : "",
    env["ProgramFiles(x86)"] ? path.join(env["ProgramFiles(x86)"], "nodejs") : "",
    appData ? path.join(appData, "npm") : "",
    localAppData ? path.join(localAppData, "Programs", "GitHub CLI") : "",
    env.ProgramFiles ? path.join(env.ProgramFiles, "GitHub CLI") : "",
    env["ProgramFiles(x86)"] ? path.join(env["ProgramFiles(x86)"], "GitHub CLI") : "",
    env.ProgramFiles ? path.join(env.ProgramFiles, "Git", "cmd") : "",
    env.ProgramFiles ? path.join(env.ProgramFiles, "Git", "bin") : "",
  ];
}

function normalizeCommandEnv(extraEnv = {}) {
  const env = {
    ...process.env,
    ...extraEnv,
  };
  const key = pathKey(env);
  const existing = String(env[key] || env.PATH || "").split(path.delimiter);
  env[key] = unique([...existing, ...windowsCommandDirs(env)]).join(path.delimiter);
  if (key !== "PATH") {
    env.PATH = env[key];
  }
  return env;
}

function hasPathSeparator(command) {
  return command.includes("/") || command.includes("\\");
}

function commandNames(command) {
  if (process.platform !== "win32") {
    return [command];
  }
  const ext = path.extname(command);
  if (ext) {
    return [command];
  }
  const pathext = String(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return [command, ...pathext.map((extname) => `${command}${extname}`)];
}

function findOnPath(command, env) {
  if (!command) {
    return "";
  }
  if (path.isAbsolute(command) || hasPathSeparator(command)) {
    return fs.existsSync(command) ? command : "";
  }
  const dirs = String(env[pathKey(env)] || env.PATH || "").split(path.delimiter);
  for (const dir of dirs) {
    for (const name of commandNames(command)) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return "";
}

function npmCliPath(nodeCommand, toolName) {
  const nodeDir = nodeCommand ? path.dirname(nodeCommand) : "";
  const cliName = toolName === "npm" ? "npm-cli.js" : "npx-cli.js";
  const candidates = [
    nodeDir ? path.join(nodeDir, "node_modules", "npm", "bin", cliName) : "",
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs", "node_modules", "npm", "bin", cliName) : "",
    process.env["ProgramFiles(x86)"] ? path.join(process.env["ProgramFiles(x86)"], "nodejs", "node_modules", "npm", "bin", cliName) : "",
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || "";
}

function resolveSpawnCommand(command, args = [], extraEnv = {}) {
  const env = normalizeCommandEnv(extraEnv);
  const rawCommand = String(command || "").trim();
  const baseName = path.basename(rawCommand).toLowerCase().replace(/\.(cmd|bat|exe)$/i, "");

  if (baseName === "npx" || baseName === "npm") {
    const nodeCommand = findOnPath("node", env);
    const cliPath = npmCliPath(nodeCommand, baseName);
    if (nodeCommand && cliPath) {
      return {
        command: nodeCommand,
        args: [cliPath, ...args.map(String)],
        env,
        shell: false,
      };
    }
  }

  const resolved = findOnPath(rawCommand, env);
  if (!resolved) {
    const hint =
      baseName === "npx" || baseName === "npm"
        ? "Install Node.js from https://nodejs.org/ or add Node.js to PATH."
        : baseName === "gh"
          ? "Install GitHub CLI from https://cli.github.com/ or add gh to PATH."
          : "Install the command or add it to PATH.";
    throw new Error(`Required command "${rawCommand}" was not found. ${hint}`);
  }

  return {
    command: resolved,
    args: args.map(String),
    env,
    shell: false,
  };
}

module.exports = {
  normalizeCommandEnv,
  resolveSpawnCommand,
};
