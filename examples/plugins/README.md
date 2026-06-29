# Local Agent Studio Plugin Drafts

These folders are starter plugin repositories. To publish one:

1. Copy one plugin folder into a new GitHub repository.
2. Keep `plugin.json` in the repository root.
3. Update `homepage`, `repository`, `author`, and any runtime settings.
4. Test that the raw manifest URL opens:

```text
https://raw.githubusercontent.com/<owner>/<repo>/main/plugin.json
```

5. Send the GitHub repository URL for review.
6. After review, add it to `electron/plugin-marketplace.json`.
7. Ship a Local Agent Studio update. Users will see the plugin as a Community marketplace card and can install it from GitHub.

## Plugin Status

The marketplace installer currently downloads and stores plugin manifests. Real execution should be provided through one of these runtime types:

- `mcp`: plugin registers MCP server configuration and exposes tools through MCP.
- `http`: plugin calls a declared HTTP API endpoint.
- `command`: plugin runs a declared local command after permission checks.
- `manifest`: plugin provides prompts, workflows, templates, or provider presets without executing code.

For safety, third-party plugin code should not run directly inside the Electron app.
