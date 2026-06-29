const fs = require("node:fs");
const path = require("node:path");

function executionLogPath(userDataDir) {
  return path.join(userDataDir, "execution-log.jsonl");
}

function appendExecutionLog(userDataDir, entry) {
  if (!userDataDir) {
    return null;
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  const record = {
    id: `exec-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    time: new Date().toISOString(),
    ...entry,
  };
  fs.appendFileSync(executionLogPath(userDataDir), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

function readExecutionLog(userDataDir, limit = 200) {
  const filePath = executionLogPath(userDataDir);
  if (!fs.existsSync(filePath)) {
    return { filePath, entries: [] };
  }
  const rows = fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(Number(limit || 200), 1000)))
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .reverse();
  return { filePath, entries: rows };
}

module.exports = {
  appendExecutionLog,
  readExecutionLog,
};
