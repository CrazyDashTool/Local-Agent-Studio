# Changelog

## 0.2.1 - Memory, Artifacts, Gallery, Tool Center

### New Surfaces

- Added an Images tab with image history, gallery cards, full-screen preview, prompt details, and download-to-workspace actions.
- Added an Artifacts tab for reusable documents, snippets, drafts, designs, JSON, Markdown, and code-like outputs.
- Added a Tools tab for remote provider presets, MCP tools, project templates, plugin marketplace drafts, personal memory, and task queue controls.

### Agent and Tools

- Added LM Studio remote/local provider preset using OpenAI-compatible chat endpoints.
- Added llama.cpp provider preset using OpenAI-compatible llama-server endpoints.
- Added OpenAI-compatible `/v1/models` and `/v1/chat/completions` support alongside Ollama `/api/chat`.
- Added artifact tool actions so the agent can create, read, and append reusable artifacts separately from chat messages and normal workspace files.
- Added personal memory storage between chats, stored in the app data folder.
- Added memory controls to Settings and Tools.
- Added memory context injection into the LLM system prompt when memory is enabled.
- Added optional auto-remember routing for stable user preferences and project facts.
- Added image generation job history tracking for ComfyUI jobs.
- Added remote provider presets for local machine, Runpod remote GPU, and LAN Ollama-style setups.
- Improved MCP tool UI with grouped tool listing and manual JSON argument runner.
- Added project templates for Work, Dev, Fun, and Research workspaces.
- Added plugin marketplace draft storage with install/remove state for future plugin distribution.

### UI

- Added model capability badges for text, image, audio, and MCP support.
- Added a compact tool activity timeline above chat messages.
- Added smoother card, gallery, lightbox, dropdown, timeline, and panel animations.
- Added responsive layouts for Tools, Images, Artifacts, and the gallery lightbox.
- Added a Settings action to run the setup wizard again.
- Reworked setup wizard into four pages: workspace, provider/model, search/API keys, and profile/memory.
- Added Skip, Back, Next, and Launch controls to setup wizard.

### Notes

- Agent task queue already existed in 0.2.0 and is now surfaced more clearly in the Tools tab.
- 0.2.1 changes are currently local until committed and pushed.

## 0.2.0 - Agent Tools, Linux Build, MCP, Runpod

### Platform and Packaging

- Added Linux support to the project positioning, README badges, build notes, and release assets.
- Added a Linux `tar.gz` build script for Windows/CI-friendly packaging.
- Added Linux AppImage and `.deb` packaging script for Linux or CI environments with Linux packaging tools.
- Kept macOS packaging available through the macOS build script. macOS packages must be produced on macOS or a macOS CI runner.
- Added `version.json` as the lightweight version source for manual update checks.
- Updated the app version to `0.2.0`.
- Kept the Windows NSIS installer in English.

### Chat and Context

- Added editable user messages with true context rewind. Editing an older prompt removes later messages from the active conversation context and reruns from that point.
- Added an agent task queue so users can send the next request while the current one is still running.
- Added chat export and import as JSON.
- Added smoother message, tool result, composer, setup, and dropdown animations.
- Added reduced-motion handling for users who disable motion effects.
- Improved Markdown rendering for chat responses, including code blocks, inline code, bold text, lists, and copyable snippets.
- Added Enter-to-send behavior while preserving multiline input with Shift+Enter.
- Added automatic scroll-to-bottom behavior for new messages and streaming updates.

### Reasoning

- Added a ChatGPT-style reasoning selector near the model picker.
- Limited reasoning choices to Off, Low, Medium, and High.
- Added `--think`, `--think low`, `--think medium`, `--think high`, and `--think off` support.
- Added reasoning panels for models that expose thinking traces.
- Set reasoning to Off by default.

### Local Date and Setup

- Added a first-launch setup wizard for workspace and provider configuration.
- Added a setting that lets the LLM receive the current date/time from the user's PC.
- Added the same local date/time option to the setup wizard.
- Added first-launch workspace setup so the app can guide users before file tools are used.

### Workspace, Files, and Downloads

- Added workspace file preview and download panel.
- Added workspace-aware file tools for creating, reading, editing, deleting, and previewing files.
- Improved file creation behavior so the LLM can decide appropriate filenames and extensions instead of relying on keyword matching.
- Added drag-and-drop file and image attachments.
- Added clipboard paste support for images/files.
- Added attachment import IPC so pasted images can be staged for multimodal prompts.
- Added file tool permission controls.

### Image Generation

- Added custom ComfyUI image generation models through user-defined workflow JSON files.
- Added model selection for Z-Image-Turbo, Flux.2 klein 9b, and Ideogram v4.
- Added Ideogram v4 effort selection: turbo, default, and quality.
- Improved tool routing so the model can decide when image generation is needed.
- Added support for repeated tool use, allowing the agent to search or generate more than once when useful.
- Changed generated image behavior so images are presented first and saved into the workspace only when the user downloads or when the agent intentionally moves them.

### Search and Tool Routing

- Improved search responses so the agent summarizes results into a readable answer instead of dumping raw search text.
- Added support for up to three web searches per user request when the agent needs more context.
- Improved the LLM tool decision layer so search, files, databases, image generation, terminal, and MCP tools can be selected by the model instead of hard-coded keyword checks.
- Added tool permission controls for files, search, images, terminal, database, and MCP.

### MCP

- Added initial MCP support through a backend service.
- Added MCP tool listing and tool calling through the agent action layer.
- Added MCP settings and provider inspection wiring.
- Added MCP to README highlights and release messaging.

### Runpod

- Added Runpod provider settings for remote Ollama-compatible and ComfyUI-style workloads.
- Added provider routing hooks for Runpod-backed LLM and image endpoints.
- Added Runpod to README highlights and release messaging.

### Databases

- Added local database creation from structured JSON/CSV-like objects.
- Added JSON database, CSV export, and SQLite-style database paths for agent-created data.
- Added database tool permission controls.

### Updates

- Added a visible Check for update action near the user area.
- Added Check for update in Settings.
- Added a lightweight update checker that compares the local `version.json` with a remote `version.json`.
- Kept update behavior manual and transparent rather than silently installing updates.

### UI and Settings

- Redesigned select controls into Local Agent Studio-styled dropdowns.
- Added smoother dropdown animations and interaction states.
- Added user/profile controls near the sidebar footer.
- Added settings for language, theme, providers, permissions, workspace, updates, Runpod, MCP, image workflows, and local date/time context.
- Added language choices: English, Russian, Ukrainian, German, and Polish.
- Added themes: System, Light, and Dark.

### Generated Release Assets

- Added GitHub update preview image: `assets/update-0.2.0-github-preview.png`.
- Added Reddit update preview image: `assets/update-0.2.0-reddit-preview.png`.
- Added Linux badge to README.

### Known Packaging Notes

- Windows installer builds successfully on Windows.
- Linux `tar.gz` builds successfully from the current Windows workspace.
- Linux AppImage and `.deb` builds should be produced on Linux or CI because Windows lacks the expected Linux packaging environment.
- macOS `.dmg` and `.zip` builds must be produced on macOS or macOS CI because electron-builder does not build macOS packages from Windows.
