const path = require("node:path");
const { endpoint, fetchJson } = require("./fetch.cjs");
const { searchWeb } = require("./search.cjs");
const { queueComfyPrompt } = require("./comfy.cjs");
const { createDatabaseFromText } = require("./data.cjs");
const { runCommand } = require("./sandbox.cjs");
const {
  appendTextFile,
  deleteWorkspacePath,
  listFiles,
  readTextFile,
  writeTextFile,
} = require("./files.cjs");
const { attachmentContext, imageBase64List } = require("./attachments.cjs");

const SEARCH_TRIGGER =
  /(\/search\b|\b(search|lookup|latest|today|news|price|compare|find|web|internet|google|browse|current)\b|актуальн|сегодня|новост|цен[ауы]|стоимост|сколько стоит|найд[иу]|поищ|поиск|интернет|гугл|загугл|сравни|останні|сьогодні|ціна|пошук|szukaj|cena|aktualn|heute|preis|suche)/i;

const FILE_TRIGGER =
  /(\/file\b|\b(file|document|workspace|read|write|append|delete|save|create|make|edit|open)\b|файл|документ|воркспейс|рабоч[аяе]|прочитай|покажи|создай|сделай|запиши|сохрани|измени|удали|добавь|створи|plik|datei)/i;

const IMAGE_TRIGGER =
  /(\/image\b|\b(generate|create|draw|make|render)\b.*\b(image|picture|photo|logo|illustration|poster)\b|\b(image|picture|photo|logo)\b|сгенерируй|нарисуй|картинк|изображени|фото|логотип|ілюстрац|obraz|bild)/i;

const DATABASE_TRIGGER =
  /(\/db\b|\/database\b|\b(database|sqlite|db|dataset|table)\b|баз[ауые] данных|бд\b|sqlite|датасет|таблиц|базу|база|tabela|datenbank)/i;

const TEXT_EXTENSIONS = "txt|md|json|csv|html|htm|css|js|jsx|ts|tsx|py|ps1|bat|cmd|log|xml|yaml|yml";
const TOOL_ACTIONS = new Set([
  "answer",
  "write_file",
  "read_file",
  "append_file",
  "delete_path",
  "list_files",
  "run_command",
  "create_database",
  "generate_image",
]);

function clamp(value, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return min;
  }
  return Math.max(min, Math.min(parsed, max));
}

function lastUser(messages) {
  return [...messages].reverse().find((message) => message.role === "user") || { content: "", attachments: [] };
}

function compactContent(message) {
  const attachments = message.attachments || [];
  if (!attachments.length) {
    return message.content;
  }

  const nonImages = attachments.filter((attachment) => attachment.kind !== "image");
  if (!nonImages.length) {
    return message.content;
  }

  return `${message.content}\n\nAttached local files:\n${attachmentContext(nonImages)}`;
}

function compactMessages(messages, includeImages = true) {
  return messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-14)
    .map((message) => {
      const item = {
        role: message.role,
        content: compactContent(message),
      };
      if (includeImages && message.role === "user") {
        const images = imageBase64List(message.attachments || []);
        if (images.length) {
          item.images = images;
        }
      }
      return item;
    });
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function extractJsonArray(text) {
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      return [];
    }
    try {
      const parsed = JSON.parse(match[0]);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

function extractJsonObject(text) {
  if (!text) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      const parsed = JSON.parse(match[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function fallbackSearchQuery(messages) {
  return (lastUser(messages).content || "").replace(/^\/search\s+/i, "").trim();
}

function shouldSearch(messages, toolMode) {
  if (toolMode === "web") {
    return true;
  }
  if (toolMode === "none") {
    return false;
  }
  return SEARCH_TRIGGER.test(lastUser(messages).content || "");
}

async function resolveModel(settings, headers) {
  if (settings.ollama.model && settings.ollama.model !== "auto") {
    return settings.ollama.model;
  }

  const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/api/tags"), {
    headers,
    timeoutMs: 8000,
  });
  const models = Array.isArray(data.models) ? data.models : [];
  const localModel = models.find((model) => !String(model.name || "").includes("cloud"));
  const firstModel = (localModel || models[0])?.name;
  if (!firstModel) {
    throw new Error("Ollama responded, but no models are available. Pull a model or set one in Settings.");
  }
  return firstModel;
}

async function buildSearchQueries({ messages, settings, headers, model, maxQueries }) {
  const fallback = fallbackSearchQuery(messages);
  if (maxQueries <= 1 || !fallback) {
    return fallback ? [fallback] : [];
  }

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content:
          "Return only a JSON array of 1 to 3 concise web search queries. Use the user's language when helpful. Split the task into separate searches only when it improves factual coverage. No markdown, no commentary.",
      },
      ...compactMessages(messages, false),
    ],
    stream: false,
    options: {
      temperature: 0.1,
      num_ctx: Math.min(Number(settings.ollama.contextTokens ?? 8192), 8192),
    },
  };

  try {
    const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/api/chat"), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      timeoutMs: 30000,
    });
    const queries = extractJsonArray(data?.message?.content || "")
      .map((query) => String(query || "").trim())
      .filter(Boolean)
      .slice(0, maxQueries);
    return uniqueBy(queries.length ? queries : [fallback], (query) => query.toLowerCase()).slice(0, maxQueries);
  } catch {
    return [fallback];
  }
}

function collectSearchContext(toolResults) {
  const rows = [];
  for (const tool of toolResults) {
    for (const result of tool.results || []) {
      rows.push({
        ...result,
        query: tool.query,
      });
    }
  }

  return uniqueBy(rows, (result) => result.url || `${result.title}:${result.content}`)
    .slice(0, 12)
    .map((result, index) => {
      const source = result.source ? `Source: ${result.source}\n` : "";
      const query = result.query ? `Search query: ${result.query}\n` : "";
      return `[${index + 1}] ${result.title}\n${query}${source}URL: ${result.url}\nSnippet: ${result.content}`;
    })
    .join("\n\n");
}

