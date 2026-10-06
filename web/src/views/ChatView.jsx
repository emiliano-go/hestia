import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { Composer, SectionEmpty } from '../components/primitives.jsx'
import { ToolRun, messageItems, pairToolRuns } from '../chat/tools.jsx'
import { Icon } from '../icons.jsx'
import { useAsync } from '../lib/hooks.js'
import { mdToHtml } from '../lib/markdown.js'

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

  const send = useCallback(
    (text) => {
      if (busyRef.current) return
      busyRef.current = true
      setError(null)
      setLiveEvents([])
      setPending('working')
      setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }])
      api
        .chat(
          projectId,
          {
            message: text,
            session_id: sessionRef.current || undefined,
            action: action || undefined,
            ...(agentId ? { agent_id: agentId } : { provider_id: providerId || undefined }),
          },
          {
            onEvent: (evt) => {
              if (evt.event === 'session') {
                sessionRef.current = evt.session_id
                setStreamingText('')
                onSessionCreated(evt.session_id)
              } else if (evt.event === 'message') {
                setPending(null)
                setStreamingText('')
                if (evt.content && evt.content.trim()) {
                  setMessages((prev) => [
                    ...prev,
                    { id: `a-${Date.now()}`, role: 'assistant', content: evt.content },
                  ])
                }
              } else if (evt.event === 'error') {
                setPending(null)
                setStreamingText('')
                setError(evt.message || 'Chat error')
              } else if (evt.event === 'question') {
                setPending(null)
                setStreamingText('')
                setQuestions((prev) => [...prev, { ...evt, status: 'open' }])
              } else if (evt.event === 'token') {
                setPending('streaming')
                setStreamingText((prev) => prev + (evt.text || ''))
              } else {
                setPending('streaming')
                setLiveEvents((prev) => [...prev, evt])
              }
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
    [projectId, agentId, providerId, onSessionCreated, action] // eslint-disable-line react-hooks/exhaustive-deps
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
          {messages.length === 0 &&
            liveEvents.length === 0 &&
            !streamingText &&
            !pending && (
              <SectionEmpty
                icon="chat"
                title="New conversation"
                hint="Ask anything about this project, or describe a task to get started."
              />
            )}
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
              <ToolRun name={r.name} args={r.args} result={r.result} />
            </div>
          ))}
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
              <span>{pending === 'working' ? 'Thinking' : 'Responding'}</span>
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
        {error && <div className="error-banner">{error}</div>}
        <Composer busy={!!pending} placeholder="Message..." onSend={send} />
      </div>
    </div>
  )
}
