const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function memoryPath(userDataDir) {
  return path.join(userDataDir, "memory.json");
}

function normalizeEntry(entry) {
  return {
    id: String(entry.id || randomUUID()),
    content: String(entry.content || "").trim(),
    createdAt: entry.createdAt || new Date().toISOString(),
    source: entry.source ? String(entry.source) : undefined,
  };
}

function readMemory(userDataDir) {
  const filePath = memoryPath(userDataDir);
  if (!fs.existsSync(filePath)) {
    return { entries: [] };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const entries = Array.isArray(parsed.entries) ? parsed.entries.map(normalizeEntry).filter((entry) => entry.content) : [];
    return { entries };
  } catch {
    return { entries: [] };
  }
}

function writeMemory(userDataDir, store) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const entries = Array.isArray(store?.entries) ? store.entries.map(normalizeEntry).filter((entry) => entry.content) : [];
  const data = { entries };
  fs.writeFileSync(memoryPath(userDataDir), JSON.stringify(data, null, 2), "utf8");
  return data;
}

function addMemory(userDataDir, content, source = "manual", maxEntries = 80) {
  const text = String(content || "").trim();
  if (!text) {
    throw new Error("Memory content is empty");
  }
  const store = readMemory(userDataDir);
  const next = [
    normalizeEntry({
      content: text,
      source,
    }),
    ...store.entries,
  ].slice(0, Math.max(1, Math.min(Number(maxEntries || 80), 500)));
  return writeMemory(userDataDir, { entries: next });
}

function deleteMemory(userDataDir, id) {
  const store = readMemory(userDataDir);
  return writeMemory(userDataDir, {
    entries: store.entries.filter((entry) => entry.id !== id),
  });
}

function clearMemory(userDataDir) {
  return writeMemory(userDataDir, { entries: [] });
}

function memoryContext(userDataDir, settings) {
  if (!settings?.memory?.enabled) {
    return "";
  }
  const entries = readMemory(userDataDir).entries.slice(0, Math.max(1, Math.min(Number(settings.memory.maxEntries || 80), 500)));
  if (!entries.length) {
    return "";
  }
  return entries.map((entry, index) => `[${index + 1}] ${entry.content}`).join("\n");
}

module.exports = {
  addMemory,
  clearMemory,
  deleteMemory,
  memoryContext,
  memoryPath,
  readMemory,
  writeMemory,
};