function buildSystemPrompt(searchContext, settings) {
  const contextBlock = searchContext
    ? `\n\nWeb search context collected from up to ${clamp(settings.agent?.maxWebSearches ?? 3, 1, 3)} searches:\n${searchContext}\n\nUse the context to synthesize a clear answer. Cite sources inline like [1] only for facts that came from the web. Do not dump raw snippets or URL lists into the main answer.`
    : "";

  return `You are Local Agent Studio, a local-first desktop agent running on the user's Windows machine.
Answer in the user's language unless the UI asks otherwise. Be concise, practical, and honest about tool state.
Use Markdown naturally: short sections, bullets when useful, fenced code blocks for code, and bold text for emphasis.
Available integrations are executed by the app before or during the answer: Ollama chat, ComfyUI image workflows, web search, workspace file operations, local databases, and sandbox commands.
When the user attaches an image and asks what is in it, describe or analyze the attached image. Do not switch to image generation unless the user explicitly asks to create, generate, draw, render, or make a new visual asset.
Never claim that a search, file operation, image job, database creation, or command was executed unless a tool result is present. If a needed tool failed or is not configured, say that directly and explain what setting is missing.${contextBlock}`;
}

async function gatherSearchContext({ messages, settings, toolMode, headers, model, onEvent }) {
  const attempted = shouldSearch(messages, toolMode);
  if (!attempted) {
    return { attempted: false, searchContext: "", toolResults: [] };
  }

  const maxQueries = clamp(settings.agent?.maxWebSearches ?? 3, 1, 3);
  const queries = await buildSearchQueries({ messages, settings, headers, model, maxQueries });
  const toolResults = [];

  for (const [index, query] of queries.entries()) {
    const running = {
      type: "search",
      label: `Web search ${index + 1}/${queries.length}`,
      status: "running",
      query,
      results: [],
    };
    onEvent?.({ type: "tool-start", toolResult: running });

    try {
      const result = await searchWeb({ query, settings });
      const finished = {
        type: "search",
        label: `Web search (${result.provider})`,
        status: "done",
        query,
        results: result.results,
      };
      toolResults.push(finished);
      onEvent?.({ type: "tool-finish", toolResult: finished });
    } catch (error) {
      const failed = {
        type: "search",
        label: "Web search failed",
        status: "error",
        query,
        results: [],
        payload: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
      toolResults.push(failed);
      onEvent?.({ type: "tool-finish", toolResult: failed });
    }
  }

  return {
    attempted,
    searchContext: collectSearchContext(toolResults),
    toolResults,
  };
}

function cleanTail(value) {
  return String(value || "")
    .replace(/\s+(в\s+н[её]м|inside|in it)\s*$/i, "")
    .trim()
    .replace(/^[:\-]\s*/, "")
    .trim();
}

function extractFilePath(text) {
  const extensionPattern = new RegExp(`([\\p{L}\\p{N}_ .()\\-]+\\.(${TEXT_EXTENSIONS}))`, "iu");
  const codeMatch = text.match(new RegExp("`([^`]+\\.(" + TEXT_EXTENSIONS + "))`", "iu"));
  if (codeMatch) {
    return codeMatch[1].trim();
  }
  const quotedMatch = text.match(new RegExp("[\"«']([^\"»']+\\.(" + TEXT_EXTENSIONS + "))[\"»']", "iu"));
  if (quotedMatch) {
    return quotedMatch[1].trim();
  }
  const directMatch = text.match(extensionPattern);
  return directMatch ? directMatch[1].trim() : "";
}

function defaultFilePath(text) {
  if (/письм|letter/i.test(text) && /тест|test/i.test(text)) {
    return "test_letter.txt";
  }
  if (/json/i.test(text)) {
    return "data.json";
  }
  if (/csv|таблиц/i.test(text)) {
    return "data.csv";
  }
  if (/markdown|md/i.test(text)) {
    return "note.md";
  }
  return "note.txt";
}

function extractFileContent(text) {
  const codeBlock = text.match(/```(?:\w+)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    return codeBlock[1].trimEnd();
  }

  const quoted = text.match(/[«"`']([^«»"`']+)[»"`']/);
  if (quoted) {
    return quoted[1];
  }

  const russianLetter = text.match(/(?:с|со)\s+письм(?:ом|ом:)?\s*([\s\S]+)$/i);
  if (russianLetter) {
    return `письмо ${cleanTail(russianLetter[1])}`.trim();
  }

  const russianContent = text.match(/(?:с|со)\s+(?:содержимым|текстом)\s*([\s\S]+)$/i);
  if (russianContent) {
    return cleanTail(russianContent[1]);
  }

  const englishLetter = text.match(/\bwith\s+(?:a\s+)?letter\s*([\s\S]+)$/i);
  if (englishLetter) {
    return `letter ${cleanTail(englishLetter[1])}`.trim();
  }

  const englishContent = text.match(/\bwith\s+(?:content|text)\s*([\s\S]+)$/i);
  if (englishContent) {
    return cleanTail(englishContent[1]);
  }

  return "";
}

function fileListMarkdown(result) {
  if (!result.files.length) {
    return `Workspace is empty.\n\nRoot: \`${result.root}\``;
  }
  const rows = result.files
    .slice(0, 60)
    .map((file) => `- ${file.type === "directory" ? "folder" : "file"} \`${file.relativePath}\`${file.type === "file" ? ` (${file.size} bytes)` : ""}`)
    .join("\n");
  return `Workspace root: \`${result.root}\`\n\n${rows}`;
}

function normalizeToolDecision(decision, settings) {
  if (!decision || typeof decision !== "object") {
    return { action: "answer" };
  }

  const action = String(decision.action || "answer").trim();
  if (!TOOL_ACTIONS.has(action)) {
    return { action: "answer" };
  }

  const maxImageJobs = clamp(settings.agent?.maxImageJobs || 3, 1, 3);
  const allowedModels = new Set(["z-image-turbo", "flux2-klein-9b", "ideogram-v4"]);
  const allowedEffort = new Set(["turbo", "default", "quality"]);

  return {
    action,
    filePath: String(decision.filePath || "").replace(/^[/\\]+/, "").trim(),
    content: decision.content == null ? "" : String(decision.content),
    command: String(decision.command || "").trim(),
    databaseName: String(decision.databaseName || "objects").trim(),
    databaseText: decision.databaseText == null ? "" : String(decision.databaseText),
    query: String(decision.query || "").trim(),
    prompt: String(decision.prompt || "").trim(),
    count: clamp(decision.count || settings.image?.repeat || 1, 1, maxImageJobs),
    imageModel: allowedModels.has(decision.imageModel) ? decision.imageModel : settings.image?.model || "z-image-turbo",
    ideogramEffort: allowedEffort.has(decision.ideogramEffort)
      ? decision.ideogramEffort
      : settings.image?.ideogramEffort || "default",
    reason: String(decision.reason || "").trim(),
  };
}

async function decideToolWithOllama({ messages, settings, headers, model }) {
  const last = lastUser(messages);
  const attachmentSummary = attachmentContext(last.attachments || []);
  const recentMessages = compactMessages(messages, false)
    .slice(-8)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content: `You are the tool router for Local Agent Studio, a local-first desktop agent.
Choose exactly one action for the app to execute, or "answer" if no tool is needed.

Return only valid JSON with this schema:
{
  "action": "answer" | "write_file" | "read_file" | "append_file" | "delete_path" | "list_files" | "run_command" | "create_database" | "generate_image",
  "filePath": "relative workspace path, when a file/path action is needed",
  "content": "complete file content to write or append, when needed",
  "command": "terminal command, when action is run_command",
  "databaseName": "database name, when action is create_database",
  "databaseText": "JSON/CSV/text source for database, when action is create_database",
  "prompt": "final ComfyUI image prompt, when action is generate_image",
  "count": 1,
  "imageModel": "z-image-turbo" | "flux2-klein-9b" | "ideogram-v4",
  "ideogramEffort": "turbo" | "default" | "quality",
  "reason": "short reason"
}

Rules:
- Act like a CLI-capable assistant. If the user asks to create, edit, append, read, list, delete, run, or generate, choose the matching tool.
- If the user asks to create a file "on any topic" or without exact content, you must invent useful content and include the complete file text in "content".
- Never choose write_file with empty content unless the user explicitly asks for an empty file.
- File paths must be relative to the workspace. If the user gives no file name, choose a sensible one, e.g. "note.txt", "README.md", "todo.md", "data.json".
- Use create_database for requests to build/import/convert objects into a local database.
- Use generate_image only for a new visual asset. If the user attaches an image and asks what is on it, choose answer.
- Use run_command only when the user asks to execute a shell/CLI command or a task that clearly requires CLI execution.
- If the request is just conversation or analysis, choose answer.
- Default imageModel is "${settings.image?.model || "z-image-turbo"}".
- Default ideogramEffort is "${settings.image?.ideogramEffort || "default"}".
- Max image count is ${clamp(settings.agent?.maxImageJobs || 3, 1, 3)}.`,
      },
      {
        role: "user",
        content: `Recent conversation:
${recentMessages || "(none)"}

Latest user message:
${last.content || ""}

Attachments:
${attachmentSummary || "none"}`,
      },
    ],
    stream: false,
    options: {
      temperature: 0,
      num_ctx: Math.min(Number(settings.ollama.contextTokens ?? 8192), 8192),
    },
  };

  const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/api/chat"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeoutMs: Math.min(Number(settings.ollama.timeoutMs || 120000), 45000),
  });

  return normalizeToolDecision(extractJsonObject(data?.message?.content || ""), settings);
}

