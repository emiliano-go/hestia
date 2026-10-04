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
query GitHub, but they do not modify the codebase.

## Features

- Project workspaces: each project links a GitHub repository, its local
  clone, documentation, and `AGENTS.md`.
- Totem memory embedded in the agent's MCP tools (search, get, create,
  update), backed by a per-project `.totem/totem.db` that stays compatible
  with the totem CLI.
- Contextual chat with any OpenAI-compatible provider (Kimi, DeepSeek, GPT,
  OpenRouter) or a self-hosted model (Ollama, vLLM, llama.cpp).
- Read-only repository tools: clone, pull, fetch, log, diff, show, plus file
  read, grep, and glob, all sandboxed to the project clone.
- GitHub tools: commits, PRs, issues, and CI runs via the REST API.
- Single Docker container; one volume holds the registry database, clones,
  and totem databases.

## Quick start

With Docker:

```sh
docker build -t home .
docker run -p 8080:8080 -v home-data:/data \
  -e KIMI_API_KEY=sk-... \
  home
```

Open http://localhost:8080, register a project by Git URL, and chat.

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
