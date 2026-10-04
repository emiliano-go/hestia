const BASE = '/api'

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const data = await res.json()
      detail = data.detail || JSON.stringify(data)
    } catch (e) {
      // keep statusText
    }
    throw new Error(detail)
  }
  if (res.status === 204) return null
  return res.json()
}

export const api = {
  listProjects: () => request('/projects'),
  createProject: (body) => request('/projects', { method: 'POST', body: JSON.stringify(body) }),
  getProject: (id) => request(`/projects/${id}`),
  openProject: (id) => request(`/projects/${id}/open`, { method: 'POST' }),
  pullProject: (id) => request(`/projects/${id}/pull`, { method: 'POST' }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),
  activity: () => request('/activity'),

  projectStatus: (id, since) =>
    request(
      `/projects/${id}/status${since ? `?since=${encodeURIComponent(since)}` : ''}`
    ),
  projectActivity: (id, github = true) =>
    request(`/projects/${id}/activity?github=${github ? 'true' : 'false'}`),
  projectGithub: (id, kind, state = 'open') =>
    request(`/projects/${id}/github?kind=${kind}&state=${state}`),

  listTasks: (projectId) => request(`/projects/${projectId}/tasks`),
  createTask: (projectId, body) =>
    request(`/projects/${projectId}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (taskId, body) =>
    request(`/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTask: (taskId) => request(`/tasks/${taskId}`, { method: 'DELETE' }),

  listMilestones: (projectId) => request(`/projects/${projectId}/milestones`),
  createMilestone: (projectId, body) =>
    request(`/projects/${projectId}/milestones`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMilestone: (milestoneId, body) =>
    request(`/milestones/${milestoneId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMilestone: (milestoneId) =>
    request(`/milestones/${milestoneId}`, { method: 'DELETE' }),

  triage: (projectId, body) =>
    request(`/projects/${projectId}/triage`, { method: 'POST', body: JSON.stringify(body) }),

  listPresets: () => request('/providers/presets'),
  listProviders: () => request('/providers'),
  createProvider: (body) => request('/providers', { method: 'POST', body: JSON.stringify(body) }),
  deleteProvider: (id) => request(`/providers/${id}`, { method: 'DELETE' }),
  testProvider: (id) => request(`/providers/${id}/test`, { method: 'POST' }),

  listAgentPresets: () => request('/agents/presets'),
  listAgents: () => request('/agents'),
  createAgent: (body) => request('/agents', { method: 'POST', body: JSON.stringify(body) }),
  updateAgent: (id, body) =>
    request(`/agents/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteAgent: (id) => request(`/agents/${id}`, { method: 'DELETE' }),

  listActions: () => request('/actions'),
  setActionDefault: (key, agentId) =>
    request(`/actions/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ agent_id: agentId }),
    }),

  listSessions: (projectId) => request(`/projects/${projectId}/sessions`),
  listMessages: (sessionId) => request(`/sessions/${sessionId}/messages`),
  searchMemory: (projectId, q) =>
    request(`/projects/${projectId}/memory?q=${encodeURIComponent(q)}`),

  listWorkspace: (projectId, pattern = '*') =>
    request(`/projects/${projectId}/workspace?pattern=${encodeURIComponent(pattern)}`),
  getWorkspaceFile: async (projectId, path) => {
    const res = await fetch(
      `${BASE}/projects/${projectId}/workspace/file?path=${encodeURIComponent(path)}`
    )
    if (!res.ok) throw new Error(res.status === 404 ? 'File not found' : res.statusText)
    return res.text()
  },
  listGallery: () => request('/gallery'),
  fixMemory: (projectId, body) =>
    request(`/projects/${projectId}/memory/fix`, { method: 'POST', body: JSON.stringify(body) }),

  // SSE chat: POST stream of `data: {json}` lines. Calls handlers as events arrive.
  async chat(projectId, { message, session_id, provider_id }, handlers) {
    const res = await fetch(`${BASE}/projects/${projectId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, session_id, provider_id }),
    })
    if (!res.ok) {
      let detail = res.statusText
      try {
        const data = await res.json()
        detail = data.detail || JSON.stringify(data)
      } catch (e) {
        // keep statusText
      }
      throw new Error(detail)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx)
        buffer = buffer.slice(idx + 1)
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        let evt
        try {
          evt = JSON.parse(trimmed.slice(5).trim())
        } catch (e) {
          continue
        }
        handlers.onEvent(evt)
        if (evt.event === 'error') {
          await reader.cancel().catch(() => {})
          return
        }
      }
    }
  },
}
