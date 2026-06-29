#!/usr/bin/env node
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

const workspaceRoot = path.resolve(process.env.LAS_WORKSPACE || process.cwd());
let cachedGitHubToken = process.env.GITHUB_TOKEN || "";

function jsonText(text) {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

function insideWorkspace(targetPath) {
  const resolved = path.resolve(targetPath || workspaceRoot);
  return resolved === workspaceRoot || resolved.startsWith(`${workspaceRoot}${path.sep}`);
}

function resolveRepoPath(repoPath) {
  const resolved = path.resolve(workspaceRoot, repoPath || ".");
  if (!insideWorkspace(resolved)) {
    throw new Error("Path is outside LAS_WORKSPACE.");
  }
  return resolved;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args.map(String), {
      cwd: options.cwd || workspaceRoot,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      windowsHide: true,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}

function normalizeRepoUrl(args) {
  const raw = String(args.repoUrl || args.repository || args.repo || args.url || "").trim();
  if (!raw) {
    throw new Error("repoUrl is required.");
  }
  if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(raw)) {
    return `https://github.com/${raw}.git`;
  }
  if (/^github\.com\//i.test(raw)) {
    return `https://${raw.replace(/\/$/, "")}.git`;
  }
  return raw;
}

async function gitAuthArgs(repoUrl = "") {
  const token = await getGitHubToken();
  if (!token || !/github\.com/i.test(repoUrl)) {
    return [];
  }
  return ["-c", `http.https://github.com/.extraheader=AUTHORIZATION: bearer ${token}`];
}

async function githubRequest(url) {
  const token = await getGitHubToken();
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Local-Agent-Studio-GitHub-Git-Operator",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function getGitHubToken() {
  if (cachedGitHubToken) {
    return cachedGitHubToken;
  }
  const result = await run("gh", ["auth", "token", "--hostname", "github.com"], { cwd: workspaceRoot });
  if (result.exitCode === 0 && result.stdout.trim()) {
    cachedGitHubToken = result.stdout.trim();
  }
  return cachedGitHubToken;
}

async function listRepos(args) {
  const limit = Math.max(1, Math.min(Number(args.limit || 20), 100));
  const owner = String(args.owner || "").trim();
  if (!owner && !(await getGitHubToken())) {
    throw new Error("GitHub sign-in is required. Use the plugin Sign in button or set GITHUB_TOKEN.");
  }
  const url = owner
    ? `https://api.github.com/users/${encodeURIComponent(owner)}/repos?per_page=${limit}&sort=updated`
    : `https://api.github.com/user/repos?per_page=${limit}&sort=updated&affiliation=owner,collaborator,organization_member`;
  const repos = await githubRequest(url);
  return jsonText(
    repos
      .slice(0, limit)
      .map((repo) => `${repo.full_name}\n  ${repo.html_url}\n  ${repo.description || "No description"}\n  updated: ${repo.updated_at}`)
      .join("\n\n") || "No repositories found.",
  );
}

async function cloneRepo(args) {
  const repoUrl = normalizeRepoUrl(args);
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const directory = String(args.directory || "").trim();
  const target = directory ? path.resolve(workspaceRoot, directory) : workspaceRoot;
  if (!insideWorkspace(target)) {
    throw new Error("Clone target is outside LAS_WORKSPACE.");
  }
  const authArgs = await gitAuthArgs(repoUrl);
  const gitArgs = directory ? [...authArgs, "clone", repoUrl, target] : [...authArgs, "clone", repoUrl];
  const result = await run("git", gitArgs, { cwd: workspaceRoot });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "git clone failed");
  }
  return jsonText(`Cloned ${repoUrl}\n\n${result.stdout || result.stderr}`);
}

async function gitStatus(args) {
  const repo = resolveRepoPath(args.repoPath);
  const result = await run("git", ["-C", repo, "status", "--short", "--branch"], { cwd: repo });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "git status failed");
  }
  return jsonText(result.stdout || "Clean working tree.");
}

async function gitLog(args) {
  const repo = resolveRepoPath(args.repoPath);
  const limit = Math.max(1, Math.min(Number(args.limit || 8), 50));
  const result = await run("git", ["-C", repo, "log", `-${limit}`, "--oneline", "--decorate"], { cwd: repo });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || "git log failed");
  }
  return jsonText(result.stdout || "No commits.");
}