function fileIntent(text) {
  if (!FILE_TRIGGER.test(text)) {
    return null;
  }

  const filePath = extractFilePath(text);
  if (/(list|show workspace|workspace files|покажи файлы|список файлов|что в workspace|что в воркспейс|файлы в|list files)/i.test(text)) {
    return { action: "list", filePath: "" };
  }
  if (/(delete|remove|удали|стереть)/i.test(text) && filePath) {
    return { action: "delete", filePath };
  }
  if (/(append|add to file|добавь|допис|append)/i.test(text) && filePath) {
    return { action: "append", filePath, content: extractFileContent(text) };
  }
  if (/(read|open|show file|прочитай|открой|покажи файл)/i.test(text) && filePath) {
    return { action: "read", filePath };
  }
  if (/(create|make|save|write|создай|сделай|запиши|сохрани|створи)/i.test(text) && /(file|document|файл|документ|txt|md|json|csv)/i.test(text)) {
    return { action: "write", filePath: filePath || defaultFilePath(text), content: extractFileContent(text) };
  }
  if (/(edit|change|replace|измени|замени)/i.test(text) && filePath) {
    return { action: "write", filePath, content: extractFileContent(text) };
  }
  return null;
}

async function maybeHandleFileIntent({ messages, settings, toolMode, onEvent }) {
  if (toolMode === "none") {
    return null;
  }

  const text = lastUser(messages).content || "";
  const intent = fileIntent(text);
  if (!intent) {
    return null;
  }

  const labels = {
    append: "Append file",
    delete: "Delete file",
    list: "List workspace",
    read: "Read file",
    write: "Write file",
  };
  const running = {
    type: "file",
    label: labels[intent.action] || "Workspace file",
    status: "running",
    payload: intent,
  };
  onEvent?.({ type: "tool-start", toolResult: running });

  try {
    let result;
    let content;
    if (intent.action === "list") {
      result = listFiles({ settings, depth: 2 });
      content = fileListMarkdown(result);
    } else if (intent.action === "read") {
      result = readTextFile({ settings, filePath: intent.filePath });
      content = `Read \`${result.relativePath}\`.\n\n\`\`\`${path.extname(result.relativePath).slice(1) || "text"}\n${result.content}\n\`\`\``;
    } else if (intent.action === "append") {
      result = appendTextFile({ settings, filePath: intent.filePath, content: intent.content || "" });
      content = `Appended to \`${result.relativePath}\` in the workspace.\n\n\`\`\`text\n${intent.content || ""}\n\`\`\``;
    } else if (intent.action === "delete") {
      result = deleteWorkspacePath({ settings, filePath: intent.filePath });
      content = `Deleted \`${result.relativePath}\` from the workspace.`;
    } else {
      result = writeTextFile({ settings, filePath: intent.filePath, content: intent.content || "", overwrite: true });
      content = `Created \`${result.relativePath}\` in the workspace.\n\n\`\`\`text\n${result.content}\n\`\`\``;
    }

    const finished = {
      ...running,
      status: "done",
      payload: result,
    };
    onEvent?.({ type: "tool-finish", toolResult: finished });
    return {
      content,
      model: "workspace",
      toolResults: [finished],
    };
  } catch (error) {
    const failed = {
      ...running,
      status: "error",
      payload: {
        ...intent,
        message: error instanceof Error ? error.message : String(error),
      },
    };
    onEvent?.({ type: "tool-finish", toolResult: failed });
    return {
      content: `I could not complete the workspace file action: ${failed.payload.message}`,
      model: "workspace",
      toolResults: [failed],
    };
  }
}

