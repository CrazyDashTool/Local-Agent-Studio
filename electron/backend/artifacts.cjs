const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { resolveWorkspacePath } = require("./files.cjs");

const KIND_EXTENSIONS = {
  text: ".txt",
  code: ".txt",
  markdown: ".md",
  json: ".json",
  design: ".md",
  other: ".txt",
};

function artifactRoot(settings) {
  const target = resolveWorkspacePath(settings, "Artifacts");
  fs.mkdirSync(target.absolutePath, { recursive: true });
  return target;
}

function metadataPath(settings) {
  return path.join(artifactRoot(settings).absolutePath, ".artifacts.json");
}

function sanitizeName(name) {
  return String(name || "artifact")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90) || "artifact";
}

function extensionFor(kind, name) {
  const ext = path.extname(name);
  if (ext) {
    return "";
  }
  return KIND_EXTENSIONS[kind] || ".txt";
}

function kindFromPath(filePath, fallback = "text") {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".md") {
    return "markdown";
  }
  if (ext === ".json") {
    return "json";
  }
  if ([".js", ".jsx", ".ts", ".tsx", ".py", ".ps1", ".html", ".css"].includes(ext)) {
    return "code";
  }
  return fallback;
}

function readMetadata(settings) {
  const filePath = metadataPath(settings);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(parsed.artifacts) ? parsed.artifacts : [];
  } catch {
    return [];
  }
}

function writeMetadata(settings, artifacts) {
  fs.writeFileSync(metadataPath(settings), JSON.stringify({ artifacts }, null, 2), "utf8");
}

function infoFor(settings, meta, includeContent = false) {
  const root = artifactRoot(settings);
  const absolutePath = path.join(root.absolutePath, meta.relativePath.replace(/^Artifacts[\\/]/i, ""));
  const stat = fs.existsSync(absolutePath) ? fs.statSync(absolutePath) : null;
  return {
    ...meta,
    absolutePath,
    size: stat?.isFile() ? stat.size : 0,
    updatedAt: stat?.mtime ? stat.mtime.toISOString() : meta.updatedAt,
    content: includeContent && stat?.isFile() ? fs.readFileSync(absolutePath, "utf8") : undefined,
  };
}

function listArtifacts({ settings }) {
  return {
    root: artifactRoot(settings).absolutePath,
    artifacts: readMetadata(settings).map((meta) => infoFor(settings, meta, false)),
  };
}

function readArtifact({ settings, id }) {
  const meta = readMetadata(settings).find((item) => item.id === id || item.relativePath === id || item.name === id);
  if (!meta) {
    throw new Error(`Artifact not found: ${id}`);
  }
  return infoFor(settings, meta, true);
}

function writeArtifact({ settings, name, content = "", kind = "text", id }) {
  const root = artifactRoot(settings);
  const cleanName = sanitizeName(name || id || "artifact");
  const fileName = `${cleanName}${extensionFor(kind, cleanName)}`;
  const relativePath = fileName;
  const absolutePath = path.join(root.absolutePath, relativePath);
  const createdAt = new Date().toISOString();
  const current = readMetadata(settings);
  const existingIndex = current.findIndex((item) => item.id === id || item.name === name || item.relativePath === relativePath);
  const existing = existingIndex >= 0 ? current[existingIndex] : null;

  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, String(content), "utf8");

  const meta = {
    id: existing?.id || id || randomUUID(),
    name: cleanName,
    kind: kindFromPath(fileName, kind),
    relativePath,
    absolutePath,
    createdAt: existing?.createdAt || createdAt,
    updatedAt: new Date().toISOString(),
    size: Buffer.byteLength(String(content)),
  };

  if (existingIndex >= 0) {
    current[existingIndex] = meta;
  } else {
    current.unshift(meta);
  }
  writeMetadata(settings, current);
  return {
    root: root.absolutePath,
    artifact: {
      ...meta,
      content: String(content),
    },
  };
}

function appendArtifact({ settings, id, content = "" }) {
  const artifact = readArtifact({ settings, id });
  return writeArtifact({
    settings,
    id: artifact.id,
    name: artifact.name,
    kind: artifact.kind,
    content: `${artifact.content || ""}${String(content)}`,
  });
}

module.exports = {
  appendArtifact,
  listArtifacts,
  readArtifact,
  writeArtifact,
};
