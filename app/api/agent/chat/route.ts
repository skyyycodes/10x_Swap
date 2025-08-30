import { NextResponse } from "next/server"
import { AgentkitToolkit } from "@0xgasless/agentkit"
import { ChatOpenAI } from "@langchain/openai"
import { HumanMessage, AIMessage, SystemMessage, ToolMessage, BaseMessage } from "@langchain/core/messages"
import { MemorySaver } from "@langchain/langgraph"
import { createReactAgent } from "@langchain/langgraph/prebuilt"
import { getAgent } from "@/lib/agent"
import { resolveTokenBySymbol } from "@/lib/tokens"

export const runtime = "nodejs"

type ClientMessage = { role: "user" | "assistant" | "system" | "tool"; content: string; toolName?: string }

function toLangChainMessages(msgs: ClientMessage[]): BaseMessage[] {
  return msgs.map((m) => {
    switch (m.role) {
      case "system":
        return new SystemMessage(m.content)
      case "assistant":
        return new AIMessage(m.content)
      case "tool":
        return new ToolMessage({ content: m.content, tool_call_id: m.toolName || "tool" })
      case "user":
      default:
        return new HumanMessage(m.content)
    }
  })
}

function getLLM() {
  const model = process.env.AI_MODEL || "gpt-4o-mini"
  const provider = (process.env.AI_PROVIDER || "openrouter").toLowerCase()
  const openrouter = process.env.OPENROUTER_API_KEY
  const openai = process.env.OPENAI_API_KEY
  if (provider === "openrouter" && openrouter) {
    return new ChatOpenAI({ model, apiKey: openrouter, configuration: { baseURL: "https://openrouter.ai/api/v1" } })
  }
  if (openai) {
    return new ChatOpenAI({ model, apiKey: openai })
  }
  // Fallback: if OPENROUTER is set but provider differs
  if (openrouter) {
    return new ChatOpenAI({ model, apiKey: openrouter, configuration: { baseURL: "https://openrouter.ai/api/v1" } })
  }
  throw new Error("Missing OPENROUTER_API_KEY or OPENAI_API_KEY")
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({})) as { prompt?: string; messages?: ClientMessage[]; threadId?: string }
    const prompt = (body.prompt && typeof body.prompt === "string") ? body.prompt : undefined
    const incoming = Array.isArray(body.messages) ? body.messages : (prompt ? [{ role: "user", content: prompt }] as ClientMessage[] : [])
    if (!incoming.length) return NextResponse.json({ ok: false, error: "No prompt or messages provided" }, { status: 400 })

  const { agentkit, getAddress, getBalance, smartTransfer, smartSwap } = await getAgent()
    const toolkit = new AgentkitToolkit(agentkit as any)
    const tools = toolkit.getTools()

    // Attempt to get LLM, but allow fallback parse if not available
    let llm: ChatOpenAI | undefined
    try {
      llm = getLLM()
    } catch {
      llm = undefined
    }
    const memory = new MemorySaver()
    const agent = llm
      ? createReactAgent({
          llm,
          tools,
          checkpointSaver: memory,
          messageModifier: `You are a helpful crypto agent using 0xGasless smart accounts. You can:
          - get the user's smart account address
          - check native and ERC20 balances (user can provide token contract)
          - perform gasless transfers and swaps on supported chains
          Always explain actions in simple words. If a request is unsafe or unsupported, say so clearly.`,
        })
      : undefined

    const messages = toLangChainMessages(incoming)
    const config = { configurable: { thread_id: body.threadId || `web_${Date.now()}` } }

    // Execute agent and collect the final response
    // Helper: simple intent fallback for common actions
    const fallback = async (): Promise<string | null> => {
      const lastUser = [...incoming].reverse().find((m) => m.role === "user")
      const text = (lastUser?.content || "").toLowerCase()
      if (!text) return null

      // Address
      if (/\b(address|wallet)\b/.test(text)) {
        const addr = await getAddress()
        return `Your smart account address is: ${addr}`
      }

      // Balance (ETH or token)
      if (/\b(balance|balances)\b/.test(text)) {
        // Try token address
        const tokenAddr = (lastUser!.content.match(/0x[a-fA-F0-9]{40}/) || [])[0]
        if (tokenAddr) {
          const bal = await getBalance(tokenAddr as any)
          return `Token balance (${tokenAddr}): ${bal}`
        }
        // Try symbol
        const symMatch = lastUser!.content.match(/\b([A-Z]{2,6})\b/)
        if (symMatch) {
          const token = resolveTokenBySymbol(symMatch[1])
          if (token && token.address !== 'ETH') {
            const bal = await getBalance(token.address as any)
            return `${token.symbol} balance: ${bal}`
          }
        }
        const ethBal = await getBalance()
        return `Your ETH balance: ${ethBal}`
      }

      // Transfer: "transfer 0.01 USDC to 0x..." or "transfer 0.01 to 0x..."
      const transferRe = /transfer\s+(\d+(?:\.\d+)?)\s*(?:([A-Za-z]{2,6}))?\s*(?:tokens?)?\s*(?:to|=>)\s*(0x[a-fA-F0-9]{40})/
      const tr = lastUser!.content.match(transferRe)
      if (tr) {
        const amount = tr[1]
        const symbol = tr[2]
        const to = tr[3] as `0x${string}`
        if (symbol) {
          const token = resolveTokenBySymbol(symbol)
          if (!token) return `Unknown token symbol: ${symbol}`
          const { hash } = await smartTransfer({ tokenAddress: token.address === 'ETH' ? undefined : (token.address as any), amount, destination: to, wait: true })
          return `Transfer submitted. Tx hash: ${hash}`
        } else {
          const { hash } = await smartTransfer({ amount, destination: to, wait: true })
          return `Transfer submitted. Tx hash: ${hash}`
        }
      }

      // Swap: "swap 5 USDC to ETH"
      const swapRe = /swap\s+(\d+(?:\.\d+)?)\s*([A-Za-z]{2,6})\s*(?:to|for|->)\s*([A-Za-z]{2,6})/
      const sw = lastUser!.content.match(swapRe)
      if (sw) {
        const amount = sw[1]
        const fromSym = sw[2]
        const toSym = sw[3]
        const out = await smartSwap({ tokenInSymbol: fromSym.toUpperCase(), tokenOutSymbol: toSym.toUpperCase(), amount, slippage: 0.5, wait: true })
        return `Swap submitted. Tx hash: ${out.hash}`
      }

      return null
    }

    if (!agent) {
      const fb = await fallback()
      if (fb) return NextResponse.json({ ok: true, content: fb, threadId: (config as any).configurable.thread_id })
      return NextResponse.json({ ok: false, error: "LLM not configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY, or use simple commands: 'address', 'balance', 'transfer 0.01 to 0x..', 'swap 5 USDC to ETH'." }, { status: 429 })
    }

    try {
      const result = await agent.invoke({ messages }, config as any)
      const outMsgs = (result as any)?.messages as BaseMessage[] | undefined
      const last = Array.isArray(outMsgs) && outMsgs.length ? outMsgs[outMsgs.length - 1] : undefined
      const content = (last && typeof (last as any).content === "string") ? (last as any).content : (last?.content as any)?.toString?.() || ""
      return NextResponse.json({ ok: true, content, threadId: (config as any).configurable.thread_id })
    } catch (err: any) {
      const raw = String(err?.message || err)
      const quota = /quota|rate limit|429/i.test(raw)
      if (quota) {
        const fb = await fallback()
        if (fb) return NextResponse.json({ ok: true, content: fb, threadId: (config as any).configurable.thread_id })
      }
      const guidance = quota
        ? "LLM quota or rate limit hit. Set OPENROUTER_API_KEY (recommended) or ensure your OPENAI_API_KEY has credits."
        : raw
      return NextResponse.json({ ok: false, error: guidance }, { status: quota ? 429 : 500 })
    }
  } catch (e: any) {
    const msg = e?.message || "Agent error"
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