function terminalSummary(result) {
  const body = [String(result.stdout || "").trim(), String(result.stderr || "").trim()].filter(Boolean).join("\n\n");
  return `**Exit code:** ${result.exitCode}${result.timedOut ? " (timeout)" : ""}\n\n**Duration:** ${result.durationMs} ms${
    body ? `\n\n\`\`\`text\n${body}\n\`\`\`` : ""
  }`;
}

async function executeToolDecision({ decision, settings, onEvent }) {
  if (!decision || decision.action === "answer") {
    return null;
  }

  if (decision.action === "write_file" || decision.action === "append_file" || decision.action === "read_file" || decision.action === "delete_path" || decision.action === "list_files") {
    const labels = {
      append_file: "Append file",
      delete_path: "Delete file",
      list_files: "List workspace",
      read_file: "Read file",
      write_file: "Write file",
    };
    const running = {
      type: "file",
      label: labels[decision.action] || "Workspace file",
      status: "running",
      payload: decision,
    };
    onEvent?.({ type: "tool-start", toolResult: running });

    try {
      let result;
      let content;
      if (decision.action === "list_files") {
        result = listFiles({ settings, directory: decision.filePath || "", depth: 2 });
        content = fileListMarkdown(result);
      } else if (decision.action === "read_file") {
        result = readTextFile({ settings, filePath: decision.filePath });
        content = `Read \`${result.relativePath}\`.\n\n\`\`\`${path.extname(result.relativePath).slice(1) || "text"}\n${result.content}\n\`\`\``;
      } else if (decision.action === "append_file") {
        result = appendTextFile({ settings, filePath: decision.filePath || "note.txt", content: decision.content || "" });
        content = `Appended to \`${result.relativePath}\` in the workspace.\n\n\`\`\`text\n${decision.content || ""}\n\`\`\``;
      } else if (decision.action === "delete_path") {
        result = deleteWorkspacePath({ settings, filePath: decision.filePath });
        content = `Deleted \`${result.relativePath}\` from the workspace.`;
      } else {
        result = writeTextFile({ settings, filePath: decision.filePath || "note.txt", content: decision.content || "", overwrite: true });
        content = `Created \`${result.relativePath}\` in the workspace.\n\n\`\`\`${path.extname(result.relativePath).slice(1) || "text"}\n${result.content}\n\`\`\``;
      }

      const finished = {
        ...running,
        status: "done",
        payload: result,
      };
      onEvent?.({ type: "tool-finish", toolResult: finished });
      return {
        content,
        model: "workspace",
        toolResults: [finished],
      };
    } catch (error) {
      const failed = {
        ...running,
        status: "error",
        payload: {
          ...decision,
          message: error instanceof Error ? error.message : String(error),
        },
      };
      onEvent?.({ type: "tool-finish", toolResult: failed });
      return {
        content: `I could not complete the workspace file action: ${failed.payload.message}`,
        model: "workspace",
        toolResults: [failed],
      };
    }
  }

  if (decision.action === "run_command") {
    const running = {
      type: "terminal",
      label: "Terminal run",
      status: "running",
      payload: decision,
    };
    onEvent?.({ type: "tool-start", toolResult: running });
    try {
      const result = await runCommand({ command: decision.command, settings });
      const finished = {
        ...running,
        status: result.exitCode === 0 ? "done" : "error",
        payload: result,
      };
      onEvent?.({ type: "tool-finish", toolResult: finished });
      return {
        content: terminalSummary(result),
        model: "terminal",
        toolResults: [finished],
      };
    } catch (error) {
      const failed = {
        ...running,
        status: "error",
        payload: {
          ...decision,
          message: error instanceof Error ? error.message : String(error),
        },
      };
      onEvent?.({ type: "tool-finish", toolResult: failed });
      return {
        content: `I could not run the command: ${failed.payload.message}`,
        model: "terminal",
        toolResults: [failed],
      };
    }
  }

  if (decision.action === "create_database") {
    const running = {
      type: "database",
      label: "Create local database",
      status: "running",
      payload: decision,
    };
    onEvent?.({ type: "tool-start", toolResult: running });
    try {
      const result = createDatabaseFromText({
        settings,
        name: decision.databaseName || "objects",
        text: decision.databaseText || decision.content || "",
      });
      const finished = {
        ...running,
        status: "done",
        payload: result,
      };
      onEvent?.({ type: "tool-finish", toolResult: finished });
      const files = [
        `- JSON database: \`${result.jsonRelativePath}\``,
        result.csvRelativePath ? `- CSV export: \`${result.csvRelativePath}\`` : "",
        result.sqliteRelativePath ? `- SQLite database: \`${result.sqliteRelativePath}\`` : "- SQLite database: unavailable in this runtime; JSON database was still created.",
      ].filter(Boolean);
      return {
        content: `Created local database **${result.name}** with **${result.rows}** row${result.rows === 1 ? "" : "s"}.\n\n${files.join("\n")}`,
        model: "database",
        toolResults: [finished],
      };
    } catch (error) {
      const failed = {
        ...running,
        status: "error",
        payload: {
          ...decision,
          message: error instanceof Error ? error.message : String(error),
        },
      };
      onEvent?.({ type: "tool-finish", toolResult: failed });
      return {
        content: `I could not create the database: ${failed.payload.message}`,
        model: "database",
        toolResults: [failed],
      };
    }
  }

  if (decision.action === "generate_image") {
    return maybeRunImageGeneration({ parsed: decision, settings, onEvent });
  }

  return null;
}

