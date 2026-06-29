const { execFile } = require("node:child_process");
const fs = require("node:fs");
const { endpoint, fetchJson } = require("./fetch.cjs");

function now() {
  return Date.now();
}

async function measured(id, name, kind, endpointLabel, fn) {
  const started = now();
  try {
    const details = await fn();
    return {
      id,
      name,
      kind,
      endpoint: endpointLabel,
      status: "healthy",
      latencyMs: now() - started,
      details,
    };
  } catch (error) {
    return {
      id,
      name,
      kind,
      endpoint: endpointLabel,
      status: "error",
      latencyMs: now() - started,
      details: error instanceof Error ? error.message : String(error),
    };
  }
}

function configured(id, name, kind, endpointLabel, ok, details) {
  return {
    id,
    name,
    kind,
    endpoint: endpointLabel,
    status: ok ? "healthy" : "warning",
    latencyMs: null,
    details,
  };
}

function checkDockerStatus(mode) {
  return new Promise((resolve) => {
    const started = now();
    execFile("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 4000 }, (error, stdout) => {
      if (error) {
        resolve({
          id: "docker",
          name: "Docker Sandbox",
          kind: "Sandbox",
          endpoint: "docker",
          status: mode === "docker" ? "error" : "warning",
          latencyMs: now() - started,
          details: mode === "docker" ? "Docker недоступен или не запущен" : "Опционально; сейчас выбран subprocess",
        });
        return;
      }

      resolve({
        id: "docker",
        name: "Docker Sandbox",
        kind: "Sandbox",
        endpoint: "docker",
        status: "healthy",
        latencyMs: now() - started,
        details: `Docker Engine ${stdout.trim()}`,
      });
    });
  });
}

function workflowStatus(settings) {
  const workflowPaths = [
    ["Z-Image-Turbo", settings.image?.zImageWorkflowPath],
    ["Flux.2 klein 9b", settings.image?.fluxWorkflowPath],
    ["Ideogram v4", settings.image?.ideogramWorkflowPath],
    ...(settings.image?.customModels || []).map((model) => [model.label || model.id, model.workflowPath]),
  ];
  const missing = workflowPaths.filter(([, filePath]) => !filePath || !fs.existsSync(filePath)).map(([name]) => name);

  return configured(
    "image-workflows",
    "ComfyUI Workflows",
    "Image",
    "electron/workflows",
    missing.length === 0,
    missing.length ? `Не найдены workflow: ${missing.join(", ")}` : "Z-Image, Flux.2 и Ideogram v4 workflow найдены",
  );
}

function runpodStatus(settings) {
  const enabled = Boolean(settings.runpod?.enabled);
  const endpoint = settings.runpod?.baseUrl || settings.runpod?.ollamaBaseUrl || settings.runpod?.comfyBaseUrl || settings.runpod?.endpointId || "not configured";
  return configured(
    "runpod",
    "Runpod",
    "Remote Provider",
    endpoint,
    enabled && Boolean(endpoint && endpoint !== "not configured"),
    enabled
      ? "Runpod remote endpoints are configured for LLM/ComfyUI/MCP-style workloads."
      : "Disabled. Enable Runpod in Settings to use remote workloads.",
  );
}

function mcpStatus(settings) {
  const servers = (settings.mcp?.servers || []).filter((server) => server.enabled);
  return configured(
    "mcp",
    "MCP Servers",
    "Tools",
    servers.length ? `${servers.length} server(s)` : "not configured",
    Boolean(settings.mcp?.enabled && servers.length),
    settings.mcp?.enabled
      ? servers.length
        ? `${servers.length} enabled MCP server(s).`
        : "MCP is enabled, but no server is configured."
      : "Disabled. Add servers in Settings to expose remote/local MCP tools.",
  );
}

async function checkProviders(settings) {
  const ollama = measured("ollama", "Ollama", "LLM", settings.ollama.baseUrl, async () => {
    if (settings.ollama?.apiFormat === "openai-compatible") {
      const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/v1/models"), { timeoutMs: 5000 });
      const models = Array.isArray(data.data) ? data.data.map((model) => model.id || model.name).filter(Boolean).slice(0, 5) : [];
      return models.length ? `OpenAI-compatible models: ${models.join(", ")}` : "OpenAI-compatible server responded, but no models were listed";
    }
    const data = await fetchJson(endpoint(settings.ollama.baseUrl, "/api/tags"), { timeoutMs: 5000 });
    const models = Array.isArray(data.models) ? data.models.map((model) => model.name).slice(0, 5) : [];
    return models.length ? `Модели: ${models.join(", ")}` : "Сервер отвечает, моделей не найдено";
  });

  const comfy = measured("comfy", "ComfyUI", "Image/Video", settings.comfy.baseUrl, async () => {
    const data = await fetchJson(endpoint(settings.comfy.baseUrl, "/system_stats"), { timeoutMs: 5000 });
    return data?.devices?.length ? `${data.devices.length} device(s)` : "system_stats OK";
  });

  const workflows = Promise.resolve(workflowStatus(settings));

  const searxng = measured("searxng", "SearXNG", "Search", settings.searxng.baseUrl, async () => {
    const url = new URL(endpoint(settings.searxng.baseUrl, "/search"));
    url.searchParams.set("q", "local agent health check");
    url.searchParams.set("format", "json");
    const data = await fetchJson(url.toString(), { timeoutMs: 6000 });
    const count = Array.isArray(data.results) ? data.results.length : 0;
    return `JSON search OK, ${count} result(s)`;
  });

  const serpApi = Promise.resolve(
    configured(
      "serpapi",
      "SerpAPI",
      "Search",
      "https://serpapi.com/search.json",
      Boolean(settings.serpApi.apiKey),
      settings.serpApi.apiKey ? "Ключ задан; live-запросы выполняются только при поиске" : "Добавь SERPAPI_API_KEY или ключ в настройках",
    ),
  );

  const ollamaSearch = Promise.resolve(
    configured(
      "ollama-search",
      "Ollama Web Search",
      "Search",
      "https://ollama.com/api/web_search",
      Boolean(settings.ollamaSearch.apiKey),
      settings.ollamaSearch.apiKey ? "Ключ задан; live-запросы выполняются только при поиске" : "Нужен Ollama API key для облачного web_search",
    ),
  );

  const docker = checkDockerStatus(settings.sandbox.mode);
  const runpod = Promise.resolve(runpodStatus(settings));
  const mcp = Promise.resolve(mcpStatus(settings));

  return Promise.all([ollama, comfy, workflows, searxng, serpApi, ollamaSearch, runpod, mcp, docker]);
}

module.exports = {
  checkProviders,
};
