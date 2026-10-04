<p align="center">
  <strong style="font-size: 2.5em;">home</strong>
</p>

<p align="center">
  <strong>Self-hostable agentic project cockpit. FastAPI, React, Totem memory.</strong>
</p>

<p align="center">
  A central place to monitor software projects as persistent, agent-aware
  workspaces. Each project connects to its GitHub repository, documentation,
  and <code>AGENTS.md</code>, and ships with an integrated agent that reads
  from and writes to the <a href="https://github.com/emiliano-go/totem">Totem</a>
  memory system as part of its normal workflow. Sessions are just views;
  memory lives in Totem, so every new conversation starts with full context.
</p>

<p align="center">
  <a href="https://www.python.org/downloads/">
    <img src="https://img.shields.io/badge/Python-3.14%2B-3776AB?logo=python&logoColor=white&style=for-the-badge" alt="Python">
  </a>
  <a href="https://github.com/emiliano-go/home/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-10AC84?style=for-the-badge" alt="License">
  </a>
</p>

---

## What is home

`home` is a self-hosted project cockpit for managing software projects as
persistent, agent-aware workspaces. It is not an IDE and not a coding
environment; it is the central place to understand what changed, discuss
features with an agent that knows the project history and architecture, and
(eventually) let agents take actions across GitHub, repositories, CI, and
deployments.

The memory system, Totem, is embedded directly into the agent's tools: the
agent reads from and writes to persistent project memory as part of its
normal workflow, and any session can consult the memories of every other
session. The app is sessionless not because there are no sessions, but
because sessions only save memory, and agents bootstrap from Totem rather
than from chat transcripts.

Agents are read-only for now: they can clone, pull, fetch, read files, and
query GitHub, and write workspace files (plans, specs), but they do not modify the codebase.

## Features

- **Project workspaces**: register a project by Git URL; `home` clones it
  under the data volume and links the repository, its documentation, and its
  `AGENTS.md` into one workspace. A pull button refreshes the clone and the
  instructions.
