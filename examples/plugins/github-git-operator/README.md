# GitHub Git Operator

Test MCP plugin for Local Agent Studio.

It can:

- List GitHub repositories
- Clone a repository into the workspace
- Show git status
- Show recent commits
- Create local git commits
- Push commits to a configured remote

## Requirements

- Git
- Node.js/npm for `npx github:<owner>/<repo>`
- Local Agent Studio handles GitHub sign-in through GitHub Device Flow and passes `GITHUB_TOKEN` to the MCP server.

## Publish

Create a new GitHub repository and upload this folder with `plugin.json`, `package.json`, `server.cjs`, and `README.md`.

Then update `plugin.json`:

```json
"homepage": "https://github.com/CrazyDashTool/LAS-github",
"repository": "https://github.com/CrazyDashTool/LAS-github",
"args": ["-y", "github:CrazyDashTool/LAS-github"]
```

## Install In Local Agent Studio

After publishing, paste the GitHub repository URL into the Plugins tab:

```text
https://github.com/CrazyDashTool/LAS-github
```

LAS will download `plugin.json` and add this MCP server config:

```text
npx -y github:CrazyDashTool/LAS-github
```

Then open Settings -> MCP, set:

- `LAS_WORKSPACE` is filled automatically by Local Agent Studio
- `GITHUB_TOKEN` is optional if you use the plugin Sign in button
- `LAS_ALLOW_COMMITS=false` if you want to block commit creation
- `LAS_ALLOW_PUSH=false` if you want to block push operations

Then:

1. Open Plugins.
2. Click `Sign in with GitHub`.
3. Finish the browser/device login.
4. Enable the MCP server.
5. Refresh tools.

Now the agent can decide to call `github_list_repos`, `git_clone`, `git_status`, `git_log`, `git_commit`, or `git_push`.

`git_push` is separate from `git_commit`. This keeps the model from pushing changes unless it explicitly chooses the push tool for the user's request.

`git_clone` accepts `repoUrl`, `repository`, `repo`, or `url`. Short GitHub names such as `CrazyDashTool/LAS-github` are converted to HTTPS clone URLs automatically.

## Local Smoke Test

From this folder:

```powershell
$env:LAS_WORKSPACE=(Get-Location).Path
node server.cjs
```

Then send JSON-RPC lines through stdin, for example:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```
