# Official Plugins

Official plugins are verified plugin manifests bundled with Local Agent Studio releases.

## Activate GitHub Git Operator

The first official plugin is:

```text
GitHub Git Operator
https://github.com/CrazyDashTool/LAS-github
```

It lets the agent list GitHub repositories, clone repositories into the workspace, inspect git status, view recent commits, create local commits, and push branches when the user approves that action.

## Requirements

Install these first:

- Git: https://git-scm.com/downloads
- Node.js/npm: https://nodejs.org

## Setup

1. Open Local Agent Studio.
2. Open the `Plugins` tab.
3. Find `GitHub Git Operator`.
4. Click `Install`.
5. Click `Sign in with GitHub`.
6. Complete the GitHub Device Flow login in the browser.
7. Open `Settings`.
8. Open `MCP`.
9. Enable `github-git-operator`.
10. Refresh tools or restart the app.

After that, ask the agent things like:

```text
Show my GitHub repositories.
Clone CrazyDashTool/Local-Agent-Studio into my workspace.
Show git status for this project.
Create a local commit with message "Update README".
Push the current branch after I approve it.
```

## How It Works

The plugin uses an MCP server started by Local Agent Studio:

```text
npx -y github:CrazyDashTool/LAS-github
```

Authentication is handled by Local Agent Studio with GitHub Device Flow. The app opens GitHub in the browser, stores the user token locally, and passes it to the plugin as `GITHUB_TOKEN`. Users do not need to paste GitHub tokens manually.

## Security Notes

- The plugin works inside the configured Local Agent Studio workspace.
- Commit and push actions are separate tools.
- Push requires GitHub sign-in and should stay behind the app's human approval gate.
- Private repositories require GitHub sign-in.
- If you want to disable local commits, set `LAS_ALLOW_COMMITS=false` in the MCP server environment.
- If you want to disable push, set `LAS_ALLOW_PUSH=false` in the MCP server environment.

## Adding More Official Plugins

To add another verified plugin to the app:

```powershell
npm run marketplace:add-plugin -- https://github.com/owner/plugin-repo
```

Then rebuild and ship a new Local Agent Studio update. Users will see the plugin card after updating.
