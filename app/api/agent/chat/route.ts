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
  const body = await req.json().catch(() => ({})) as { prompt?: string; messages?: ClientMessage[]; threadId?: string; walletAddress?: string; chainId?: number }
    const prompt = (body.prompt && typeof body.prompt === "string") ? body.prompt : undefined
    const incoming = Array.isArray(body.messages) ? body.messages : (prompt ? [{ role: "user", content: prompt }] as ClientMessage[] : [])
    if (!incoming.length) return NextResponse.json({ ok: false, error: "No prompt or messages provided" }, { status: 400 })

  const chainOverride = typeof body.chainId === 'number' ? body.chainId : undefined
  const { agentkit, getAddress, getBalance, smartTransfer, smartSwap } = await getAgent(chainOverride)
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
          - fetch market data, token prices, gas estimates, and portfolio information
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

      // Helper: decide which address to use based on phrasing
      const resolveAddressContext = async () => {
        const { getAddresses } = await getAgent(chainOverride)
        const { smart, eoa } = await getAddresses()
        const clientEOA = (body.walletAddress && /^0x[a-fA-F0-9]{40}$/.test(body.walletAddress)) ? body.walletAddress : undefined

        const mentionsConnected = /(connected|my wallet|metamask|my eoa|connected eoa|wallet address)/i.test(lastUser!.content)
        const mentionsServer = /(server eoa|agent eoa|agent key|server wallet)/i.test(lastUser!.content)
        const mentionsSmart = /(smart account|smart|gasless)/i.test(lastUser!.content)
        const mentionsEOAOnly = /\beoa\b/i.test(lastUser!.content)

        if (mentionsConnected) {
          return { target: clientEOA, label: 'Connected EOA', missing: !clientEOA }
        }
        if (mentionsServer) {
          return { target: eoa, label: 'Server EOA', missing: false }
        }
        if (mentionsSmart) {
          return { target: smart, label: 'Smart Account', missing: false }
        }
        if (mentionsEOAOnly) {
          // Prefer client EOA when unspecified, else server EOA
          return { target: clientEOA || eoa, label: clientEOA ? 'Connected EOA' : 'Server EOA', missing: !clientEOA && false }
        }
        // Default: prefer Connected EOA if provided (read-only friendly), else smart account
        if (clientEOA) {
          return { target: clientEOA, label: 'Connected EOA', missing: false }
        }
        return { target: smart, label: 'Smart Account', missing: false }
      }

      // Address
      if (/\b(address|wallet)\b/.test(text)) {
  const { getAddresses } = await getAgent(chainOverride)
        const { smart, eoa } = await getAddresses()
        const clientEOA = (body.walletAddress && /^0x[a-fA-F0-9]{40}$/.test(body.walletAddress)) ? body.walletAddress : undefined
        return [
          `Agent smart account (shared): ${smart}`,
          `Server EOA (agent key): ${eoa}`,
          clientEOA ? `Connected EOA (your wallet): ${clientEOA}` : undefined,
        ].filter(Boolean).join('\n')
      }

  // Balance (native or token)
      if (/\b(balance|balances)\b/.test(text)) {
        const addrCtx = await resolveAddressContext()
        if (addrCtx.missing) {
          return 'No connected wallet detected. Connect your wallet to query the Connected EOA. '
        }
        const fmtUSD = (n: number) => {
          if (!Number.isFinite(n) || n === 0) return '0.00'
          const abs = Math.abs(n)
          if (abs > 0 && abs < 0.01) return (n < 0 ? '-' : '') + '0.01'
          return n.toFixed(2)
        }
        // Try token address
        const tokenAddr = (lastUser!.content.match(/0x[a-fA-F0-9]{40}/) || [])[0]
        if (tokenAddr) {
          const bal = await getBalance(tokenAddr as any, addrCtx.target as any)
          return `Token balance (${addrCtx.label}) ${tokenAddr}: ${parseFloat(bal).toFixed(4)}`
        }
        // Try symbol
        const symMatch = lastUser!.content.match(/\b([A-Z]{2,6})\b/)
        if (symMatch) {
          const { getChainInfo } = await getAgent(chainOverride)
          const info = await getChainInfo()
          const token = resolveTokenBySymbol(symMatch[1], info.chainId)
          if (token && token.address !== 'ETH' && token.address !== 'AVAX') {
            const bal = await getBalance(token.address as any, addrCtx.target as any)
            const formattedBal = parseFloat(bal).toFixed(4)
            try {
              const { getTokenPrice } = await getAgent()
              const priceData = await getTokenPrice(token.symbol)
              const usd = parseFloat(bal) * (priceData?.price || 0)
              return `${token.symbol}: ${formattedBal} ($${fmtUSD(usd)})`
            } catch {
              return `${token.symbol}: ${formattedBal}`
            }
          }
        }
        const ethBal = await getBalance(undefined, addrCtx.target as any)
        try {
          const { getTokenPrice } = await getAgent(chainOverride)
          // Decide native symbol based on chain
          const { getChainInfo } = await getAgent(chainOverride)
          const info = await getChainInfo()
          const nativeSym = info.nativeSymbol
          const priceData = await getTokenPrice(nativeSym)
          const usd = parseFloat(ethBal) * (priceData?.price || 0)
          return `${nativeSym}: ${parseFloat(ethBal).toFixed(4)} ($${fmtUSD(usd)})`
        } catch {
          const { getChainInfo } = await getAgent(chainOverride)
          const info = await getChainInfo()
          const nativeSym = info.nativeSymbol
          return `${nativeSym}: ${parseFloat(ethBal).toFixed(4)}`
        }
      }

      // Market data and prices
    if (/\b(price|prices?|market|market data|top|tokens?)\b/.test(text)) {
  const { getTokenPrice, getMarketData } = await getAgent(chainOverride)
        
        // Check for specific token (case-insensitive, e.g., "price of eth")
        const symMatch = (lastUser!.content || '').match(/(?:price(?:\s+of)?\s+)?([a-z0-9]{2,10})/i)
        if (symMatch && symMatch[1]) {
          const sym = symMatch[1].toUpperCase()
          try {
            const priceData = await getTokenPrice(sym)
            return `${sym} price: $${priceData.price}`
          } catch (e) {
            // fall through to overview if specific fails
          }
        }
        
        // General market overview (only if user asked about market, not gas)
        if (/\b(market|top|coins?|cryptocurrencies|tokens?)\b/.test(text)) {
          try {
            // Determine requested count, default 5, cap at 20
            const nMatch = text.match(/top\s+(\d{1,2})/)
            const n = Math.min(20, Math.max(1, nMatch ? parseInt(nMatch[1], 10) : 5))
            const marketData = await getMarketData()
            const top5 = (Array.isArray(marketData) ? marketData : [])
              .slice(0, n)
              .map((coin: any) => `${coin.symbol}: $${Number(coin.price || 0).toFixed(4)}`)
              .join(', ')
            return `Top ${n} cryptocurrencies: ${top5}`
          } catch (e) {
            return `Couldn't fetch market data: ${e instanceof Error ? e.message : 'Unknown error'}`
          }
        }
      }

      // Gas estimates
      if (/\b(gas|gas price|gas estimate|fees?)\b/.test(text)) {
        try {
          const { getGasEstimate } = await getAgent(chainOverride)
          const gasData = await getGasEstimate()
          return `Current gas price: ${gasData.gasPrice} Gwei\nBase fee: ${gasData.baseFee} Gwei\nChain: ${gasData.chain} (${gasData.chainId})`
        } catch (e) {
          return `Couldn't fetch gas estimate: ${e instanceof Error ? e.message : 'Unknown error'}`
        }
      }

      // Portfolio overview
      if (/\b(portfolio|portfolio overview|total value|net worth)\b/.test(text)) {
        try {
          const { getPortfolioOverview } = await getAgent(chainOverride)
          const addrCtx = await resolveAddressContext()
          if (addrCtx.missing) {
            return 'No connected wallet detected. Connect your wallet to query the Connected EOA portfolio.'
          }
          const portfolio = await getPortfolioOverview(addrCtx.target as any)
          const fmtUSD = (n: number) => {
            if (!Number.isFinite(n) || n === 0) return '0.00'
            const abs = Math.abs(n)
            if (abs > 0 && abs < 0.01) return (n < 0 ? '-' : '') + '0.01'
            return n.toFixed(2)
          }
          const assets = portfolio.assets.map((asset: any) => {
            const formattedBalance = parseFloat(asset.balance).toFixed(4)
            return `${asset.symbol}: ${formattedBalance} ($${fmtUSD(asset.valueUSD)})`
          }).join('\n')
          return `Portfolio Overview (${addrCtx.label}):\nTotal Value: $${fmtUSD(portfolio.totalValueUSD)}\n\nAssets:\n${assets}`
        } catch (e) {
          return `Couldn't fetch portfolio: ${e instanceof Error ? e.message : 'Unknown error'}`
        }
      }

      // Transaction history
      if (/\b(transactions?|history|recent|tx)\b/.test(text)) {
        try {
          const { getTransactionHistory } = await getAgent(chainOverride)
          const txs = await getTransactionHistory()
          if (txs.length === 0) {
            return "No recent transactions found."
          }
            const { getChainInfo } = await getAgent(chainOverride)
            const info = await getChainInfo()
            const nativeSym = info.nativeSymbol
            const recent = txs.slice(0, 3).map((tx: any) => 
            `${tx.status === 'success' ? '✅' : '❌'} ${tx.hash.slice(0, 8)}...${tx.hash.slice(-6)}: ${tx.value} ${nativeSym}`
          ).join('\n')
          return `Recent transactions:\n${recent}${txs.length > 3 ? `\n...and ${txs.length - 3} more` : ''}`
        } catch (e) {
          return `Couldn't fetch transaction history: ${e instanceof Error ? e.message : 'Unknown error'}`
        }
      }

      // Transfer: "transfer 0.01 USDC to 0x..." or "transfer 0.01 to 0x..."
      const transferRe = /transfer\s+(\d+(?:\.\d+)?)\s*(?:([A-Za-z]{2,6}))?\s*(?:tokens?)?\s*(?:to|=>)\s*(0x[a-fA-F0-9]{40})/
      const tr = lastUser!.content.match(transferRe)
      if (tr) {
        const amount = tr[1]
        const symbol = tr[2]
        const to = tr[3] as `0x${string}`
        if (symbol) {
    const { getChainInfo } = await getAgent(chainOverride)
          const info = await getChainInfo()
          const token = resolveTokenBySymbol(symbol, info.chainId)
          if (!token) return `Unknown token symbol: ${symbol}`
          const { hash } = await smartTransfer({ tokenAddress: token.address === 'ETH' ? undefined : (token.address as any), amount, destination: to, wait: true })
          return `Transfer submitted. Tx hash: ${hash}`
        } else {
          const { hash } = await smartTransfer({ amount, destination: to, wait: true })
          return `Transfer submitted. Tx hash: ${hash}`
        }
      }

      // Enhanced Smart Transfer Patterns
      // Batch transfer: "batch transfer 0.01 ETH to 0x... and 0.02 USDC to 0x..."
      const batchTransferRe = /batch\s+transfer\s+(.+?)(?:\s+and\s+(.+))?/
      const batchMatch = lastUser!.content.match(batchTransferRe)
      if (batchMatch) {
        try {
          const { smartTransferAdvanced } = await getAgent()
          const transfers = []
          
          // Parse multiple transfers
          const transferTexts = [batchMatch[1], batchMatch[2]].filter(Boolean)
          for (const text of transferTexts) {
            const match = text.match(/(\d+(?:\.\d+)?)\s*([A-Za-z]{2,6})?\s*(?:to|=>)\s*(0x[a-fA-F0-9]{40})/)
            if (match) {
              const [, amount, symbol, destination] = match
              const { getChainInfo } = await getAgent()
              const info = await getChainInfo()
              const token = symbol ? resolveTokenBySymbol(symbol, info.chainId) : null
              transfers.push({
                destination: destination as `0x${string}`,
                amount,
                tokenAddress: token && (token.address === 'ETH' || token.address === 'AVAX') ? undefined : (token?.address as any)
              })
            }
          }
          
          if (transfers.length > 0) {
            const result = await smartTransferAdvanced({ 
            amount: transfers[0].amount,
            destination: transfers[0].destination as `0x${string}`,
            batch: transfers, 
            wait: true 
          })
            return `Batch transfer submitted! ${transfers.length} transfers executed. Hash: ${result.hash}`
          }
        } catch (e: any) {
          return `Batch transfer failed: ${e.message}`
        }
      }

      // Scheduled transfer: "schedule transfer 0.01 ETH to 0x... for tomorrow at 2pm"
      const scheduledTransferRe = /schedule\s+transfer\s+(\d+(?:\.\d+)?)\s*([A-Za-z]{2,6})?\s*(?:to|=>)\s*(0x[a-fA-F0-9]{40})\s+(?:for|at)\s+(.+)/i
      const scheduledMatch = lastUser!.content.match(scheduledTransferRe)
      if (scheduledMatch) {
        try {
          const [, amount, symbol, destination, timeText] = scheduledMatch
          const { getChainInfo } = await getAgent()
          const info = await getChainInfo()
          const token = symbol ? resolveTokenBySymbol(symbol, info.chainId) : null
          
          // Simple time parsing (you can enhance this)
          let scheduleDate = new Date()
          if (timeText.toLowerCase().includes('tomorrow')) {
            scheduleDate.setDate(scheduleDate.getDate() + 1)
          }
          if (timeText.includes('2pm') || timeText.includes('14:00')) {
            scheduleDate.setHours(14, 0, 0, 0)
          }
          
          const { smartTransferAdvanced } = await getAgent()
          const result = await smartTransferAdvanced({
            tokenAddress: token && (token.address === 'ETH' || token.address === 'AVAX') ? undefined : (token?.address as any),
            amount,
            destination: destination as `0x${string}`,
            schedule: scheduleDate,
            priority: 'normal'
          })
          
          return `Scheduled transfer set for ${scheduleDate.toLocaleString()}. Amount: ${amount} ${symbol || 'ETH'} to ${destination.slice(0, 8)}...`
        } catch (e: any) {
          return `Scheduled transfer failed: ${e.message}`
        }
      }

      // Priority transfer: "urgent transfer 0.01 ETH to 0x..." or "cheap transfer 0.01 ETH to 0x..."
      const priorityTransferRe = /(urgent|fast|cheap|economy)\s+transfer\s+(\d+(?:\.\d+)?)\s*([A-Za-z]{2,6})?\s*(?:to|=>)\s*(0x[a-fA-F0-9]{40})/
      const priorityMatch = lastUser!.content.match(priorityTransferRe)
      if (priorityMatch) {
        const [, priority, amount, symbol, destination] = priorityMatch
        try {
          const { getChainInfo } = await getAgent()
          const info = await getChainInfo()
          const token = symbol ? resolveTokenBySymbol(symbol, info.chainId) : null
          
          let routing: 'fastest' | 'cheapest' | 'mostReliable' = 'fastest'
          if (priority === 'cheap' || priority === 'economy') routing = 'cheapest'
          else if (priority === 'urgent' || priority === 'fast') routing = 'fastest'
          
          const { smartTransferWithRouting } = await getAgent()
          const result = await smartTransferWithRouting({
            tokenAddress: token && (token.address === 'ETH' || token.address === 'AVAX') ? undefined : (token?.address as any),
            amount,
            destination: destination as `0x${string}`,
            routing,
            wait: true
          })
          
          return `${priority.charAt(0).toUpperCase() + priority.slice(1)} transfer submitted! Hash: ${result.hash}\nRouting: ${routing}`
        } catch (e: any) {
          return `${priority.charAt(0).toUpperCase() + priority.slice(1)} transfer failed: ${e.message}`
        }
      }

      // Auto-swap transfer: "smart transfer 0.01 ETH to 0x..." (handles insufficient balance)
      const smartTransferRe = /smart\s+transfer\s+(\d+(?:\.\d+)?)\s*([A-Za-z]{2,6})?\s*(?:to|=>)\s*(0x[a-fA-F0-9]{40})/
      const smartMatch = lastUser!.content.match(smartTransferRe)
      if (smartMatch) {
        try {
          const [, amount, symbol, destination] = smartMatch
          const { getChainInfo } = await getAgent()
          const info = await getChainInfo()
          const token = symbol ? resolveTokenBySymbol(symbol, info.chainId) : null
          
          const { smartTransferAdvanced } = await getAgent()
          const result = await smartTransferAdvanced({
            tokenAddress: token?.address === 'ETH' ? undefined : (token?.address as any),
            amount,
            destination: destination as `0x${string}`,
            autoSwap: true, // Enable auto-swap for insufficient balance
            wait: true
          })
          
          return `Smart transfer executed! Hash: ${result.hash}\nAuto-swap enabled: ${result.details.autoSwap || false}`
        } catch (e: any) {
          return `Smart transfer failed: ${e.message}`
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
  return NextResponse.json({ ok: false, error: "LLM not configured. Set OPENROUTER_API_KEY or OPENAI_API_KEY, or use simple commands: 'address', 'balance', 'transfer 0.01 to 0x..', 'swap 5 USDC to WETH'." }, { status: 429 })
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