function parseImageIntent(text, settings) {
  if (!IMAGE_TRIGGER.test(text) || /(file|файл|документ|database|база|базу|таблиц)/i.test(text)) {
    return null;
  }

  let prompt = text.replace(/^\/image\s*/i, "").trim();
  let count = settings.image?.repeat || 1;
  let imageModel = settings.image?.model || "z-image-turbo";
  let ideogramEffort = settings.image?.ideogramEffort || "default";

  prompt = prompt.replace(/--(?:count|repeat|n)\s+(\d+)/gi, (_match, rawCount) => {
    count = clamp(Number(rawCount), 1, 3);
    return "";
  });
  prompt = prompt.replace(/--model\s+([a-z0-9_.-]+)/gi, (_match, rawModel) => {
    const normalized = String(rawModel).toLowerCase();
    if (normalized.includes("ideogram")) {
      imageModel = "ideogram-v4";
    } else if (normalized.includes("flux")) {
      imageModel = "flux2-klein-9b";
    } else if (normalized.includes("z")) {
      imageModel = "z-image-turbo";
    }
    return "";
  });
  prompt = prompt.replace(/--effort\s+(turbo|default|quality)/gi, (_match, rawEffort) => {
    ideogramEffort = String(rawEffort).toLowerCase();
    return "";
  });

  const countMatch = prompt.match(/(\d+)\s*(?:x|раз|вариант|картин|image|photo)/i);
  if (countMatch) {
    count = clamp(Number(countMatch[1]), 1, 3);
  } else if (/несколько|several|multiple/i.test(prompt)) {
    count = clamp(settings.agent?.maxImageJobs || 3, 1, 3);
  }

  if (/ideogram/i.test(prompt)) {
    imageModel = "ideogram-v4";
  } else if (/flux/i.test(prompt)) {
    imageModel = "flux2-klein-9b";
  } else if (/z-image|z image/i.test(prompt)) {
    imageModel = "z-image-turbo";
  }

  prompt = prompt
    .replace(/^(сгенерируй|нарисуй|создай|generate|draw|create|make)\s+(мне\s+)?/i, "")
    .replace(/\b(image|picture|photo|картинку|изображение|фото)\b/gi, "")
    .trim();

  return {
    prompt: prompt || text,
    count: clamp(count, 1, clamp(settings.agent?.maxImageJobs || 3, 1, 3)),
    imageModel,
    ideogramEffort,
  };
}

function hasImageAttachment(message) {
  return (message.attachments || []).some(
    (attachment) => attachment.kind === "image" || String(attachment.mimeType || "").startsWith("image/"),
  );
}

