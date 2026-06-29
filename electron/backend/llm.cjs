const path = require("node:path");
const { endpoint, fetchJson } = require("./fetch.cjs");
const { searchWeb } = require("./search.cjs");
const { queueComfyPrompt } = require("./comfy.cjs");
const { createDatabaseFromText } = require("./data.cjs");
const { appendArtifact, readArtifact, writeArtifact } = require("./artifacts.cjs");
const { addImageHistoryJob } = require("./imageHistory.cjs");
const { addMemory, memoryContext } = require("./memory.cjs");
const { callMcpTool } = require("./mcp.cjs");
const { enabledPluginContext, pluginMcpServers } = require("./pluginMarketplace.cjs");
const { runCommand } = require("./sandbox.cjs");
const { appendExecutionLog } = require("./executionLog.cjs");
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
  "search_web",
  "create_database",
  "generate_image",
  "mcp_call",
  "remember",
  "write_artifact",
  "read_artifact",
  "append_artifact",
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

function runtimeProviderSettings(settings) {
  const activePreset = (settings.remoteProviders?.presets || []).find((preset) => preset.id === settings.remoteProviders?.activePresetId);
  let next = settings;

  if (activePreset) {
    next = {
      ...next,
      ollama: {
        ...next.ollama,
        baseUrl: activePreset.ollamaBaseUrl || next.ollama.baseUrl,
        apiFormat: activePreset.apiFormat || next.ollama.apiFormat || "ollama",
      },
      comfy: {
        ...next.comfy,
        baseUrl: activePreset.comfyBaseUrl || next.comfy.baseUrl,
      },
    };
  }

  if (!next.runpod?.enabled) {
    return next;
  }
  return {
    ...next,
    ollama: {
      ...next.ollama,
      baseUrl: next.runpod.ollamaBaseUrl || next.ollama.baseUrl,
      apiKey: next.runpod.apiKey || next.ollama.apiKey,
    },
    comfy: {
      ...next.comfy,
      baseUrl: next.runpod.comfyBaseUrl || next.comfy.baseUrl,
    },
  };
}

function isOpenAiCompatible(settings) {
  return settings.ollama?.apiFormat === "openai-compatible";
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

function isLocalDateQuestion(text) {
  return /(what(?:'s| is)? (?:the )?(?:date|day|time)|today(?:'s)? date|current (?:date|time)|какая .*дата|какой .*день|сколько времени|которая година|jaka .*data|wie spät|welches datum)/i.test(
    text || "",
  );
}

function shouldSearch(messages, toolMode, settings) {
  if (toolMode === "web") {
    return true;
  }
  if (toolMode === "none") {
    return false;
  }
  const text = lastUser(messages).content || "";
  if (settings?.context?.includeLocalDateTime && isLocalDateQuestion(text)) {
    return false;
  }
  return SEARCH_TRIGGER.test(text);
}

async function resolveModel(settings, headers) {
  if (settings.ollama.model && settings.ollama.model !== "auto") {
    return settings.ollama.model;
  }

  if (isOpenAiCompatible(settings)) {
    const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/v1/models"), {
      headers,
      timeoutMs: 8000,
    });
    const models = Array.isArray(data.data) ? data.data : [];
    const firstModel = models[0]?.id || models[0]?.name;
    if (!firstModel) {
      throw new Error("The OpenAI-compatible provider responded, but no models are available. Load a model or set one in Settings.");
    }
    return firstModel;
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

function openAiPayloadFromOllamaPayload(payload, settings) {
  return {
    model: payload.model,
    messages: (payload.messages || []).map((message) => ({
      role: message.role,
      content: message.content || "",
    })),
    stream: Boolean(payload.stream),
    temperature: payload.options?.temperature ?? Number(settings.ollama.temperature ?? 0.35),
  };
}

async function postChat({ settings, headers, payload, timeoutMs }) {
  if (isOpenAiCompatible(settings)) {
    const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/v1/chat/completions"), {
      method: "POST",
      headers,
      body: JSON.stringify(openAiPayloadFromOllamaPayload(payload, settings)),
      timeoutMs,
    });
    const message = data?.choices?.[0]?.message || {};
    return {
      model: data.model || payload.model,
      message: {
        content: message.content || "",
        thinking: message.reasoning_content || message.reasoning || "",
      },
      total_duration: undefined,
      prompt_eval_count: data?.usage?.prompt_tokens,
      eval_count: data?.usage?.completion_tokens,
    };
  }

  return fetchJson(endpoint(settings.ollama.baseUrl, "/api/chat"), {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    timeoutMs,
  });
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
    const data = await postChat({ settings, headers, payload, timeoutMs: 30000 });
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

