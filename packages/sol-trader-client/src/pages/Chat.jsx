import { useState, useRef, useEffect } from 'react'
import { useStore } from '../store'

const SUGGESTIONS = [
  "What's my best performing strategy?",
  "Which positions should I close?",
  "What's my total PnL today?",
  "Should I increase position size on SOL?",
  "What's the win rate across all strategies?",
  "Which tokens are trending right now?",
]

export function Chat() {
  const { chatMessages, chatLoading, sendChat } = useStore()
  const [input, setInput] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const submit = async () => {
    if (!input.trim() || chatLoading) return
    const msg = input.trim()
    setInput('')
    await sendChat(msg)
  }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
  }

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden p-6 gap-4">
      <div>
        <h1 className="font-display text-2xl font-bold">AI Chat</h1>
        <p className="font-mono text-[11px] text-gray-600 mt-0.5">Query NEXUS AI about your portfolio, strategies, and market conditions</p>
      </div>

      <div className="panel flex-1 overflow-hidden flex flex-col">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center">
              <div className="text-5xl mb-4 opacity-10">✦</div>
              <div className="font-display font-semibold text-gray-500 mb-2">NEXUS AI Assistant</div>
              <p className="font-mono text-xs text-gray-600 text-center mb-6 max-w-md">Ask me anything about your trading performance, open positions, strategies, or market conditions.</p>
              <div className="grid grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => { setInput(s) }} className="text-left px-3 py-2 bg-bg-700 border border-border rounded hover:border-gray-500 transition-colors font-mono text-[10px] text-gray-400 hover:text-gray-200">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {chatMessages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded flex items-center justify-center bg-accent-green/10 border border-accent-green/20 text-accent-green text-xs mr-3 mt-0.5 flex-shrink-0">✦</div>
              )}
              <div className={`max-w-[75%] rounded-lg px-4 py-3 ${msg.role === 'user' ? 'bg-bg-600 text-white' : 'bg-bg-700 border border-border'}`}>
                <div className="font-body text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          ))}

          {chatLoading && (
            <div className="flex justify-start animate-fade-in">
              <div className="w-6 h-6 rounded flex items-center justify-center bg-accent-green/10 border border-accent-green/20 text-accent-green text-xs mr-3 mt-0.5">✦</div>
              <div className="bg-bg-700 border border-border rounded-lg px-4 py-3">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 bg-accent-green/50 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="border-t border-border p-4">
          <div className="flex gap-3">
            <textarea
              className="input-field flex-1 resize-none h-12 py-3 leading-tight"
              placeholder="Ask NEXUS AI anything about your trading..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              rows={1}
            />
            <button onClick={submit} disabled={chatLoading || !input.trim()} className="btn-primary px-6 h-12">
              {chatLoading ? '...' : '↑'}
            </button>
          </div>
          <div className="font-mono text-[9px] text-gray-700 mt-1.5">Enter to send · Shift+Enter for newline</div>
        </div>
      </div>
    </div>
  )
}
