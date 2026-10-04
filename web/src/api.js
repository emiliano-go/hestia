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
  pullProject: (id) => request(`/projects/${id}/pull`, { method: 'POST' }),
  deleteProject: (id) => request(`/projects/${id}`, { method: 'DELETE' }),

  listPresets: () => request('/providers/presets'),
  listProviders: () => request('/providers'),
  createProvider: (body) => request('/providers', { method: 'POST', body: JSON.stringify(body) }),
  deleteProvider: (id) => request(`/providers/${id}`, { method: 'DELETE' }),
  testProvider: (id) => request(`/providers/${id}/test`, { method: 'POST' }),

  listAgentPresets: () => request('/agents/presets'),
  listAgents: () => request('/agents'),
  createAgent: (body) => request('/agents', { method: 'POST', body: JSON.stringify(body) }),
  deleteAgent: (id) => request(`/agents/${id}`, { method: 'DELETE' }),

  listSessions: (projectId) => request(`/projects/${projectId}/sessions`),
  listMessages: (sessionId) => request(`/sessions/${sessionId}/messages`),
  searchMemory: (projectId, q) =>
    request(`/projects/${projectId}/memory?q=${encodeURIComponent(q)}`),

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
