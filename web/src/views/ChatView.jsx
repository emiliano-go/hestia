import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Composer } from '../components/primitives.jsx'
import { ToolRun, messageItems, pairToolRuns } from '../chat/tools.jsx'
import { Icon } from '../icons.jsx'
import { useAsync } from '../lib/hooks.js'
import { mdToHtml } from '../lib/markdown.js'
import { randomPhrase } from '../lib/statusPhrases.js'

const BTW_RE = /^\/btw(?:\s+|$)/i

// Last few messages plus whatever the main agent is streaming right now,
// truncated so the side question gets a compact, cheap context.
function btwContext(messages, streamingText) {
  const rows = []
  for (const m of messages.slice(-8)) {
    if ((m.role === 'user' || m.role === 'assistant') && m.content) {
      rows.push({ role: m.role, content: String(m.content).slice(0, 1200) })
    }
  }
  if (streamingText) {
    rows.push({
      role: 'assistant',
      content: `[working on it right now] ${streamingText.slice(0, 4000)}`,
    })
  }
  return rows
}

export function ChatView({ projectId, sessionId, agentId, providerId, onSessionCreated, initialMessage, action }) {
  const sessionsReq = useAsync(() => api.listSessions(projectId), [projectId])
  const [messages, setMessages] = useState([])
  const [liveEvents, setLiveEvents] = useState([])
  const [pending, setPending] = useState(null) // 'working' | 'streaming' | null
  const [error, setError] = useState(null)
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState({})
  const [streamingText, setStreamingText] = useState('')
  const [rememberedId, setRememberedId] = useState(null)
  const [btw, setBtw] = useState(null) // {question, answer, error, pending}
  const [phrase, setPhrase] = useState(() => randomPhrase())
  const [thinkingText, setThinkingText] = useState('')
  const [thinkingOpen, setThinkingOpen] = useState(true)
  const [runId, setRunId] = useState(null)
  const [reconnecting, setReconnecting] = useState(false)
  const [stopped, setStopped] = useState(false)
  const [btwMinimized, setBtwMinimized] = useState(false)
  const [memoryNote, setMemoryNote] = useState(null)
  const sessionRef = useRef(sessionId)
  const busyRef = useRef(false)
  const initialSentRef = useRef(false)
  const scrollRef = useRef(null)

  const remember = (text, id) => {
    const trimmed = (text || '').trim()
    if (!trimmed) return
    api
      .addPreference(trimmed)
      .then(() => setRememberedId(id))
      .catch((e) => setError(e.message || String(e)))
  }

  useEffect(() => {
    sessionRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    setMessages([])
    setLiveEvents([])
    setError(null)
    setQuestions([])
    setAnswers({})
    setStreamingText('')
    setBtw(null)
    setThinkingText('')
    setThinkingOpen(true)
    setRunId(null)
    setReconnecting(false)
    setStopped(false)
    setBtwMinimized(false)
    setMemoryNote(null)
    setPhrase(randomPhrase())
    if (sessionId) {
      api
        .listMessages(sessionId)
        .then(setMessages)
        .catch((e) => setError(e.message || String(e)))
      api.listQuestions(sessionId).then(setQuestions).catch(() => {})
    }
  }, [sessionId])

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, liveEvents, pending, streamingText])

  const askBtw = useCallback(
    (question) => {
      setBtwMinimized(false)
      setBtw({ question, answer: '', error: null, pending: true, unread: false })
      api
        .btw(
          projectId,
          {
            question,
            session_id: sessionRef.current || undefined,
            context: btwContext(messages, streamingText),
            ...(agentId
              ? { agent_id: agentId }
              : { provider_id: providerId || undefined }),
          },
          {
            onEvent: (evt) => {
              if (evt.event === 'token') {
                setBtw((b) => b && { ...b, answer: b.answer + (evt.text || '') })
              } else if (evt.event === 'error') {
                setBtw((b) => b && { ...b, error: evt.message || 'btw error', pending: false })
              } else if (evt.event === 'done') {
                setBtw((b) => b && { ...b, pending: false, unread: true })
              }
            },
          }
        )
        .catch((e) =>
          setBtw((b) => b && { ...b, error: e.message || String(e), pending: false })
        )
    },
    [projectId, agentId, providerId, messages, streamingText]
  )

  useEffect(() => {
    if (!btw) return
    const onKey = (e) => {
      if (e.key === 'Escape') setBtwMinimized(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [btw])

  const stopRun = useCallback(() => {
    if (!runId) return
    api.stopRun(runId).catch((e) => setError(e.message || String(e)))
  }, [runId])

  const send = useCallback(
    (text) => {
      const trimmed = text.trim()
      if (BTW_RE.test(trimmed)) {
        const question = trimmed.replace(BTW_RE, '').trim()
        if (question) askBtw(question)
        return
      }
      if (busyRef.current) return
      setError(null)
      setLiveEvents([])
      setPending('working')
      setPhrase(randomPhrase())
      setThinkingText('')
      setThinkingOpen(true)
      setRunId(null)
      setReconnecting(false)
      setStopped(false)
      setMemoryNote(null)
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }])
      api
        .chatStream(
          projectId,
          {
            message: text,
            session_id: sessionRef.current || undefined,
            action: action || undefined,
            ...(agentId ? { agent_id: agentId } : { provider_id: providerId || undefined }),
          },
          {
            onStatus: (s) => setReconnecting(s === 'reconnecting'),
            onEvent: (evt) => {
              if (evt.run_id) setRunId(evt.run_id)
              if (evt.event === 'session') {
                sessionRef.current = evt.session_id
                setStreamingText('')
                onSessionCreated(evt.session_id)
              } else if (evt.event === 'message') {
                setPending(null)
                setStreamingText('')
                setThinkingOpen(false)
                if (evt.content && evt.content.trim()) {
                  setMessages((prev) => [
                    ...prev,
                    { id: `a-${Date.now()}`, role: 'assistant', content: evt.content },
                  ])
                }
              } else if (evt.event === 'error') {
                setPending(null)
                setStreamingText('')
                setReconnecting(false)
                setError(evt.message || 'Chat error')
              } else if (evt.event === 'stopped' || evt.event === 'timed_out') {
                setPending(null)
                setReconnecting(false)
                if (evt.event === 'stopped') setStopped(true)
                else setError(evt.message || 'Run timed out')
              } else if (evt.event === 'question') {
                setPending(null)
                setStreamingText('')
                setQuestions((prev) => [...prev, { ...evt, status: 'open' }])
              } else if (evt.event === 'thinking') {
                setPending('streaming')
                setThinkingText((prev) => prev + (evt.text || ''))
              } else if (evt.event === 'token') {
                setPending('streaming')
                setStreamingText((prev) => prev + (evt.text || ''))
              } else if (evt.event === 'memory') {
                if (evt.writer) setMemoryNote('Memory writer dispatched in the background')
                else if (evt.written)
                  setMemoryNote(`Memory: ${evt.written} written`)
                else if (evt.candidates)
                  setMemoryNote(
                    `Memory: ${evt.candidates} candidate${evt.candidates > 1 ? 's' : ''} to review`
                  )
                else setMemoryNote('Memory checkpoint: nothing durable')
              } else if (
                evt.event === 'tool_call' ||
                evt.event === 'tool_result' ||
                evt.event === 'tool_progress'
              ) {
                setPending('streaming')
                setLiveEvents((prev) => [...prev, evt])
              }
              // usage / ping / done are ignored here
            },
          }
        )
        .catch((err) => {
          setError(err.message || String(err))
          const sid = sessionRef.current
          if (sid) {
            api.listMessages(sid).then(setMessages).catch(() => {})
          } else {
            setMessages((prev) => prev.filter((m) => !String(m.id).startsWith('u-')))
          }
        })
        .finally(() => {
          busyRef.current = false
          setPending(null)
          sessionsReq.reload()
          const sid = sessionRef.current
          if (sid) {
            api
              .listMessages(sid)
              .then((rows) => {
                setMessages(rows)
                setLiveEvents([])
              })
              .catch(() => {})
            api.listQuestions(sid).then(setQuestions).catch(() => {})
          }
        })
    },
    [projectId, agentId, providerId, onSessionCreated, action, askBtw] // eslint-disable-line react-hooks/exhaustive-deps
  )

  useEffect(() => {
    if (initialMessage && !initialSentRef.current) {
      initialSentRef.current = true
      send(initialMessage)
    }
  }, [initialMessage, send])

  const answerQuestion = (question, text) => {
    const value = (text || '').trim()
    if (!value) return
    setQuestions((prev) =>
      prev.map((q) => (q.id === question.id ? { ...q, status: 'answered', answer: value } : q))
    )
    send(value)
  }

  const skipQuestion = (question) => {
    api
      .dismissQuestion(question.id)
      .then(() => setQuestions((prev) => prev.filter((q) => q.id !== question.id)))
      .catch((e) => setError(e.message || String(e)))
  }

  return (
    <div className="chat">
      {action === 'goal' && (
        <div className="chat-banner">
          <Icon name="sparkles" size={14} /> Goal discussion: refine the outcome, then press
          "Generate board" on the Goals tab.
        </div>
      )}
      <div className="chat-scroll">
        <div className="chat-inner">
          {messageItems(messages).map((item) =>
            item.kind === 'user' ? (
              <div key={`u-${item.id}`} className="msg user">
                <div className="bubble">{item.content}</div>
              </div>
            ) : item.kind === 'notification' ? (
              <div key={`n-${item.id}`} className="msg notification">
                <div className="notification-banner">{item.content}</div>
              </div>
            ) : (
              <div key={`a-${item.id}`}>
                {item.content && (
                  <div className="msg assistant">
                    <div className="avatar">
                      <Icon name="sparkles" size={15} />
                    </div>
                    <div>
                      <div
                        className="msg-md prose"
                        dangerouslySetInnerHTML={{ __html: mdToHtml(item.content) }}
                      />
                      <button
                        type="button"
                        className="msg-remember"
                        onClick={() => remember(item.content, item.id)}
                      >
                        <Icon name="check" size={12} />
                        {rememberedId === item.id ? 'Saved as preference' : 'Remember this'}
                      </button>
                    </div>
                  </div>
                )}
                {item.runs.map((r, i) => (
                  <div key={i} className="tool-run-wrap">
                    <ToolRun name={r.name} args={r.args} result={r.result} />
                  </div>
                ))}
              </div>
            )
          )}
          {pairToolRuns(liveEvents).map((r, i) => (
            <div key={i} className="tool-run-wrap">
              <ToolRun name={r.name} args={r.args} result={r.result} progress={r.progress} />
            </div>
          ))}
          {thinkingText && (
            <div className="thinking-block">
              <button
                type="button"
                className="thinking-head"
                onClick={() => setThinkingOpen((o) => !o)}
              >
                <Icon name="sparkles" size={13} />
                <span>Thinking</span>
                <span className={`thinking-chevron ${thinkingOpen ? 'open' : ''}`}>
                  <Icon name="chevronDown" size={13} />
                </span>
              </button>
              {thinkingOpen && <div className="thinking-body">{thinkingText}</div>}
            </div>
          )}
          {streamingText && (
            <div className="msg assistant">
              <div className="avatar">
                <Icon name="sparkles" size={15} />
              </div>
              <div
                className="msg-md prose"
                dangerouslySetInnerHTML={{ __html: mdToHtml(streamingText) }}
              />
            </div>
          )}
          {pending && (
            <div className="working">
              <span className="pulse" />
              <span>{phrase}</span>
              <span className="working-dots">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          {questions
            .filter((q) => q.status === 'open')
            .map((q) => (
              <div key={q.id} className="question-card">
                <div className="question-head">
                  <Icon name={q.kind === 'approval' ? 'alert' : 'help'} size={14} />
                  {q.kind === 'approval' ? 'Approval needed' : 'The agent needs input'}
                </div>
                <div className="question-text">{q.question}</div>
                {q.options?.length > 0 && (
                  <div className="question-options">
                    {q.options.map((o) => (
                      <button key={o} className="btn" onClick={() => answerQuestion(q, o)}>
                        {o}
                      </button>
                    ))}
                  </div>
                )}
                <div className="row" style={{ marginBottom: 0 }}>
                  <input
                    value={answers[q.id] || ''}
                    onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        answerQuestion(q, answers[q.id])
                      }
                    }}
                    placeholder="Type your answer..."
                  />
                  <button
                    className="btn primary"
                    disabled={!(answers[q.id] || '').trim()}
                    onClick={() => answerQuestion(q, answers[q.id])}
                  >
                    Answer
                  </button>
                  <button className="btn" onClick={() => skipQuestion(q)}>
                    Skip
                  </button>
                </div>
              </div>
            ))}
          <div ref={scrollRef} />
        </div>
      </div>
      <div className="composer-wrap">
        {reconnecting && <div className="chat-note">Reconnecting…</div>}
        {memoryNote && <div className="chat-note">{memoryNote}</div>}
        {stopped && !pending && <div className="chat-note">Stopped by you.</div>}
        {btw && !btwMinimized && (
          <div className="btw-box">
            <div className="btw-head">
              <span className="btw-prompt">$</span>
              <span className="btw-question" title={btw.question}>
                {btw.question}
              </span>
              <button
                className="btw-close"
                onClick={() => setBtwMinimized(true)}
                title="Minimize (Esc)"
              >
                <Icon name="chevronDown" size={13} />
              </button>
              <button
                className="btw-close"
                onClick={() => {
                  setBtw(null)
                  setBtwMinimized(false)
                }}
                title="Discard"
              >
                <Icon name="x" size={13} />
              </button>
            </div>
            <div className="btw-body">
              {btw.error ? (
                <div className="btw-error">{btw.error}</div>
              ) : btw.answer ? (
                <div className="btw-answer">
                  {btw.answer}
                  {btw.pending && <span className="btw-cursor" />}
                </div>
              ) : (
                <span className="btw-dim">
                  {btw.pending ? (
                    <>
                      reading context
                      <span className="working-dots">
                        <i />
                        <i />
                        <i />
                      </span>
                    </>
                  ) : (
                    'no answer'
                  )}
                </span>
              )}
            </div>
          </div>
        )}
        {error && <div className="error-banner">{error}</div>}
        <Composer
          busy={!!pending}
          placeholder="Message... (use /btw for a side question)"
          hint="Enter to send · /btw asks a side question without stopping the task"
          onSend={send}
          onStop={stopRun}
          trailing={
            btw && btwMinimized ? (
              <button
                type="button"
                className="btw-icon"
                title="Reopen the side question"
                onClick={() => {
                  setBtwMinimized(false)
                  setBtw((b) => b && { ...b, unread: false })
                }}
              >
                <Icon name="chat" size={15} />
                {btw.unread && <span className="btw-dot" />}
              </button>
            ) : null
          }
        />
      </div>
    </div>
  )
}
