# Reddit Draft

Subreddit: `r/Ollama`

Title:

```text
Local Agent Studio based on ollama
```

Body:

```text
Hey everyone,

I’m working on Local Agent Studio, a Windows desktop app built around Ollama that tries to bring a local-first “Agent Mode” experience into a normal ChatGPT/Claude-style UI.

The idea is simple: keep the chat interface familiar, but let the assistant use local or self-owned tools when needed.

Current features:

- Ollama chat with streaming responses
- model picker and reasoning panel for models that support thinking
- image input for vision-capable Ollama models
- ComfyUI integration for image generation workflows
- web search through SearXNG, SerpAPI, or Ollama Web Search
- workspace file creation/editing/preview
- local JSON/CSV/SQLite database creation from objects
- subprocess/Docker sandbox commands
- light/dark/system themes
- English/Russian/Ukrainian/German/Polish UI language options

One thing I recently changed: the app now asks Ollama to decide whether an image should be generated before calling ComfyUI. So the flow is:

Prompt -> Ollama tool decision -> ComfyUI only if needed

That means questions like “what is in this screenshot?” go to the vision model, while “generate a banner” can route to ComfyUI.

I’m still polishing the project and would love feedback from people who use Ollama locally:

- What local tools would you expect an Ollama-based desktop agent to support?
- Would you prefer explicit tool approval every time, or an auto mode?
- Which models should I optimize the default presets for?
- What would make this useful enough for your daily local AI workflow?

The project is not public yet, but I’m preparing the repo, README, screenshots, and Windows installer before opening it up.
```
