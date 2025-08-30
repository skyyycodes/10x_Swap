"use client"
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { MessageCircle, Send, Bot, X } from "lucide-react"

type Msg = { role: "user" | "assistant"; content: string }

export default function ChatBubble() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [threadId, setThreadId] = useState<string | undefined>(undefined)
  const endRef = useRef<HTMLDivElement | null>(null)

  const scrollToEnd = useCallback(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [])
  useEffect(() => { scrollToEnd() }, [messages, scrollToEnd])

  const send = async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput("")
    setMessages((m) => [...m, { role: "user", content: text }])
    setLoading(true)
    try {
      const res = await fetch("/api/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [...messages, { role: "user", content: text }], threadId }),
      })
      const json = await res.json()
      if (json?.ok) {
        if (!threadId && json.threadId) setThreadId(json.threadId)
        setMessages((m) => [...m, { role: "assistant", content: String(json.content || "") }])
      } else {
        setMessages((m) => [...m, { role: "assistant", content: `Error: ${json?.error || res.status}` }])
      }
    } catch (e: any) {
      setMessages((m) => [...m, { role: "assistant", content: `Error: ${e?.message || e}` }])
    } finally {
      setLoading(false)
    }
  }

  const typing = loading

  // Public runtime hints for badges and explorer links
  const CHAIN_ID = useMemo(() => Number(process.env.NEXT_PUBLIC_CHAIN_ID || "8453"), [])
  const chainLabel = CHAIN_ID === 84532 ? "Base Sepolia" : "Base"
  const explorerBase = CHAIN_ID === 84532 ? "https://sepolia.basescan.org" : "https://basescan.org"
  const providerLabel = (process.env.NEXT_PUBLIC_AI_PROVIDER || "").toLowerCase() || "auto"
  const modelLabel = process.env.NEXT_PUBLIC_AI_MODEL || "gpt-4o-mini"

  // Linkify tx hashes and addresses with explorer links
  const renderContent = (text: string) => {
    const re = /(0x[a-fA-F0-9]{64})|(0x[a-fA-F0-9]{40})/g
    const out: React.ReactNode[] = []
    let lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const [match, tx, addr] = m
      if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index))
      if (tx) {
        out.push(
          <a key={`${m.index}-tx`} href={`${explorerBase}/tx/${tx}`} target="_blank" rel="noreferrer" className="text-fuchsia-300 underline underline-offset-2">
            {tx}
          </a>
        )
      } else if (addr) {
        out.push(
          <a key={`${m.index}-addr`} href={`${explorerBase}/address/${addr}`} target="_blank" rel="noreferrer" className="text-indigo-300 underline underline-offset-2">
            {addr}
          </a>
        )
      }
      lastIndex = m.index + match.length
    }
    if (lastIndex < text.length) out.push(text.slice(lastIndex))
    return out
  }

  const presets: { label: string; prompt: string }[] = [
    { label: "My address", prompt: "what's my address?" },
    { label: "ETH balance", prompt: "get my balances" },
    { label: "USDC balance", prompt: "get my USDC balance" },
    { label: "Swap", prompt: "swap 5 USDC to ETH" },
    { label: "Transfer", prompt: "transfer 0.01 ETH to 0x0000000000000000000000000000000000000000" },
  ]

  const usePreset = (p: string, autoSend = true) => {
    setInput(p)
    if (autoSend) setTimeout(() => send(), 0)
  }

  return (
    <>
      {/* Floating Button with glow & hover */}
      <motion.button
        aria-label="Open AI chat"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-5 right-5 z-50 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-white shadow-xl shadow-fuchsia-500/20 focus:outline-none"
        whileHover={{ scale: 1.07 }}
        whileTap={{ scale: 0.95 }}
      >
        <span className="absolute inset-0 rounded-full bg-fuchsia-500/30 blur-xl -z-10" aria-hidden />
        <MessageCircle className="h-6 w-6" />
        <span className="absolute -z-10 inline-flex h-full w-full animate-ping rounded-full bg-fuchsia-400/20" aria-hidden />
      </motion.button>

      {/* Chat Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-panel"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="fixed bottom-24 right-5 z-50 flex h-[28rem] w-[22rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-950/80 text-slate-100 shadow-2xl backdrop-blur-xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 place-items-center rounded-full bg-white/10">
                  <Bot className="h-4 w-4 text-fuchsia-300" />
                </div>
                <div className="text-sm font-semibold">0xGasless AI Agent</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 sm:inline">{chainLabel}</span>
                <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 sm:inline">{providerLabel === 'auto' ? 'Auto' : providerLabel}</span>
                <span className="hidden rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-slate-300 sm:inline">{modelLabel}</span>
                <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-300 hover:bg-white/5 hover:text-white">
                <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Quick actions */}
            {messages.length === 0 && (
              <div className="flex flex-wrap gap-2 border-b border-white/10 px-3 pb-3 pt-2">
                {presets.map((x) => (
                  <button
                    key={x.label}
                    onClick={() => usePreset(x.prompt)}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300 hover:border-fuchsia-400/40 hover:text-white"
                  >
                    {x.label}
                  </button>
                ))}
              </div>
            )}

            {/* Messages */}
            <div className="flex-1 space-y-2 overflow-y-auto px-3 py-3">
              {messages.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-slate-300">
                  Ask things like: "what's my address?", "check my USDC balance", "swap 5 USDC to ETH".
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className="flex max-w-[85%] items-start gap-2">
                    {m.role === "assistant" && (
                      <div className="mt-1 hidden h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 sm:grid">
                        <Bot className="h-3.5 w-3.5 text-fuchsia-300" />
                      </div>
                    )}
                    <div
                      className={
                        m.role === "user"
                          ? "max-w-full rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-600 px-3 py-2 text-sm shadow-md"
                          : "max-w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 shadow"
                      }
                    >
                      <div className="whitespace-pre-wrap break-words">{renderContent(m.content)}</div>
                    </div>
                  </div>
                </div>
              ))}
              {typing && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-1 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300">
                    <span className="inline-flex h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.2s]" />
                    <span className="inline-flex h-2 w-2 animate-bounce rounded-full bg-slate-300" />
                    <span className="inline-flex h-2 w-2 animate-bounce rounded-full bg-slate-300 [animation-delay:0.2s]" />
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            {/* Input */}
            <div className="border-t border-white/10 p-3">
              <div className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 shadow-inner focus-within:border-fuchsia-400/40">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && !e.shiftKey ? (e.preventDefault(), send()) : undefined}
                  placeholder={loading ? "Working..." : "Type a message"}
                  disabled={loading}
                  className="flex-1 bg-transparent text-sm text-slate-100 placeholder:text-slate-400 focus:outline-none"
                />
                <motion.button
                  onClick={send}
                  disabled={loading}
                  whileHover={{ scale: loading ? 1 : 1.05 }}
                  whileTap={{ scale: loading ? 1 : 0.95 }}
                  className="grid h-9 w-9 place-items-center rounded-lg bg-fuchsia-600 text-white shadow disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
                    </svg>
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </motion.button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