function searchToolMarkdown(result) {
  const rows = (result.results || [])
    .slice(0, 6)
    .map((item, index) => {
      const title = item.title || item.url || `Result ${index + 1}`;
      const url = item.url ? `\nURL: ${item.url}` : "";
      const snippet = item.content ? `\nSnippet: ${item.content}` : "";
      return `[${index + 1}] ${title}${url}${snippet}`;
    })
    .join("\n\n");
  return rows || "No usable search results returned.";
}

function buildSystemPrompt(searchContext, settings) {
  const contextBlock = searchContext
    ? `\n\nWeb search context collected from up to ${clamp(settings.agent?.maxWebSearches ?? 3, 1, 3)} searches:\n${searchContext}\n\nUse the context to synthesize a clear answer. Cite sources inline like [1] only for facts that came from the web. Do not dump raw snippets or URL lists into the main answer.`
    : "";
  const dateBlock = settings.context?.includeLocalDateTime
    ? `\nCurrent local date/time from this PC: ${new Date().toString()}. Use this for date awareness unless the user asks for current external facts that require web search.`
    : "";
  const nameBlock = settings.profile?.userName ? `\nUser display name: ${settings.profile.userName}. Use it naturally when direct address is helpful.` : "";
  const personalMemory = settings._userDataDir ? memoryContext(settings._userDataDir, settings) : "";
  const memoryBlock = personalMemory
    ? `\nPersonal memory enabled for this user:\n${personalMemory}\nUse these memories only when relevant. Do not expose the raw memory list unless the user asks.`
    : "";
  const pluginCapabilities = settings._userDataDir ? enabledPluginContext(settings._userDataDir) : "";
  const pluginBlock = pluginCapabilities
    ? `\nEnabled plugin capabilities:\n${pluginCapabilities}\nTreat plugin tools as available capabilities, but do not claim a plugin action was executed unless the app returns a tool result.`
    : "";

  return `You are Local Agent Studio, a local-first desktop agent running on the user's desktop machine.
Answer in the user's language unless the UI asks otherwise. Be concise, practical, and honest about tool state.
Use Markdown naturally: short sections, bullets when useful, fenced code blocks for code, and bold text for emphasis.
Available integrations are executed by the app before or during the answer: Ollama chat, ComfyUI image workflows, web search, workspace file operations, local databases, personal memory, artifacts, MCP tools, enabled plugins, and sandbox commands.
When the user attaches an image and asks what is in it, describe or analyze the attached image. Do not switch to image generation unless the user explicitly asks to create, generate, draw, render, or make a new visual asset.
Never write pseudo tool syntax such as <tool_code>, function calls, or fake Python for actions. Tools are executed only by Local Agent Studio.
Never claim that a search, file operation, image job, database creation, memory update, artifact update, plugin action, or command was executed unless a tool result is present. If a needed tool failed or is not configured, say that directly and explain what setting is missing.${dateBlock}${nameBlock}${memoryBlock}${pluginBlock}${contextBlock}`;
}

async function gatherSearchContext({ messages, settings, toolMode, headers, model, onEvent }) {
  const attempted = shouldSearch(messages, toolMode, settings);
  if (!attempted) {
    return { attempted: false, searchContext: "", toolResults: [] };
  }
  if ((settings.permissions?.search || "allow") !== "allow") {
    const mode = settings.permissions?.search || "ask";
    const failed = {
      type: "search",
      label: "Web search",
      status: "error",
      results: [],
      payload: {
        permission: mode,
        message:
          mode === "deny"
            ? "Web search is disabled in Tool Permissions."
            : "Web search requires confirmation. Change Search permission to allow in Settings to let the agent search automatically.",
      },
    };
    onEvent?.({ type: "tool-finish", toolResult: failed });
    return { attempted: true, searchContext: "", toolResults: [failed] };
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
  const allowedModels = new Set(["z-image-turbo", "flux2-klein-9b", "ideogram-v4", ...(settings.image?.customModels || []).map((model) => model.id)]);
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
    serverName: String(decision.serverName || "").trim(),
    toolName: String(decision.toolName || "").trim(),
    toolArguments: decision.toolArguments && typeof decision.toolArguments === "object" ? decision.toolArguments : {},
    artifactId: String(decision.artifactId || "").trim(),
    artifactName: String(decision.artifactName || decision.filePath || "").trim(),
    artifactKind: String(decision.artifactKind || "text").trim(),
    memory: String(decision.memory || "").trim(),
    reason: String(decision.reason || "").trim(),
  };
}

function normalizeGitHubRepoUrl(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  if (/^https?:\/\//i.test(text)) {
    return text;
  }
  if (/^github\.com\//i.test(text)) {
    return `https://${text}`;
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text)) {
    return `https://github.com/${text}`;
  }
  return text;
}

