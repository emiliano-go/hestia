import { useState } from 'react'
import { Spinner } from '../components/primitives.jsx'
import { Icon } from '../icons.jsx'
import { truncate } from '../lib/format.js'

export const TOOL_ICONS = {
  git_pull: 'refresh',
  git_log: 'git',
  git_diff: 'git',
  git_show: 'git',
  git_status: 'git',
  git_branches: 'git',
  repo_path: 'folder',
  list_files: 'files',
  read_file: 'files',
  grep: 'search',
  read_agents_md: 'info',
  list_docs: 'files',
  gh_commits: 'git',
  gh_prs: 'git',
  gh_issues: 'chat',
  gh_ci_runs: 'settings',
  memory_search: 'search',
  memory_get: 'memory',
  memory_list: 'memory',
  memory_create: 'plus',
  memory_update: 'refresh',
  memory_delete: 'x',
  workspace_write: 'files',
  workspace_read: 'files',
  workspace_list: 'folder',
  run_subagent: 'agents',
  agent_list: 'agents',
}

export const TOOL_TITLES = {
  git_pull: 'Pull latest changes',
  git_log: 'Read commit history',
  git_diff: 'Diff changes',
  git_show: 'Show a commit',
  git_status: 'Check git status',
  git_branches: 'List branches',
  repo_path: 'Resolve repository path',
  list_files: 'List files',
  read_file: 'Read a file',
  grep: 'Search file contents',
  read_agents_md: 'Read AGENTS.md',
  list_docs: 'List docs',
  gh_commits: 'Fetch GitHub commits',
  gh_prs: 'Fetch pull requests',
  gh_issues: 'Fetch issues',
  gh_ci_runs: 'Fetch CI runs',
  memory_search: 'Search memory',
  memory_get: 'Get a memory',
  memory_list: 'List memories',
  memory_create: 'Write a memory',
  memory_update: 'Update a memory',
  memory_delete: 'Delete a memory',
  workspace_write: 'Write a workspace file',
  workspace_read: 'Read a workspace file',
  workspace_list: 'List workspace files',
  run_subagent: 'Delegate to a subagent',
  agent_list: 'List agent profiles',
}

export function ToolRun({ name, args, result }) {
  const [open, setOpen] = useState(false)
  const status = !result ? 'running' : result.ok ? 'ok' : 'error'
  const label = status === 'running' ? 'Running' : status === 'ok' ? 'Done' : 'Failed'
  const summary = result ? result.preview : JSON.stringify(args)
  return (
    <div className={`tool-run ${status}`}>
      <button className="tool-run-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-run-icon">
          {status === 'running' ? (
            <Spinner size={14} />
          ) : (
            <Icon name={status === 'ok' ? 'check' : 'x'} size={14} />
          )}
        </span>
        <Icon name={TOOL_ICONS[name] || 'play'} size={14} className="tool-run-toolicon" />
        <span className="tool-run-name" title={TOOL_TITLES[name] || name}>
          {TOOL_TITLES[name] || name}
        </span>
        <span className="tool-run-arg">{truncate(summary, 72)}</span>
        <span className={`tool-run-badge ${status}`}>{label}</span>
        <span className={`tool-run-chevron ${open ? 'open' : ''}`}>
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      {open && (
        <div className="tool-run-body">
          <div className="tool-run-section">
            <div className="tool-run-label">Arguments</div>
            <pre>{JSON.stringify(args, null, 2)}</pre>
          </div>
          {result && (
            <div className="tool-run-section">
              <div className="tool-run-label">{result.ok ? 'Result' : 'Error'}</div>
              <pre className={result.ok ? '' : 'err'}>{String(result.preview ?? '')}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function pairToolRuns(events) {
  const runs = []
  for (const evt of events) {
    if (evt.event === 'tool_call') {
      runs.push({ name: evt.name, args: evt.arguments, result: null })
    } else if (evt.event === 'tool_result') {
      for (let i = runs.length - 1; i >= 0; i--) {
        if (runs[i].name === evt.name && !runs[i].result) {
          runs[i].result = evt
          break
        }
      }
    }
  }
  return runs
}

export function parseToolArgs(value) {
  try {
    return typeof value === 'string' ? JSON.parse(value || '{}') : value || {}
  } catch (e) {
    return {}
  }
}

export function messageItems(rows) {
  const items = []
  let last = null
  for (const m of rows) {
    if (m.role === 'user') {
      items.push({ kind: 'user', id: m.id, content: m.content })
      last = null
      continue
    }
    if (m.role === 'tool') {
      if (last) {
        const run = last.runs.find((r) => !r.result && r.name === m.name)
        if (run) run.result = { ok: m.ok !== false, preview: m.content }
      }
      continue
    }
    if (m.role === 'notification') {
      items.push({ kind: 'notification', id: m.id, content: m.content })
      last = null
      continue
    }
    let calls = []
    try {
      calls = m.tool_calls ? JSON.parse(m.tool_calls) : []
    } catch (e) {
      calls = []
    }
    const item = {
      kind: 'assistant',
      id: m.id,
      content: m.content,
      runs: calls.map((c) => ({
        name: c.function?.name || c.name || 'tool',
        args: parseToolArgs(c.function?.arguments ?? c.arguments),
        result: null,
      })),
    }
    items.push(item)
    last = item
  }
  return items
}