function isAskingAboutAttachedImage(text, message) {
  if (!hasImageAttachment(message)) {
    return false;
  }

  const normalized = String(text || "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const asksAboutImage =
    /(?:what|whats|what's|describe|analy[sz]e|explain|read|ocr|caption|summari[sz]e|see|shown|screenshot|photo|picture|image)/i.test(normalized) ||
    /(?:\u0447\u0442\u043e|\u0449\u043e|\u0447\u0442\u043e\s+\u043d\u0430|\u0447\u0442\u043e\s+\u0432|\u043e\u043f\u0438\u0448\u0438|\u0430\u043d\u0430\u043b\u0438\u0437|\u0441\u043a\u0440\u0438\u043d|\u0441\u043d\u0438\u043c\u043e\u043a|\u0444\u043e\u0442\u043e|\u043a\u0430\u0440\u0442\u0438\u043d\u043a|\u0438\u0437\u043e\u0431\u0440\u0430\u0436)/iu.test(normalized);

  const generationIntent =
    /^\/image\b/i.test(normalized) ||
    /\b(generate|create|draw|render|make)\b.*\b(image|picture|photo|logo|poster|banner|illustration|thumbnail)\b/i.test(normalized) ||
    /(?:\u0441\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u0443\u0439|\u043d\u0430\u0440\u0438\u0441\u0443\u0439|\u0441\u043e\u0437\u0434\u0430\u0439|\u0441\u0434\u0435\u043b\u0430\u0439).*(?:\u0444\u043e\u0442\u043e|\u043a\u0430\u0440\u0442\u0438\u043d\u043a|\u0438\u0437\u043e\u0431\u0440\u0430\u0436|\u043b\u043e\u0433\u043e|\u0431\u0430\u043d\u043d\u0435\u0440|\u043f\u043e\u0441\u0442\u0435\u0440)/iu.test(normalized);

  return asksAboutImage && !generationIntent;
}

function parseImageIntentV2(message, settings) {
  const text = message.content || "";
  if (isAskingAboutAttachedImage(text, message)) {
    return null;
  }

  const normalized = String(text || "").trim();
  const explicitSlash = /^\/image\b/i.test(normalized);
  const englishGeneration =
    /\b(generate|create|draw|render|make)\b.*\b(image|picture|photo|logo|poster|banner|illustration|thumbnail|hero|cover)\b/i.test(normalized);
  const russianGeneration =
    /(?:\u0441\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u0443\u0439|\u043d\u0430\u0440\u0438\u0441\u0443\u0439|\u0441\u043e\u0437\u0434\u0430\u0439|\u0441\u0434\u0435\u043b\u0430\u0439|\u0437\u0430\u0440\u0435\u043d\u0434\u0435\u0440\u0438).*(?:\u0444\u043e\u0442\u043e|\u043a\u0430\u0440\u0442\u0438\u043d\u043a|\u0438\u0437\u043e\u0431\u0440\u0430\u0436|\u043b\u043e\u0433\u043e|\u0431\u0430\u043d\u043d\u0435\u0440|\u043f\u043b\u0430\u0448\u043a|\u043f\u043e\u0441\u0442\u0435\u0440|\u043e\u0431\u043b\u043e\u0436\u043a)/iu.test(normalized);
  const standaloneGeneration =
    /^(?:\u0441\u0433\u0435\u043d\u0435\u0440\u0438\u0440\u0443\u0439|\u043d\u0430\u0440\u0438\u0441\u0443\u0439|generate|draw|render)\b/iu.test(normalized);

  if (!explicitSlash && !englishGeneration && !russianGeneration && !standaloneGeneration) {
    return null;
  }

  if (/(file|database|sqlite|csv|json|\u0444\u0430\u0439\u043b|\u0434\u043e\u043a\u0443\u043c\u0435\u043d\u0442|\u0431\u0430\u0437\u0430|\u0431\u0430\u0437\u0443|\u0442\u0430\u0431\u043b\u0438\u0446)/iu.test(normalized)) {
    return null;
  }

  const parsed = parseImageIntent(text, settings);
  if (parsed) {
    return parsed;
  }

  return {
    prompt: normalized.replace(/^\/image\s*/i, "").trim() || normalized,
    count: clamp(settings.image?.repeat || 1, 1, clamp(settings.agent?.maxImageJobs || 3, 1, 3)),
    imageModel: settings.image?.model || "z-image-turbo",
    ideogramEffort: settings.image?.ideogramEffort || "default",
  };
}

function imageSummary(result, parsed) {
  const count = result.count || result.jobs?.length || parsed.count || 1;
  const promptIds = (result.jobs || []).map((job) => job.promptId).filter(Boolean);
  const lines = [`Queued **${count}** image job${count > 1 ? "s" : ""} through ComfyUI using \`${result.model || parsed.imageModel}\`.`];
  if (promptIds.length) {
    lines.push(`Prompt IDs: ${promptIds.map((id) => `\`${id}\``).join(", ")}`);
  }
  if (result.model === "ideogram-v4") {
    lines.push(`Ideogram effort: **${parsed.ideogramEffort}**.`);
  }
  return lines.join("\n\n");
}

function normalizeImageDecision(decision, settings) {
  if (!decision || String(decision.action || "").toLowerCase() !== "generate_image") {
    return null;
  }

  const allowedModels = new Set(["z-image-turbo", "flux2-klein-9b", "ideogram-v4"]);
  const allowedEffort = new Set(["turbo", "default", "quality"]);
  const imageModel = allowedModels.has(decision.imageModel) ? decision.imageModel : settings.image?.model || "z-image-turbo";
  const ideogramEffort = allowedEffort.has(decision.ideogramEffort)
    ? decision.ideogramEffort
    : settings.image?.ideogramEffort || "default";
  const prompt = String(decision.prompt || "").trim();

  if (!prompt) {
    return null;
  }

  return {
    prompt,
    count: clamp(decision.count || settings.image?.repeat || 1, 1, clamp(settings.agent?.maxImageJobs || 3, 1, 3)),
    imageModel,
    ideogramEffort,
    routerReason: String(decision.reason || "").trim(),
  };
}

async function decideImageToolWithOllama({ messages, settings, headers, model }) {
  const last = lastUser(messages);
  const attachmentSummary = attachmentContext(last.attachments || []);
  const payload = {
    model,
    messages: [
      {
        role: "system",
        content: `You are the tool router for Local Agent Studio.
Decide whether the assistant should generate a NEW image with ComfyUI or answer normally with the LLM.

Return only valid JSON with this schema:
{
  "action": "answer" | "generate_image",
  "prompt": "final image prompt, only when action is generate_image",
  "count": 1,
  "imageModel": "z-image-turbo" | "flux2-klein-9b" | "ideogram-v4",
  "ideogramEffort": "turbo" | "default" | "quality",
  "reason": "short reason"
}

Rules:
- Use "generate_image" only when the user wants a new visual asset created, rendered, drawn, generated, designed, or made.
- If the user attaches an image and asks what is on it, asks to describe it, analyze it, read it, or explain it, use "answer".
- If the request is ambiguous, use "answer".
- Do not generate just because the words image, picture, photo, screenshot, or logo appear.
- Default imageModel is "${settings.image?.model || "z-image-turbo"}".
- Default ideogramEffort is "${settings.image?.ideogramEffort || "default"}".
- Max count is ${clamp(settings.agent?.maxImageJobs || 3, 1, 3)}.`,
      },
      {
        role: "user",
        content: `User message:
${last.content || ""}

Attachments:
${attachmentSummary || "none"}`,
      },
    ],
    stream: false,
    options: {
      temperature: 0,
      num_ctx: Math.min(Number(settings.ollama.contextTokens ?? 8192), 4096),
    },
  };

  const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/api/chat"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeoutMs: Math.min(Number(settings.ollama.timeoutMs || 120000), 30000),
  });

  return extractJsonObject(data?.message?.content || "");
}

async function maybeHandleImageIntent({ messages, settings, toolMode, headers, model, onEvent }) {
  if (toolMode === "none") {
    return null;
  }

  onEvent?.({ type: "status", message: "Asking Ollama whether image generation is needed" });

  let parsed = null;
  try {
    parsed = normalizeImageDecision(await decideImageToolWithOllama({ messages, settings, headers, model }), settings);
  } catch (error) {
    const explicitSlash = /^\/image\b/i.test(lastUser(messages).content || "");
    if (!explicitSlash) {
      return null;
    }
    parsed = parseImageIntentV2(lastUser(messages), settings);
  }

  if (!parsed) {
    return null;
  }

  return maybeRunImageGeneration({ parsed, settings, onEvent });
}

async function maybeRunImageGeneration({ parsed, settings, onEvent }) {
  const running = {
    type: "comfy",
    label: `ComfyUI image (${parsed.imageModel})`,
    status: "running",
    payload: parsed,
  };
  onEvent?.({ type: "tool-start", toolResult: running });

  try {
    const result = await queueComfyPrompt({
      prompt: parsed.prompt,
      negativePrompt: settings.comfy?.negativePrompt,
      imageModel: parsed.imageModel,
      ideogramEffort: parsed.ideogramEffort,
      count: parsed.count,
      settings,
    });
    const finished = {
      ...running,
      status: "done",
      payload: result,
    };
    onEvent?.({ type: "tool-finish", toolResult: finished });
    return {
      content: imageSummary(result, parsed),
      model: "comfy",
      toolResults: [finished],
    };
  } catch (error) {
    const failed = {
      ...running,
      status: "error",
      payload: {
        ...parsed,
        message: error instanceof Error ? error.message : String(error),
      },
    };
    onEvent?.({ type: "tool-finish", toolResult: failed });
    return {
      content: `I could not queue the image job: ${failed.payload.message}`,
      model: "comfy",
      toolResults: [failed],
    };
  }
}

function extractDatabaseName(text) {
  const file = text.match(/([\p{L}\p{N}_-]+\.(?:sqlite|db|json|csv))/iu);
  if (file) {
    return file[1];
  }
  const named = text.match(/(?:named|called|name|названи(?:ем|е)|имя)\s+["'`]?([\p{L}\p{N}_-]+)/iu);
  if (named) {
    return named[1];
  }
  return "objects";
}