async function gitCommit(args) {
  if (process.env.LAS_ALLOW_COMMITS === "false") {
    throw new Error("Commits are disabled by LAS_ALLOW_COMMITS=false.");
  }
  const message = String(args.message || "").trim();
  if (!message) {
    throw new Error("message is required.");
  }
  const repo = resolveRepoPath(args.repoPath);
  if (args.addAll) {
    const addAll = await run("git", ["-C", repo, "add", "-A"], { cwd: repo });
    if (addAll.exitCode !== 0) {
      throw new Error(addAll.stderr || "git add failed");
    }
  } else if (Array.isArray(args.paths) && args.paths.length) {
    for (const item of args.paths) {
      const filePath = path.resolve(repo, String(item));
      if (!insideWorkspace(filePath)) {
        throw new Error(`Commit path is outside LAS_WORKSPACE: ${item}`);
      }
    }
    const add = await run("git", ["-C", repo, "add", ...args.paths.map(String)], { cwd: repo });
    if (add.exitCode !== 0) {
      throw new Error(add.stderr || "git add failed");
    }
  }
  const result = await run("git", ["-C", repo, "commit", "-m", message], { cwd: repo });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "git commit failed");
  }
  return jsonText(result.stdout || "Commit created.");
}

async function gitPush(args) {
  if (process.env.LAS_ALLOW_PUSH === "false") {
    throw new Error("Push is disabled by LAS_ALLOW_PUSH=false.");
  }
  const repo = resolveRepoPath(args.repoPath);
  const remote = String(args.remote || "origin").trim();
  let branch = String(args.branch || "").trim();
  if (!remote) {
    throw new Error("remote is required.");
  }
  if (!branch) {
    const currentBranch = await run("git", ["-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], { cwd: repo });
    if (currentBranch.exitCode !== 0) {
      throw new Error(currentBranch.stderr || "Could not detect current git branch.");
    }
    branch = currentBranch.stdout.trim();
  }
  if (!branch || branch === "HEAD") {
    throw new Error("Could not detect a named branch to push. Pass branch explicitly.");
  }
  const gitArgs = ["-C", repo, "push"];
  const authArgs = await gitAuthArgs("https://github.com/");
  gitArgs.unshift(...authArgs);
  if (args.forceWithLease) {
    gitArgs.push("--force-with-lease");
  }
  if (args.setUpstream) {
    gitArgs.push("-u");
  }
  gitArgs.push(remote, branch);
  const result = await run("git", gitArgs, { cwd: repo });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "git push failed");
  }
  return jsonText(result.stdout || result.stderr || `Pushed ${branch} to ${remote}.`);
}

const tools = [
  {
    name: "github_list_repos",
    description: "List GitHub repositories for the authenticated user or a public owner.",
    inputSchema: {
      type: "object",
      properties: {
        owner: { type: "string" },
        limit: { type: "number", default: 20 },
      },
    },
  },
  {
    name: "git_clone",
    description: "Clone a Git repository into LAS_WORKSPACE.",
    inputSchema: {
      type: "object",
      properties: {
        repoUrl: {
          type: "string",
          description: "Repository URL or owner/name, for example https://github.com/CrazyDashTool/LAS-github or CrazyDashTool/LAS-github.",
        },
        repository: { type: "string", description: "Alias for repoUrl." },
        repo: { type: "string", description: "Alias for repoUrl." },
        url: { type: "string", description: "Alias for repoUrl." },
        directory: { type: "string" },
      },
    },
  },
  {
    name: "git_status",
    description: "Show short git status for a local repository.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
      },
    },
  },
  {
    name: "git_commit",
    description: "Create a local git commit. This does not push unless git_push is called separately.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        message: { type: "string" },
        addAll: { type: "boolean", default: false },
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["message"],
    },
  },
  {
    name: "git_push",
    description: "Push the current branch to a remote. Requires GitHub sign-in or existing git credentials.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        remote: { type: "string", default: "origin" },
        branch: { type: "string" },
        setUpstream: { type: "boolean", default: false },
        forceWithLease: { type: "boolean", default: false },
      },
    },
  },
  {
    name: "git_log",
    description: "Show recent commits.",
    inputSchema: {
      type: "object",
      properties: {
        repoPath: { type: "string" },
        limit: { type: "number", default: 8 },
      },
    },
  },
];

const handlers = {
  github_list_repos: listRepos,
  git_clone: cloneRepo,
  git_status: gitStatus,
  git_commit: gitCommit,
  git_push: gitPush,
  git_log: gitLog,
};

async function handleRequest(message) {
  if (message.method === "initialize") {
    return {
      protocolVersion: "2024-11-05",
      capabilities: { tools: {} },
      serverInfo: {
        name: "las-github-git-operator",
        version: "0.1.0",
      },
    };
  }
  if (message.method === "tools/list") {
    return { tools };
  }
  if (message.method === "tools/call") {
    const name = message.params?.name;
    const handler = handlers[name];
    if (!handler) {
      throw new Error(`Unknown tool: ${name}`);
    }
    return handler(message.params?.arguments || {});
  }
  return {};
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", async (line) => {
  if (!line.trim()) {
    return;
  }
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!message.id) {
    return;
  }
  try {
    const result = await handleRequest(message);
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    send({
      jsonrpc: "2.0",
      id: message.id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

process.stderr.write(`GitHub Git Operator MCP running in ${workspaceRoot}${os.EOL}`);