- **Totem memory in the agent's tools**: the agent's MCP-style toolset
  includes `memory_search`, `memory_get`, `memory_list`, `memory_create`,
  `memory_update`, and `memory_delete`, backed by a per-project
  `.totem/totem.db` that stays file-compatible with the
  [totem](https://github.com/emiliano-go/totem) CLI. Memory is not a chat
  log; it is a curated store of decisions, gotchas, architecture facts, and
  open questions.
- **Sessionless conversations**: chat sessions are lightweight views kept
  for UI replay. Durable knowledge is distilled into Totem at the end of
  every turn, so a brand-new session bootstraps from ranked memory (matched
  against your question) instead of from an ever-growing transcript. Any
  session can consult the memories written by every other session.
- **Contextual chat with any OpenAI-compatible provider**: Kimi, DeepSeek,
  GPT, OpenRouter, or a self-hosted model behind an OpenAI-compatible
  endpoint (Ollama, vLLM, llama.cpp). Providers are configured in the UI
  with per-provider model and endpoint; API keys stay in environment
  variables and are referenced by name.
- **Read-only repository tools**: `git_pull`, `git_log`, `git_diff`,
  `git_show`, `git_status`, `git_branches` (mutating subcommands are
  rejected by a whitelist), plus `list_files`, `read_file`, `grep`,
  `read_agents_md`, and `list_docs`, all sandboxed to the project clone.
- **GitHub tools**: `gh_commits`, `gh_prs`, `gh_issues`, and `gh_ci_runs`
  against the linked repository via the REST API, with an optional token
  for higher rate limits and private repos.
- **Visible agent work**: tool calls and results stream over SSE and render
  as animated rows in the chat (running → done/failed), next to a memory
  browser for inspecting and searching what the agent has learned.
- **Project insight**: each project has a status board (branch, last commit,
  ahead/behind, open PRs, issues, CI), a "since your last visit" digest, a
  GitHub tab for browsing and summarizing PRs/issues/runs, and an activity
  timeline merging sessions, memory, files, commits, and GitHub events.
- **Kanban task board**: tasks are first-class objects, independent of chat
  sessions. Drag cards across columns (backlog/doing/review/done), and let the
  agent manage the board through the `task_list`, `task_create`, `task_update`,
  and `task_delete` tools.
- **Roadmap / milestones**: group tasks into goals with a target date and a
  progress bar, and link Totem memories (decisions, constraints) to the
  milestone's outcome. `milestone_list` / `milestone_create` / `milestone_update`
  let the agent manage them too.
- **Triage**: turn a GitHub issue or PR into a written plan and a set of board
  tasks in one click, run by the configured `triage` action.
- **Persistent workspace**: agent-generated files (plans, specs, research
  notes) go to a per-project workspace directory in the data volume,
  outside the repository, via the `workspace_write` / `workspace_read` /
  `workspace_list` tools (sandboxed the same way as repo file tools).
- **Multiple agents, multiple models**: named agent profiles (Agents page)
  each bind a provider (any OpenAI-compatible model), a system prompt, a
  tool subset, and a turn budget. Pick a profile for the main chat, and let
  the main agent delegate to subagents via `run_subagent`: it runs the
  profile's model against its tool subset and returns a summary. Presets
  include `explore` (repo + files), `github-scan`, `memory-keeper`, and
  `code-reviewer`, so cheap models can do the legwork while a stronger one
  reasons. Subagents cannot spawn further subagents.
- **MCP server included**: the same toolset is exposed over MCP on stdio
  (`home-mcp`, with `HOME_PROJECT_DIR` set), so external agents get the
  exact same read-only project tools and Totem memory.
- **Single-container self-hosting**: one Docker image, one volume
  (`/data`) holding the registry database, the clones, and the totem
  databases.

## How it works

1. **Register a project** (Projects page): give it a name and a Git URL.
   `home` clones the repository into the data volume, snapshots its
   `AGENTS.md`, and initializes the Totem database on first use.
2. **Configure a provider** (Providers page): pick a preset (Kimi,
   DeepSeek, OpenAI, OpenRouter, Ollama, custom) or enter a base URL and
   model by hand. The key is read from the environment variable you name;
   use Test to verify the connection before chatting.
3. **Chat** (project Chat tab): every turn starts by assembling a system
   prompt from the project instructions, the repository layout, and the
   Totem memories ranked most relevant to your question. The agent then
   runs its tool-calling loop: recalling memories, inspecting files and git
   history, and checking GitHub as needed, with each step visible in the
   UI.
4. **Memory grows by itself**: when a turn finishes, its essence is written
   into Totem as a memory, and the agent is instructed to record decisions,
   facts, and architecture explanations as it goes. Nothing durable lives
   only in the transcript.
5. **Come back later, anywhere**: start a new session and the agent already
   knows the project: the memory digest replaces the chat history. Use the
   Memory tab to search, review, and audit what has been learned.

## Agents and subagents

The main chat agent can be any configured agent profile, and it can delegate
to subagents mid-conversation. A profile is a name, a provider (hence a
model), a system prompt, a comma-separated tool subset (`repo`, `files`,
`github`, `memory`), and a `max_turns` budget.

- Create profiles on the Agents page, starting from a preset (`explore`,
  `github-scan`, `memory-keeper`, `code-reviewer`) or from scratch.
- In the chat, pick a profile in the Agent dropdown to run the whole
  conversation with that model and prompt.
- The main agent also gets `run_subagent` and `agent_list` tools: it can hand
  a self-contained read-only task to a profile (for example, "explore" on a
  cheap model) and continue with the summary.

## Quick start

With Docker Compose:

```sh
export KIMI_API_KEY=sk-...   # or any provider you plan to use
docker compose up -d --build
```

Or plain Docker:

```sh
docker build -t home .
docker run -p 8080:8080 -v home-data:/data \
  -e KIMI_API_KEY=sk-... \
  home
```

Open http://localhost:8080, register a project by Git URL, configure a
provider, and chat.

Local development:

```sh
uv sync
uv run uvicorn home.main:app --reload --port 8080
```

## Development

```sh
uv run pytest            # tests (run from repo root)
```

## License

MIT