function databaseSourceText(message) {
  const text = message.content || "";
  const afterColon = text.match(/[:：]\s*([\s\S]+)$/);
  if (afterColon) {
    return afterColon[1].trim();
  }
  return text;
}

async function maybeHandleDatabaseIntent({ messages, settings, toolMode, onEvent }) {
  if (toolMode === "none") {
    return null;
  }

  const message = lastUser(messages);
  const text = message.content || "";
  if (!DATABASE_TRIGGER.test(text) || !/(create|make|build|convert|import|создай|сделай|собери|сконверт|импорт|створи)/i.test(text)) {
    return null;
  }

  let source = databaseSourceText(message);
  const textAttachment = (message.attachments || []).find((attachment) => attachment.kind === "text");
  if (textAttachment) {
    try {
      const file = readTextFile({ settings: { ...settings, workspacePath: path.dirname(textAttachment.path) }, filePath: path.basename(textAttachment.path) });
      source = file.content;
    } catch {
      source = databaseSourceText(message);
    }
  }

  const running = {
    type: "database",
    label: "Create local database",
    status: "running",
    payload: {
      name: extractDatabaseName(text),
    },
  };
  onEvent?.({ type: "tool-start", toolResult: running });

  try {
    const result = createDatabaseFromText({
      settings,
      name: extractDatabaseName(text),
      text: source,
    });
    const finished = {
      ...running,
      status: "done",
      payload: result,
    };
    onEvent?.({ type: "tool-finish", toolResult: finished });

    const files = [
      `- JSON database: \`${result.jsonRelativePath}\``,
      result.csvRelativePath ? `- CSV export: \`${result.csvRelativePath}\`` : "",
      result.sqliteRelativePath ? `- SQLite database: \`${result.sqliteRelativePath}\`` : "- SQLite database: unavailable in this runtime; JSON database was still created.",
    ].filter(Boolean);

    return {
      content: `Created local database **${result.name}** with **${result.rows}** row${result.rows === 1 ? "" : "s"}.\n\n${files.join("\n")}`,
      model: "database",
      toolResults: [finished],
    };
  } catch (error) {
    const failed = {
      ...running,
      status: "error",
      payload: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
    onEvent?.({ type: "tool-finish", toolResult: failed });
    return {
      content: `I could not create the database: ${failed.payload.message}`,
      model: "database",
      toolResults: [failed],
    };
  }
}

async function maybeHandleDirectTool(args) {
  return (
    (await maybeHandleFileIntent(args)) ||
    (await maybeHandleDatabaseIntent(args))
  );
}

async function readOllamaStream(response, onEvent) {
  if (!response.body) {
    throw new Error("Ollama returned an empty stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalData = {};
  let content = "";
  let thinking = "";

  function consumeLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    const data = JSON.parse(trimmed);
    if (data.error) {
      throw new Error(data.error);
    }
    const thinkingToken = data?.message?.thinking || "";
    if (thinkingToken) {
      thinking += thinkingToken;
      onEvent?.({ type: "thinking", token: thinkingToken });
    }
    const token = data?.message?.content || "";
    if (token) {
      content += token;
      onEvent?.({ type: "token", token });
    }
    if (data.done) {
      finalData = data;
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      consumeLine(line);
    }
  }

  if (buffer.trim()) {
    consumeLine(buffer);
  }

  return { content, thinking: thinking || finalData?.message?.thinking || "", finalData };
}

async function streamChat({ payload, settings, headers, onEvent }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(settings.ollama.timeoutMs || 120000));

  try {
    const response = await fetch(endpoint(settings.ollama.baseUrl, "/api/chat"), {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`${response.status} ${response.statusText}: ${text || "Ollama request failed"}`);
    }

    return await readOllamaStream(response, onEvent);
  } finally {
    clearTimeout(timeout);
  }
}

function thinkValue(settings) {
  const mode = settings.ollama?.thinking || "auto";
  if (mode === "on") {
    return true;
  }
  if (mode === "off") {
    return false;
  }
  if (["low", "medium", "high", "max"].includes(mode)) {
    return mode;
  }
  return undefined;
}

async function runAgentMessage({ messages, settings, toolMode, stream, onEvent }) {
  const headers = { "Content-Type": "application/json" };
  if (settings.ollama.apiKey) {
    headers.Authorization = `Bearer ${settings.ollama.apiKey}`;
  }

  onEvent?.({ type: "status", message: "Selecting Ollama model" });
  const model = await resolveModel(settings, headers);

  if (toolMode !== "none") {
    try {
      onEvent?.({ type: "status", message: "Asking Ollama which tool to use" });
      const decision = await decideToolWithOllama({ messages, settings, headers, model });
      const routed = await executeToolDecision({ decision, settings, onEvent });
      if (routed) {
        return routed;
      }
    } catch {
      const fallbackDirect = await maybeHandleDirectTool({ messages, settings, toolMode, onEvent });
      if (fallbackDirect) {
        return fallbackDirect;
      }
    }
  }

  const imageTool = await maybeHandleImageIntent({ messages, settings, toolMode, headers, model, onEvent });
  if (imageTool) {
    return imageTool;
  }

  const { attempted, searchContext, toolResults } = await gatherSearchContext({
    messages,
    settings,
    toolMode,
    headers,
    model,
    onEvent,
  });

  if (attempted && !searchContext) {
    const failed = toolResults.filter((tool) => tool.status === "error");
    const details = failed
      .map((tool) => {
        const message = tool.payload?.message ? `: ${tool.payload.message}` : "";
        return `- ${tool.label}${tool.query ? ` for \`${tool.query}\`` : ""}${message}`;
      })
      .join("\n");
    return {
      content: failed.length
        ? `I tried to search the web, but the configured provider did not return usable results.\n\n${details}\n\nCheck Settings -> Search or switch to SerpAPI/Ollama Web Search/SearXNG.`
        : "I ran web search, but no usable results came back. Try another provider or a more specific query.",
      model,
      toolResults,
    };
  }

  const payload = {
    model,
    messages: [{ role: "system", content: buildSystemPrompt(searchContext, settings) }, ...compactMessages(messages)],
    stream,
    options: {
      temperature: Number(settings.ollama.temperature ?? 0.35),
      num_ctx: Number(settings.ollama.contextTokens ?? 8192),
    },
  };
  const think = thinkValue(settings);
  if (think !== undefined) {
    payload.think = think;
  }

  if (stream) {
    onEvent?.({ type: "status", message: `Streaming from ${model}` });
    const { content, thinking, finalData } = await streamChat({ payload, settings, headers, onEvent });
    return {
      content,
      thinking,
      model: finalData.model || model,
      metrics: {
        totalDurationNs: finalData.total_duration,
        promptTokens: finalData.prompt_eval_count,
        completionTokens: finalData.eval_count,
      },
      toolResults,
    };
  }

  const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/api/chat"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeoutMs: Number(settings.ollama.timeoutMs || 120000),
  });

  return {
    content: data?.message?.content || "",
    thinking: data?.message?.thinking || "",
    model: data.model || model,
    metrics: {
      totalDurationNs: data.total_duration,
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
    },
    toolResults,
  };
}

async function sendAgentMessage({ messages, settings, toolMode }) {
  return runAgentMessage({
    messages,
    settings,
    toolMode,
    stream: false,
  });
}

async function sendAgentMessageStream({ messages, settings, toolMode, onEvent }) {
  try {
    const response = await runAgentMessage({
      messages,
      settings,
      toolMode,
      stream: true,
      onEvent,
    });
    onEvent?.({ type: "done", response });
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onEvent?.({ type: "error", message });
    throw error;
  }
}

module.exports = {
  sendAgentMessage,
  sendAgentMessageStream,
};