function normalizeMcpToolArguments(decision) {
  const args = {
    ...(decision.toolArguments || {}),
  };
  if (decision.toolName === "git_clone" && !args.repoUrl) {
    args.repoUrl = normalizeGitHubRepoUrl(args.repo || args.repository || args.url || args.cloneUrl || args.remoteUrl);
  }
  return args;
}

async function decideToolWithOllama({ messages, settings, headers, model, toolMode = "auto", observations = [] }) {
  const last = lastUser(messages);
  const attachmentSummary = attachmentContext(last.attachments || []);
  const recentMessages = compactMessages(messages, false)
    .slice(-8)
    .map((message) => `${message.role}: ${message.content}`)
    .join("\n\n");
  const imageModels = [
    "z-image-turbo",
    "flux2-klein-9b",
    "ideogram-v4",
    ...(settings.image?.customModels || []).map((item) => item.id).filter(Boolean),
  ];
  const localDateContext = settings.context?.includeLocalDateTime ? new Date().toString() : "disabled";
  const memoryRule = settings.memory?.enabled
    ? settings.memory.autoRemember
      ? "Memory is enabled with auto-remember. Use remember for stable user preferences, project facts, and long-term instructions that are clearly useful in future chats."
      : "Memory is enabled. Use remember only when the user explicitly asks you to remember something."
    : "Memory is disabled. Do not use remember.";
  const pluginCapabilities = settings._userDataDir ? enabledPluginContext(settings._userDataDir) : "";
  const maxWebSearches = clamp(settings.agent?.maxWebSearches ?? 3, 1, 3);

  const payload = {
    model,
    messages: [
      {
        role: "system",
        content: `You are the tool router for Local Agent Studio, a local-first desktop agent.
Choose exactly one next action for the app to execute, or "answer" when no tool is needed.
You may be called several times for the same user request. Use the observations to decide whether another tool step is useful.

Return only valid JSON with this schema:
{
  "action": "answer" | "write_file" | "read_file" | "append_file" | "delete_path" | "list_files" | "run_command" | "search_web" | "create_database" | "generate_image" | "mcp_call" | "remember" | "write_artifact" | "read_artifact" | "append_artifact",
  "filePath": "relative workspace path, when a file/path action is needed",
  "content": "complete file content to write or append, when needed",
  "artifactId": "artifact id, when reading/appending an existing artifact",
  "artifactName": "artifact display name or file name, when writing a new artifact",
  "artifactKind": "text | code | markdown | json | design | other",
  "memory": "short personal memory to store, when action is remember",
  "command": "terminal command, when action is run_command",
  "query": "web search query, when action is search_web",
  "databaseName": "database name, when action is create_database",
  "databaseText": "JSON/CSV/text source for database, when action is create_database",
  "prompt": "final ComfyUI image prompt, when action is generate_image",
  "count": 1,
  "imageModel": "z-image-turbo" | "flux2-klein-9b" | "ideogram-v4",
  "ideogramEffort": "turbo" | "default" | "quality",
  "serverName": "MCP server name, when action is mcp_call",
  "toolName": "MCP tool name, when action is mcp_call",
  "toolArguments": {},
  "reason": "short reason"
}

Rules:
- Act like a CLI-capable assistant. If the user asks to create, edit, append, read, list, delete, run, or generate, choose the matching tool.
- Never answer with <tool_code>, fake function calls, or code that pretends to run tools. Choose a real action instead.
- If the user asks to create a file "on any topic" or without exact content, you must invent useful content and include the complete file text in "content".
- Never choose write_file with empty content unless the user explicitly asks for an empty file.
- File paths must be relative to the workspace. If the user gives no file name, choose a sensible one, e.g. "note.txt", "README.md", "todo.md", "data.json".
- Infer file extensions from the requested artifact. Python code must be ".py", JavaScript ".js", TypeScript ".ts", Markdown ".md", JSON ".json", CSV ".csv", HTML ".html", CSS ".css", PowerShell ".ps1".
- Use write_artifact/read_artifact/append_artifact when the user asks to create or revise an artifact, draft, design, document, snippet, or reusable output that should live separately from normal chat.
- ${memoryRule}
- Use search_web when current or external information is needed, when the user asks to search/browse/look up/compare current prices/news/docs, or when tool mode is "web".
- You can use search_web up to ${maxWebSearches} times across repeated router calls. Use a new query each time unless repeating is clearly useful.
- Use create_database for requests to build/import/convert objects into a local database.
- Use generate_image only for a new visual asset. If the user attaches an image and asks what is on it, choose answer.
- Available image models: ${imageModels.join(", ")}.
- Available Plugin MCP tools:
${pluginCapabilities || "  none"}
- Use mcp_call when the request matches an available manual MCP or Plugin MCP tool. For Plugin MCP, set serverName to the MCP server shown by the plugin and toolName to the exact tool name.
- Repository and service actions provided by plugins must go through mcp_call. For example, if a GitHub plugin exposes git_clone and the user asks to clone a GitHub repository, choose mcp_call with that plugin tool.
- Do not skip the router and do not assume a plugin ran unless mcp_call was selected and an observation confirms it.
- Use run_command only when the user asks to execute a shell/CLI command or a task that clearly requires CLI execution.
- After a tool succeeds, choose another tool only if it helps finish the user's request. Do not repeat the same failed action.
- Choose answer when the requested work is complete or when the next step is normal conversation.
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
${attachmentSummary || "none"}

Local date/time from this PC:
${localDateContext}

Tool mode:
${toolMode}

Tool observations so far:
${observations.length ? observations.join("\n\n") : "none"}`,
      },
    ],
    stream: false,
    options: {
      temperature: 0,
      num_ctx: Math.min(Number(settings.ollama.contextTokens ?? 8192), 8192),
    },
  };

  const data = await postChat({ settings, headers, payload, timeoutMs: Math.min(Number(settings.ollama.timeoutMs || 120000), 45000) });

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

function logExecution(settings, entry) {
  if (settings.controlledExecution?.executionLog === false) {
    return null;
  }
  return appendExecutionLog(settings._userDataDir, entry);
}

function effectivePermissions(settings) {
  const profile = settings.agent?.permissionProfile || "balanced";
  const base = { ...(settings.permissions || {}) };
  const profiles = {
    "read-only": {
      files: "ask",
      search: "allow",
      images: "deny",
      terminal: "deny",
      database: "deny",
      mcp: "ask",
    },
    balanced: base,
    builder: {
      ...base,
      files: "allow",
      search: "allow",
      images: "allow",
      terminal: "ask",
      database: "allow",
      mcp: "ask",
    },
    full: {
      files: "allow",
      search: "allow",
      images: "allow",
      terminal: "allow",
      database: "allow",
      mcp: "allow",
    },
  };
  return {
    ...base,
    ...(profiles[profile] || {}),
  };
}

function permissionForDecision(decision) {
  if (decision.action === "run_command") {
    return ["terminal", "Terminal run"];
  }
  if (decision.action === "generate_image") {
    return ["images", "Image generation"];
  }
  if (decision.action === "search_web") {
    return ["search", "Web search"];
  }
  if (decision.action === "create_database") {
    return ["database", "Database write"];
  }
  if (decision.action === "mcp_call") {
    return ["mcp", "MCP tool call"];
  }
  if (
    decision.action === "write_file" ||
    decision.action === "append_file" ||
    decision.action === "read_file" ||
    decision.action === "delete_path" ||
    decision.action === "list_files" ||
    decision.action === "write_artifact" ||
    decision.action === "read_artifact" ||
    decision.action === "append_artifact"
  ) {
    return ["files", "Workspace file"];
  }
  return [null, "Tool"];
}

function permissionDeniedResponse({ decision, settings, onEvent }) {
  const [key, label] = permissionForDecision(decision);
  if (key === "mcp" && settings._userDataDir) {
    const pluginServer = pluginMcpServers(settings._userDataDir, settings).some((server) => server.name === decision.serverName);
    if (pluginServer) {
      return null;
    }
  }
  const mode = key ? effectivePermissions(settings)?.[key] || "allow" : "allow";
  if (mode === "allow") {
    return null;
  }

  const result = {
    type: key === "images" ? "comfy" : key === "terminal" ? "terminal" : key === "database" ? "database" : key === "mcp" ? "mcp" : "file",
    label,
    status: "error",
    payload: {
      action: decision.action,
      permission: mode,
      message:
        mode === "deny"
          ? `${label} is disabled in Tool Permissions.`
          : `${label} requires confirmation. Change this permission to "allow" in Settings to let the agent run it automatically.`,
    },
  };
  onEvent?.({ type: "tool-finish", toolResult: result });
  return {
    content: result.payload.message,
    model: "permissions",
    toolResults: [result],
  };
}

function isExternalWriteTool(decision) {
  if (decision.action !== "mcp_call") {
    return false;
  }
  return /(push|post|send|publish|upload|create|update|delete|merge|comment|install|auth|login)/i.test(`${decision.serverName || ""}:${decision.toolName || ""}`);
}

function approvalReason(decision, settings) {
  const gates = settings.controlledExecution?.approvalGates || {};
  if (gates.destructive && decision.action === "delete_path") {
    return "delete workspace path";
  }
  if (gates.terminal && decision.action === "run_command") {
    return "run terminal command";
  }
  if (gates.externalWrite && isExternalWriteTool(decision)) {
    return "write to an external service or remote";
  }
  if (gates.credentialUse && decision.action === "mcp_call" && /(auth|login|token|credential|github_list_repos|git_push)/i.test(decision.toolName || "")) {
    return "use credentials";
  }
  if (gates.installs && decision.action === "mcp_call" && /(install|plugin|package)/i.test(decision.toolName || "")) {
    return "install or modify a plugin/package";
  }
  return "";
}

function dryRunResponse({ decision, settings, taskId, onEvent }) {
  const result = {
    type: decision.action === "generate_image" ? "comfy" : decision.action === "mcp_call" ? "mcp" : decision.action === "run_command" ? "terminal" : "file",
    label: `Dry run: ${decision.action}`,
    status: "done",
    payload: {
      taskId,
      workspacePath: settings.workspacePath,
      decision,
    },
  };
  logExecution(settings, {
    event: "dry-run",
    taskId,
    action: decision.action,
    workspacePath: settings.workspacePath,
    decision,
  });
  onEvent?.({ type: "tool-finish", toolResult: result });
  return {
    content: `Dry run only. I would run **${decision.action}** with this plan:\n\n\`\`\`json\n${JSON.stringify(result.payload, null, 2)}\n\`\`\``,
    model: "dry-run",
    toolResults: [result],
  };
}

function approvalRequiredResponse({ decision, settings, taskId, reason, onEvent }) {
  const result = {
    type: decision.action === "mcp_call" ? "mcp" : decision.action === "run_command" ? "terminal" : "file",
    label: `Approval required: ${decision.action}`,
    status: "error",
    payload: {
      taskId,
      reason,
      workspacePath: settings.workspacePath,
      decision,
      message: `Approval required before I can ${reason}. Reply with "approve" and repeat the request, or disable this approval gate in Settings.`,
    },
  };
  logExecution(settings, {
    event: "approval-required",
    taskId,
    action: decision.action,
    reason,
    workspacePath: settings.workspacePath,
    decision,
  });
  onEvent?.({ type: "tool-finish", toolResult: result });
  return {
    content: result.payload.message,
    model: "approval",
    toolResults: [result],
  };
}

async function executeToolDecision({ decision, settings, onEvent, taskId, approved = false }) {
  if (!decision || decision.action === "answer") {
    return null;
  }

  if (settings.controlledExecution?.dryRun) {
    return dryRunResponse({ decision, settings, taskId, onEvent });
  }

  const approval = !approved ? approvalReason(decision, settings) : "";
  if (approval) {
    return approvalRequiredResponse({ decision, settings, taskId, reason: approval, onEvent });
  }

  logExecution(settings, {
    event: "tool-start",
    taskId,
    action: decision.action,
    tool: decision.action === "mcp_call" ? `${decision.serverName}:${decision.toolName}` : decision.action,
    workspacePath: settings.workspacePath,
    decision,
  });

  const blocked = permissionDeniedResponse({ decision, settings, onEvent });
  if (blocked) {
    logExecution(settings, {
      event: "tool-blocked",
      taskId,
      action: decision.action,
      workspacePath: settings.workspacePath,
      decision,
      result: blocked.content,
    });
    return blocked;
  }

  if (decision.action === "remember") {
    const running = {
      type: "memory",
      label: "Personal memory",
      status: "running",
      payload: decision,
    };
    onEvent?.({ type: "tool-start", toolResult: running });
    try {
      if (!settings.memory?.enabled) {
        throw new Error("Personal memory is disabled in Settings.");
      }
      if (!settings._userDataDir) {
        throw new Error("User data directory is unavailable.");
      }
      const store = addMemory(settings._userDataDir, decision.memory || decision.content, "agent", settings.memory?.maxEntries);
      const finished = {
        ...running,
        status: "done",
        payload: store.entries[0],
      };
      onEvent?.({ type: "tool-finish", toolResult: finished });
      return {
        content: `Saved to personal memory: ${store.entries[0].content}`,
        model: "memory",
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
        content: `I could not save memory: ${failed.payload.message}`,
        model: "memory",
        toolResults: [failed],
      };
    }
  }

  if (decision.action === "write_artifact" || decision.action === "read_artifact" || decision.action === "append_artifact") {
    const labels = {
      append_artifact: "Append artifact",
      read_artifact: "Read artifact",
      write_artifact: "Write artifact",
    };
    const running = {
      type: "artifact",
      label: labels[decision.action],
      status: "running",
      payload: decision,
    };
    onEvent?.({ type: "tool-start", toolResult: running });
    try {
      let result;
      let content;
      if (decision.action === "read_artifact") {
        result = readArtifact({ settings, id: decision.artifactId || decision.artifactName || decision.filePath });
        content = `Read artifact **${result.name}**.\n\n\`\`\`${path.extname(result.relativePath).slice(1) || "text"}\n${result.content || ""}\n\`\`\``;
      } else if (decision.action === "append_artifact") {
        result = appendArtifact({ settings, id: decision.artifactId || decision.artifactName || decision.filePath, content: decision.content || "" });
        content = `Updated artifact **${result.artifact.name}** in \`Artifacts/${result.artifact.relativePath}\`.`;
      } else {
        result = writeArtifact({
          settings,
          name: decision.artifactName || decision.filePath || "artifact",
          kind: decision.artifactKind || "text",
          content: decision.content || "",
        });
        content = `Created artifact **${result.artifact.name}** in \`Artifacts/${result.artifact.relativePath}\`.`;
      }
      const finished = {
        ...running,
        status: "done",
        payload: result,
      };
      onEvent?.({ type: "tool-finish", toolResult: finished });
      return {
        content,
        model: "artifact",
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
        content: `I could not complete the artifact action: ${failed.payload.message}`,
        model: "artifact",
        toolResults: [failed],
      };
    }
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

  if (decision.action === "search_web") {
    const query = String(decision.query || "").trim();
    const running = {
      type: "search",
      label: "Web search",
      status: "running",
      query,
      payload: decision,
      results: [],
    };
    onEvent?.({ type: "tool-start", toolResult: running });
    try {
      if (!query) {
        throw new Error("Search query is empty.");
      }
      const result = await searchWeb({ query, settings });
      const finished = {
        ...running,
        label: `Web search (${result.provider})`,
        status: "done",
        results: result.results || [],
        payload: {
          ...decision,
          provider: result.provider,
        },
      };
      onEvent?.({ type: "tool-finish", toolResult: finished });
      return {
        content: `Web search for \`${query}\` returned ${finished.results.length} result${finished.results.length === 1 ? "" : "s"}.\n\n${searchToolMarkdown(finished)}`,
        model: "search",
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
        content: `I could not search the web: ${failed.payload.message}`,
        model: "search",
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

  if (decision.action === "mcp_call") {
    const toolArguments = normalizeMcpToolArguments(decision);
    const running = {
      type: "mcp",
      label: `MCP ${decision.serverName || "server"}:${decision.toolName || "tool"}`,
      status: "running",
      payload: {
        ...decision,
        toolArguments,
      },
    };
    onEvent?.({ type: "tool-start", toolResult: running });
    try {
      const result = await callMcpTool({
        settings,
        serverName: decision.serverName,
        toolName: decision.toolName,
        args: toolArguments,
      });
      const finished = {
        ...running,
        status: "done",
        payload: result,
      };
      onEvent?.({ type: "tool-finish", toolResult: finished });
      return {
        content: `MCP tool \`${decision.toolName}\` on \`${decision.serverName}\` completed.\n\n\`\`\`json\n${JSON.stringify(result.result ?? result, null, 2)}\n\`\`\``,
        model: "mcp",
        toolResults: [finished],
      };
    } catch (error) {
      const authRequired = error?.code === "PLUGIN_AUTH_REQUIRED";
      const failed = {
        ...running,
        status: "error",
        payload: {
          ...decision,
          message: error instanceof Error ? error.message : String(error),
          authRequired,
          pluginId: error?.pluginId,
          pluginLabel: error?.pluginLabel,
          authLabel: error?.authLabel,
        },
      };
      onEvent?.({ type: "tool-finish", toolResult: failed });
      return {
        content: authRequired
          ? `${failed.payload.pluginLabel || "This plugin"} needs sign-in before I can use it. Click **${failed.payload.authLabel || "Sign in"}** and then try again.`
          : `I could not run the MCP tool: ${failed.payload.message}`,
        model: "mcp",
        toolResults: [failed],
      };
    }
  }

  if (decision.action === "generate_image") {
    return maybeRunImageGeneration({ parsed: decision, settings, onEvent });
  }

  return null;
}

function summarizeToolResponse(response, step) {
  if (!response) {
    return "";
  }
  const labels = (response.toolResults || [])
    .map((tool) => `${tool.label || tool.type || "tool"}:${tool.status || "done"}`)
    .join(", ");
  const body = String(response.content || "").trim().slice(0, 4000);
  return [`Step ${step}${labels ? ` (${labels})` : ""}:`, body].filter(Boolean).join("\n");
}

function taskId() {
  return `task-${new Date().toISOString().replace(/[:.]/g, "-")}-${Math.random().toString(16).slice(2, 8)}`;
}

function taskScopedSettings(settings, id) {
  if (!settings.controlledExecution?.sandboxPerTask || !settings.workspacePath) {
    return settings;
  }
  return {
    ...settings,
    workspacePath: path.join(settings.workspacePath, ".las-tasks", id),
  };
}

async function finalizeToolLoopAnswer({ messages, settings, headers, model, observations, toolResults, stream, onEvent }) {
  const payload = {
    model,
    messages: [
      {
        role: "system",
        content: `${buildSystemPrompt("", settings)}

You just used local tools for the user. Write a concise final answer.
Do not claim a file, command, database, or image was created unless it appears in the tool observations.
Mention saved workspace paths when relevant. For queued ComfyUI images, say they are queued and can be loaded/saved from the result card.
When tool observations contain web search results, synthesize a clear answer from them instead of dumping raw snippets. Include source URLs only when useful.`,
      },
      ...compactMessages(messages),
      {
        role: "user",
        content: `Tool observations:
${observations.join("\n\n")}`,
      },
    ],
    stream,
    options: {
      temperature: Number(settings.ollama.temperature ?? 0.35),
      num_ctx: Number(settings.ollama.contextTokens ?? 8192),
    },
  };
  const think = thinkValue(settings, messages);
  if (think !== undefined) {
    payload.think = think;
  }

  if (stream) {
    onEvent?.({ type: "status", message: `Streaming final answer from ${model}` });
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

  const data = await postChat({ settings, headers, payload, timeoutMs: Number(settings.ollama.timeoutMs || 120000) });

  return {
    content: data?.message?.content || observations[observations.length - 1] || "",
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

async function runToolLoop({ messages, settings, headers, model, toolMode, stream, onEvent }) {
  if (toolMode === "none") {
    return null;
  }

  const maxSteps = clamp(settings.agent?.maxToolSteps || 5, 1, 8);
  const id = taskId();
  const approved = /\bapprove\b|одобр|подтвержд|разреш/i.test(lastUser(messages).content || "");
  const executionSettings = taskScopedSettings(settings, id);
  const observations = [];
  const toolResults = [];
  logExecution(settings, {
    event: "task-start",
    taskId: id,
    model,
    workspacePath: executionSettings.workspacePath,
    settings: {
      dryRun: Boolean(settings.controlledExecution?.dryRun),
      sandboxPerTask: Boolean(settings.controlledExecution?.sandboxPerTask),
      permissionProfile: settings.agent?.permissionProfile || "balanced",
    },
  });
  if (executionSettings.workspacePath !== settings.workspacePath) {
    observations.push(`Task sandbox enabled. All workspace tools for this task are bounded to: ${executionSettings.workspacePath}. Promote outputs manually after review.`);
  }

  for (let step = 1; step <= maxSteps; step += 1) {
    onEvent?.({ type: "status", message: `Asking Ollama for tool step ${step}` });
    const decision = await decideToolWithOllama({ messages, settings, headers, model, toolMode, observations });
    if (!decision || decision.action === "answer") {
      if (!observations.length) {
        return null;
      }
      return finalizeToolLoopAnswer({ messages, settings, headers, model, observations, toolResults, stream, onEvent });
    }

    const response = await executeToolDecision({ decision, settings: executionSettings, onEvent, taskId: id, approved });
    if (!response) {
      if (!observations.length) {
        return null;
      }
      return finalizeToolLoopAnswer({ messages, settings, headers, model, observations, toolResults, stream, onEvent });
    }

    toolResults.push(...(response.toolResults || []));
    observations.push(summarizeToolResponse(response, step));
    logExecution(settings, {
      event: "tool-finish",
      taskId: id,
      action: decision.action,
      status: (response.toolResults || []).some((tool) => tool.status === "error") ? "error" : "done",
      workspacePath: executionSettings.workspacePath,
      decision,
      result: response.content,
    });

  }

  return finalizeToolLoopAnswer({ messages, settings, headers, model, observations, toolResults, stream, onEvent });
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

  const data = await postChat({ settings, headers, payload, timeoutMs: Math.min(Number(settings.ollama.timeoutMs || 120000), 30000) });

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
    if (settings._userDataDir) {
      addImageHistoryJob(
        settings._userDataDir,
        {
          prompt: parsed.prompt,
          negativePrompt: settings.comfy?.negativePrompt,
          imageModel: parsed.imageModel,
          ideogramEffort: parsed.ideogramEffort,
          count: parsed.count,
        },
        result,
      );
    }
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
  if (isOpenAiCompatible(settings)) {
    const nonStreamingPayload = {
      ...payload,
      stream: false,
    };
    const data = await postChat({
      settings,
      headers,
      payload: nonStreamingPayload,
      timeoutMs: Number(settings.ollama.timeoutMs || 120000),
    });
    const content = data?.message?.content || "";
    const thinking = data?.message?.thinking || "";
    if (thinking) {
      onEvent?.({ type: "thinking", token: thinking });
    }
    if (content) {
      onEvent?.({ type: "token", token: content });
    }
    return { content, thinking, finalData: data };
  }

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

function messageThinkOverride(messages) {
  const text = lastUser(messages).content || "";
  if (/(^|\s)--no-think\b/i.test(text)) {
    return false;
  }
  const match = text.match(/(^|\s)--think(?:\s+(low|medium|high|off))?\b/i);
  if (!match) {
    return undefined;
  }
  const value = (match[2] || "high").toLowerCase();
  if (value === "off") {
    return false;
  }
  return value;
}

function thinkValue(settings, messages) {
  const override = messages ? messageThinkOverride(messages) : undefined;
  if (override !== undefined) {
    return override;
  }
  const mode = settings.ollama?.thinking || "off";
  if (mode === "off") {
    return false;
  }
  if (["low", "medium", "high"].includes(mode)) {
    return mode;
  }
  return undefined;
}

async function runAgentMessage({ messages, settings, toolMode, stream, onEvent }) {
  settings = runtimeProviderSettings(settings);
  const headers = { "Content-Type": "application/json" };
  if (settings.ollama.apiKey) {
    headers.Authorization = `Bearer ${settings.ollama.apiKey}`;
  }

  onEvent?.({ type: "status", message: "Selecting Ollama model" });
  const model = await resolveModel(settings, headers);
  logExecution(settings, {
    event: "model-selected",
    model,
    toolMode,
    workspacePath: settings.workspacePath,
  });

  if (toolMode !== "none") {
    try {
      const routed = await runToolLoop({ messages, settings, headers, model, toolMode, stream, onEvent });
      if (routed) {
        return routed;
      }
    } catch (error) {
      onEvent?.({
        type: "status",
        message: `Tool router unavailable: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const payload = {
    model,
    messages: [{ role: "system", content: buildSystemPrompt("", settings) }, ...compactMessages(messages)],
    stream,
    options: {
      temperature: Number(settings.ollama.temperature ?? 0.35),
      num_ctx: Number(settings.ollama.contextTokens ?? 8192),
    },
  };
  const think = thinkValue(settings, messages);
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
      toolResults: [],
    };
  }

  const data = await postChat({ settings, headers, payload, timeoutMs: Number(settings.ollama.timeoutMs || 120000) });

  return {
    content: data?.message?.content || "",
    thinking: data?.message?.thinking || "",
    model: data.model || model,
    metrics: {
      totalDurationNs: data.total_duration,
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
    },
    toolResults: [],
  };
}

async function maybeRunEvaluatorPass({ messages, settings, response }) {
  if (!settings.controlledExecution?.evaluatorPass || !response?.content) {
    return response;
  }
  try {
    const runtimeSettings = runtimeProviderSettings(settings);
    const headers = { "Content-Type": "application/json" };
    if (runtimeSettings.ollama.apiKey) {
      headers.Authorization = `Bearer ${runtimeSettings.ollama.apiKey}`;
    }
    const model = await resolveModel(runtimeSettings, headers);
    const payload = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are the evaluator pass for Local Agent Studio. Review the assistant result for correctness, safety, missing tests, and whether tool claims match tool results. Return 2-5 concise bullets. Do not rewrite the whole answer.",
        },
        ...compactMessages(messages, false),
        {
          role: "assistant",
          content: response.content,
        },
      ],
      stream: false,
      options: {
        temperature: 0,
        num_ctx: Math.min(Number(runtimeSettings.ollama.contextTokens ?? 8192), 8192),
      },
    };
    const data = await postChat({ settings: runtimeSettings, headers, payload, timeoutMs: Math.min(Number(runtimeSettings.ollama.timeoutMs || 120000), 45000) });
    const review = String(data?.message?.content || "").trim();
    if (!review) {
      return response;
    }
    logExecution(settings, {
      event: "evaluator-pass",
      model: data.model || model,
      result: review,
    });
    return {
      ...response,
      content: `${response.content}\n\n**Evaluator Pass**\n${review}`,
    };
  } catch (error) {
    logExecution(settings, {
      event: "evaluator-pass-error",
      result: error instanceof Error ? error.message : String(error),
    });
    return response;
  }
}

async function sendAgentMessage({ messages, settings, toolMode }) {
  const runtimeSettings = runtimeProviderSettings(settings);
  const response = await runAgentMessage({
    messages,
    settings: runtimeSettings,
    toolMode,
    stream: false,
  });
  return maybeRunEvaluatorPass({ messages, settings: runtimeSettings, response });
}

async function sendAgentMessageStream({ messages, settings, toolMode, onEvent }) {
  try {
    const runtimeSettings = runtimeProviderSettings(settings);
    const initial = await runAgentMessage({
      messages,
      settings: runtimeSettings,
      toolMode,
      stream: true,
      onEvent,
    });
    const response = await maybeRunEvaluatorPass({ messages, settings: runtimeSettings, response: initial });
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
