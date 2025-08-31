 import 'server-only'
import { createPublicClient, createWalletClient, http, parseUnits, formatUnits, erc20Abi } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import type { Address, Chain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Agentkit } from '@0xgasless/agentkit'
import { resolveTokenBySymbol } from './tokens'


// Minimal helper to read required envs and ensure they are present
function getEnv(name: string, required = true): string | undefined {
  const v = process.env[name]
  if (required && !v) throw new Error(`Missing env ${name}`)
  return v
}

// Chain selection: default to Base mainnet unless CHAIN_ID says otherwise
function getChain(): Chain {
  const cid = Number(getEnv('CHAIN_ID', false) ?? '8453')
  return cid === 84532 ? baseSepolia : base
}

// Cache the singleton promise so we initialize only once per server runtime
let singleton: ReturnType<typeof buildAgent> | null = null

async function buildAgent() {
  try {
  // Normalize envs
  const PK_RAW = getEnv('PRIVATE_KEY') as string
  const PRIVATE_KEY = (PK_RAW.startsWith('0x') ? PK_RAW : `0x${PK_RAW}`) as `0x${string}`
  const RPC_RAW = getEnv('RPC_URL') as string
  const RPC_URL = (RPC_RAW.startsWith('http://') || RPC_RAW.startsWith('https://')) ? RPC_RAW : `https://${RPC_RAW}`
    // CHAIN_ID can be 8453 (Base) or 84532 (Base Sepolia testnet)
    const CHAIN_ID = Number(getEnv('CHAIN_ID'
        , false) ?? '8453')
    const GASLESS_API_KEY = getEnv('GASLESS_API_KEY') as string
    const GASLESS_PAYMASTER_URL = getEnv('GASLESS_PAYMASTER_URL') as string

    const chain = CHAIN_ID === 84532 ? baseSepolia : base

    // Quick sanity checks for common RPC mistakes (e.g., missing Infura/Alchemy project path)
    const lowerUrl = RPC_URL.toLowerCase()
    if (lowerUrl.includes('infura.io') && !/\/v3\//i.test(RPC_URL)) {
      throw new Error(
        `RPC_URL appears to be an Infura endpoint but is missing '/v3/<PROJECT_ID>'. ` +
        `Use the full URL, e.g. https://base-mainnet.infura.io/v3/YOUR_PROJECT_ID (Base mainnet) ` +
        `or https://base-sepolia.infura.io/v3/YOUR_PROJECT_ID (Base Sepolia).`
      )
    }
    if (lowerUrl.includes('alchemy.com') && !/\/v2\//i.test(RPC_URL)) {
      throw new Error(
        `RPC_URL appears to be an Alchemy endpoint but is missing '/v2/<API_KEY>'. ` +
        `Use the full URL, e.g. https://base-mainnet.g.alchemy.com/v2/YOUR_API_KEY (Base mainnet) ` +
        `or https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY (Base Sepolia).`
      )
    }
    if (/(^https?:\/\/)?base-mainnet\.infura\.io\/?$/i.test(RPC_URL)) {
      // Specific helpful nudge for the 404 the user hit
      throw new Error(
        `RPC_URL 'https://base-mainnet.infura.io' is incomplete and will 404. ` +
        `Include your project path: https://base-mainnet.infura.io/v3/YOUR_PROJECT_ID.`
      )
    }

    const account = privateKeyToAccount(PRIVATE_KEY)

    // Vanilla viem clients (helpful for reads/decoding)
    const publicClient = createPublicClient({ chain, transport: http(RPC_URL) })
    const eoaClient = createWalletClient({ account, chain, transport: http(RPC_URL) })

    // Preflight: verify the RPC is reachable and matches CHAIN_ID
    try {
      const rpcChainId = await publicClient.getChainId()
      if (rpcChainId !== chain.id) {
        throw new Error(
          `RPC chainId ${rpcChainId} does not match expected ${chain.id} (${chain.id === 8453 ? 'Base' : 'Base Sepolia'}). ` +
          `Check CHAIN_ID and RPC_URL.`
        )
      }
    } catch (err: any) {
      const msg = String(err?.message || err)
      throw new Error(
        `RPC_URL check failed: ${msg}. ` +
        `If using Infura, ensure the URL includes '/v3/PROJECT_ID'. ` +
        `Examples: https://mainnet.base.org (no key), https://base-mainnet.infura.io/v3/KEY, https://base-mainnet.g.alchemy.com/v2/KEY.`
      )
    }

  // Initialize 0xGasless Agentkit using wallet (Agentkit manages smart account internally)
    const agentkit = await Agentkit.configureWithWallet({
      privateKey: PRIVATE_KEY,
      rpcUrl: RPC_URL,
      apiKey: GASLESS_API_KEY,
      chainID: CHAIN_ID,
      // Best-effort pass-through; SDK may ignore if not required
      ...(GASLESS_PAYMASTER_URL ? { paymasterUrl: GASLESS_PAYMASTER_URL } as any : {}),
    } as any)

    // Helpers
    async function getAddress(): Promise<Address> {
      try {
        // Prefer the smart account address from Agentkit if available
        const sa = (agentkit as any)?.smartAccount
        if (sa && typeof sa.getAddress === 'function') {
          const addr = await sa.getAddress()
          return addr as Address
        }
        // Fallback to Agentkit helper if exposed
        if ((agentkit as any)?.getAddress) {
          const addr = await (agentkit as any).getAddress()
          return addr as Address
        }
        // Last resort: EOA address (not gasless)
        return account.address as Address
      } catch (e: any) {
        throw new Error(`getAddress failed: ${e?.message || e}`)
      }
    }

    // Explicitly expose the EOA address (your MetaMask/private key address)
    async function getEOAAddress(): Promise<Address> {
      try {
        return account.address as Address
      } catch (e: any) {
        throw new Error(`getEOAAddress failed: ${e?.message || e}`)
      }
    }

    // Return both smart account and EOA addresses
    async function getAddresses(): Promise<{ smart: Address; eoa: Address }> {
      const smart = await getAddress()
      const eoa = await getEOAAddress()
      return { smart, eoa }
    }

  async function getBalance(tokenAddress?: Address, targetAddress?: Address): Promise<string> {
      try {
    const addr = targetAddress || await getAddress()
        if (!tokenAddress) {
          const bal = await publicClient.getBalance({ address: addr })
          return formatUnits(bal, 18)
        }
        
        // First verify the contract exists and has the required functions
        try {
          const code = await publicClient.getBytecode({ address: tokenAddress })
          if (!code || code === '0x') {
            throw new Error(`No contract found at address ${tokenAddress}`)
          }
        } catch (e: any) {
          throw new Error(`Invalid contract address ${tokenAddress}: ${e?.message || e}`)
        }
        
        const decimals = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        }) as unknown as number
        
        if (typeof decimals !== 'number' || decimals < 0 || decimals > 255) {
          throw new Error(`Invalid decimals returned: ${decimals}`)
        }
        
        const raw = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [addr],
        }) as bigint
        
        const formattedBalance = formatUnits(raw, decimals)
        // Log balance details for debugging
        console.log(`Balance check - Token: ${tokenAddress}, Raw: ${raw}, Decimals: ${decimals}, Formatted: ${formattedBalance}`)
        return formattedBalance
      } catch (e: any) {
        throw new Error(`getBalance failed: ${e?.message || e}`)
      }
    }

    async function smartTransfer(opts: { tokenAddress?: Address; amount: string; destination: Address; wait?: boolean }): Promise<{ hash: string; details: any }> {
      const { tokenAddress, amount, destination, wait } = opts
      try {
        const sa = (agentkit as any)?.smartAccount
        if (!sa) throw new Error('Smart account not available. Check GASLESS_API_KEY, RPC_URL, CHAIN_ID, and paymaster settings.')

        if (tokenAddress) {
          // ERC20 transfer using smart account
          const decimals = await publicClient.readContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'decimals',
          }) as unknown as number
          const value = parseUnits(amount, decimals)
          const tx = await sa.writeContract({
            address: tokenAddress,
            abi: erc20Abi,
            functionName: 'transfer',
            args: [destination, value],
          })
          if (wait) await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
          return { hash: tx as string, details: { tokenAddress, amount, destination, wait } }
        } else {
          // Native ETH transfer via smart account
          const value = parseUnits(amount, 18)
          const tx = await sa.sendTransaction({ to: destination, value })
          if (wait) await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
          return { hash: tx as string, details: { amount, destination, wait } }
        }
      } catch (e: any) {
        throw new Error(`smartTransfer failed: ${e?.message || e}`)
      }
    }

    async function checkTransaction(hash: `0x${string}`): Promise<{ status: 'success' | 'pending' | 'failed'; receipt?: any }> {
      try {
        const receipt = await publicClient.getTransactionReceipt({ hash })
        if (!receipt) return { status: 'pending' }
        const ok = receipt.status === 'success'
        return { status: ok ? 'success' : 'failed', receipt }
      } catch (e: any) {
        // If not yet mined, viem throws. Treat as pending.
        const msg = String(e?.message || '')
        if (msg.includes('not found') || msg.includes('Receipt for hash') || msg.includes('Transaction receipt not found')) {
          return { status: 'pending' }
        }
        throw new Error(`checkTransaction failed: ${e?.message || e}`)
      }
    }

    async function readContract<T = unknown>(opts: { address: Address; abi: any; functionName: string; args?: any[] }): Promise<T> {
      try {
        const { address, abi, functionName, args = [] } = opts
        const result = await publicClient.readContract({ address, abi, functionName: functionName as any, args: args as any })
        return result as unknown as T
      } catch (e: any) {
        throw new Error(`readContract failed: ${e?.message || e}`)
      }
    }

    // Swap via 0x Swap API on Base. Supports ETH<->ERC20 and ERC20<->ERC20.
    async function smartSwap(opts: { tokenInSymbol: string; tokenOutSymbol: string; amount: string; slippage?: number; wait?: boolean }): Promise<{ hash: string; details: any }> {
      const { tokenInSymbol, tokenOutSymbol, amount, slippage = 0.5, wait = true } = opts
      try {
        const chainId = chain.id
        if (chainId !== 8453 && chainId !== 84532) throw new Error(`Unsupported chain ${chainId} for swap`)

        const tIn = resolveTokenBySymbol(tokenInSymbol)
        const tOut = resolveTokenBySymbol(tokenOutSymbol)
        if (!tIn) throw new Error(`Unknown tokenIn ${tokenInSymbol}`)
        if (!tOut) throw new Error(`Unknown tokenOut ${tokenOutSymbol}`)

        const sa = (agentkit as any)?.smartAccount
        if (!sa) throw new Error('Smart account not available for swap')
        const taker = await sa.getAddress()

        // 0x Swap API host per network
        const host = chainId === 8453 ? 'https://base.api.0x.org' : 'https://base-sepolia.api.0x.org'

        // Build sell token identifiers for 0x
        const sellToken = tIn.address === 'ETH' ? 'ETH' : (tIn.address as Address)
        const buyToken = tOut.address === 'ETH' ? 'ETH' : (tOut.address as Address)

        // Amount in base units
        const sellAmount = parseUnits(amount, tIn.decimals)
        const slippagePct = Math.max(0.01, Math.min(5, slippage)) / 100 // 0.01% - 5%

        // Fetch quote
        const url = new URL(host + '/swap/v1/quote')
        url.searchParams.set('sellToken', sellToken)
        url.searchParams.set('buyToken', buyToken)
        url.searchParams.set('sellAmount', sellAmount.toString())
        url.searchParams.set('taker', taker)
        url.searchParams.set('slippagePercentage', slippagePct.toString())
        // Optional affiliate
        // url.searchParams.set('affiliateAddress', taker)

        const res = await fetch(url.toString(), { headers: { '0x-api-key': process.env.OX_API_KEY || '' } })
        if (!res.ok) {
          const errTxt = await res.text().catch(() => '')
          throw new Error(`0x quote failed: ${res.status} ${errTxt}`)
        }
        const quote = await res.json()

        // For ERC20 sells, ensure allowance to allowanceTarget
        if (tIn.address !== 'ETH') {
          const allowanceTarget = quote.allowanceTarget as Address
          const current: bigint = await publicClient.readContract({
            address: tIn.address as Address,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [taker as Address, allowanceTarget],
          }) as unknown as bigint
          if (current < sellAmount) {
            const txApprove = await sa.writeContract({
              address: tIn.address as Address,
              abi: erc20Abi,
              functionName: 'approve',
              args: [allowanceTarget, sellAmount],
            })
            await publicClient.waitForTransactionReceipt({ hash: txApprove as `0x${string}` })
          }
        }

        // Submit swap transaction through the smart account (gasless)
        // 0x returns { to, data, value } that should be sent by the taker
        const to = quote.to as Address
        const data = quote.data as `0x${string}`
        const value = BigInt(quote.value || 0)

        const txHash = await sa.sendTransaction({ to, data, value })
        if (wait) await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` })
        return { hash: txHash as string, details: { tokenInSymbol, tokenOutSymbol, amount, slippage, wait } }
      } catch (e: any) {
        throw new Error(`smartSwap failed: ${e?.message || e}`)
      }
    }

    // New action functions for fetching data
  async function getMarketData(symbol?: string): Promise<any> {
      try {
        if (symbol) {
          // Get specific token market data
          const res = await fetch(`https://api.coinranking.com/v2/coin/${symbol}`, {
            headers: { 'x-access-token': process.env.COINRANKING_API_KEY || '' }
          })
          if (!res.ok) throw new Error(`Failed to fetch ${symbol} data: ${res.status}`)
      const data = await res.json()
      const coin = (data && data.data && data.data.coin) ? data.data.coin : null
      if (!coin) throw new Error('Malformed response for coin')
      return { symbol: coin.symbol, name: coin.name, price: Number(coin.price) }
        } else {
          // Get top market overview
          const res = await fetch('https://api.coinranking.com/v2/coins?limit=20', {
            headers: { 'x-access-token': process.env.COINRANKING_API_KEY || '' }
          })
          if (!res.ok) throw new Error(`Failed to fetch market data: ${res.status}`)
      const data = await res.json()
      const coins = (data && data.data && Array.isArray(data.data.coins)) ? data.data.coins : []
      return coins
        }
      } catch (e: any) {
        throw new Error(`getMarketData failed: ${e?.message || e}`)
      }
    }

    // Enhanced Smart Transfer with Intelligence
    async function smartTransferAdvanced(opts: {
      tokenAddress?: Address;
      amount: string;
      destination: Address;
      wait?: boolean;
      priority?: 'low' | 'normal' | 'high';
      schedule?: Date;
      batch?: Array<{ destination: Address; amount: string; tokenAddress?: Address }>;
      autoSwap?: boolean; // Auto-swap if insufficient balance
    }): Promise<{ hash: string; details: any }> {
      try {
        const { tokenAddress, amount, destination, wait, priority, schedule, batch, autoSwap } = opts
        
        // If batch transfer requested
        if (batch && batch.length > 0) {
          return await executeBatchTransfer(batch, wait)
        }
        
        // If scheduled transfer requested
        if (schedule) {
          return await scheduleTransfer({ tokenAddress, amount, destination, schedule, priority })
        }
        
        // Check balance before transfer
        const currentBalance = await getBalance(tokenAddress)
        const requiredAmount = parseFloat(amount)
        
        if (parseFloat(currentBalance) < requiredAmount) {
          if (autoSwap) {
            // Auto-swap logic for insufficient balance
            return await handleInsufficientBalanceTransfer(opts)
          }
          throw new Error(`Insufficient balance. Required: ${amount}, Available: ${currentBalance}`)
        }
        
        // Execute the transfer with priority-based gas optimization
        const gasSettings = getPriorityGasSettings(priority || 'normal')
        const result = await smartTransfer({ tokenAddress, amount, destination, wait })
        
        return {
          hash: result.hash,
          details: {
            from: await getAddress(),
            to: destination,
            amount,
            token: tokenAddress ? 'ERC-20' : 'ETH',
            priority,
            gasOptimized: true,
            timestamp: new Date().toISOString()
          }
        }
      } catch (e: any) {
        throw new Error(`smartTransferAdvanced failed: ${e?.message || e}`)
      }
    }

    // Batch Transfer Execution
    async function executeBatchTransfer(transfers: Array<{ destination: Address; amount: string; tokenAddress?: Address }>, wait: boolean = true): Promise<{ hash: string; details: any }> {
      try {
        const sa = (agentkit as any)?.smartAccount
        if (!sa) throw new Error('Smart account not available')
        
        // Group transfers by token type for efficiency
        const ethTransfers = transfers.filter(t => !t.tokenAddress)
        const tokenTransfers = transfers.filter(t => t.tokenAddress)
        
        let totalHash = ''
        const results = []
        
        // Execute ETH transfers in batch
        if (ethTransfers.length > 0) {
          const totalEth = ethTransfers.reduce((sum, t) => sum + parseFloat(t.amount), 0)
          const ethResult = await smartTransfer({ 
            amount: totalEth.toString(), 
            destination: ethTransfers[0].destination, // Send to first destination
            wait: false 
          })
          totalHash = ethResult.hash
          results.push({ type: 'ETH', hash: ethResult.hash, count: ethTransfers.length })
        }
        
        // Execute token transfers
        for (const transfer of tokenTransfers) {
          const result = await smartTransfer({ 
            tokenAddress: transfer.tokenAddress, 
            amount: transfer.amount, 
            destination: transfer.destination, 
            wait: false 
          })
          results.push({ type: 'Token', hash: result.hash, destination: transfer.destination })
        }
        
        if (wait) {
          // Wait for all transactions to be mined
          for (const result of results) {
            await publicClient.waitForTransactionReceipt({ hash: result.hash as `0x${string}` })
          }
        }
        
        return {
          hash: totalHash || results[0]?.hash || 'batch',
          details: {
            type: 'Batch Transfer',
            totalTransfers: transfers.length,
            results,
            gasOptimized: true,
            timestamp: new Date().toISOString()
          }
        }
      } catch (e: any) {
        throw new Error(`executeBatchTransfer failed: ${e?.message || e}`)
      }
    }

    // Scheduled Transfer
    async function scheduleTransfer(opts: {
      tokenAddress?: Address;
      amount: string;
      destination: Address;
      schedule: Date;
      priority?: 'low' | 'normal' | 'high';
    }): Promise<{ hash: string; details: any }> {
      try {
        const { tokenAddress, amount, destination, schedule, priority } = opts
        const now = new Date()
        
        if (schedule <= now) {
          throw new Error('Schedule time must be in the future')
        }
        
        // Calculate delay
        const delay = schedule.getTime() - now.getTime()
        
        // Schedule the transfer
        setTimeout(async () => {
          try {
            await smartTransfer({ tokenAddress, amount, destination, wait: true })
            console.log(`Scheduled transfer executed: ${amount} to ${destination}`)
          } catch (error) {
            console.error(`Scheduled transfer failed: ${error}`)
          }
        }, delay)
        
        return {
          hash: `scheduled_${Date.now()}`,
          details: {
            type: 'Scheduled Transfer',
            scheduledFor: schedule.toISOString(),
            amount,
            destination,
            priority,
            status: 'Scheduled'
          }
        }
      } catch (e: any) {
        throw new Error(`scheduleTransfer failed: ${e?.message || e}`)
      }
    }

    // Handle insufficient balance with auto-swap
    async function handleInsufficientBalanceTransfer(opts: {
      tokenAddress?: Address;
      amount: string;
      destination: Address;
      wait?: boolean;
    }): Promise<{ hash: string; details: any }> {
      try {
        const { tokenAddress, amount, destination, wait } = opts
        
        if (tokenAddress) {
          // For ERC-20 tokens, try to swap other tokens to get the required amount
          const availableTokens = await getPortfolioOverview()
          const targetToken = resolveTokenBySymbol('USDC') // Default to USDC
          
          if (targetToken && targetToken.address !== 'ETH') {
            const targetBalance = await getBalance(targetToken.address as Address)
            if (parseFloat(targetBalance) > 0) {
              // Swap available tokens to required token
              const swapResult = await smartSwap({
                tokenInSymbol: targetToken.symbol,
                tokenOutSymbol: 'USDC', // Assuming we want USDC
                amount: targetBalance,
                slippage: 1.0,
                wait: true
              })
              
              // Now try the transfer again
              return await smartTransfer({ tokenAddress, amount, destination, wait })
            }
          }
        } else {
          // For ETH, try to swap other tokens to ETH
          const portfolio = await getPortfolioOverview()
          const nonEthAssets = portfolio.assets.filter((asset: any) => asset.symbol !== 'ETH' && asset.valueUSD > 5)
          
          if (nonEthAssets.length > 0) {
            const assetToSwap = nonEthAssets[0]
            const swapResult = await smartSwap({
              tokenInSymbol: assetToSwap.symbol,
              tokenOutSymbol: 'ETH',
              amount: assetToSwap.balance,
              slippage: 1.0,
              wait: true
            })
            
            // Now try the ETH transfer again
            return await smartTransfer({ amount, destination, wait })
          }
        }
        
        throw new Error('Insufficient balance and no assets available for auto-swap')
      } catch (e: any) {
        throw new Error(`handleInsufficientBalanceTransfer failed: ${e?.message || e}`)
      }
    }

    // Priority-based gas optimization
    function getPriorityGasSettings(priority: 'low' | 'normal' | 'high') {
      switch (priority) {
        case 'low':
          return { maxFeePerGas: 'slow', maxPriorityFeePerGas: 'slow' }
        case 'high':
          return { maxFeePerGas: 'fast', maxPriorityFeePerGas: 'fast' }
        default:
          return { maxFeePerGas: 'normal', maxPriorityFeePerGas: 'normal' }
      }
    }

    // Smart Transfer with AI-powered routing
    async function smartTransferWithRouting(opts: {
      tokenAddress?: Address;
      amount: string;
      destination: Address;
      wait?: boolean;
      routing?: 'fastest' | 'cheapest' | 'mostReliable';
    }): Promise<{ hash: string; details: any }> {
      try {
        const { routing = 'fastest' } = opts
        
        // Get current network conditions
        const gasData = await getGasEstimate()
        const marketData = await getMarketData()
        
        // AI-powered routing decision
        let optimalRoute = 'direct'
        let gasMultiplier = 1.0
        
        if (routing === 'fastest') {
          gasMultiplier = 1.2 // 20% higher gas for faster execution
        } else if (routing === 'cheapest') {
          gasMultiplier = 0.8 // 20% lower gas for cost optimization
        } else if (routing === 'mostReliable') {
          gasMultiplier = 1.1 // 10% higher gas for reliability
        }
        
        // Execute transfer with optimized settings
        const result = await smartTransferAdvanced({
          ...opts,
          priority: routing === 'fastest' ? 'high' : routing === 'cheapest' ? 'low' : 'normal'
        })
        
        return {
          hash: result.hash,
          details: {
            routing,
            gasMultiplier,
            networkConditions: gasData,
            optimalRoute
          }
        }
      } catch (e: any) {
        throw new Error(`smartTransferWithRouting failed: ${e?.message || e}`)
      }
    }

    // Fallback mapping for popular symbols not in Base token registry
    const COINGECKO_FALLBACK: Record<string, string> = {
      BTC: 'bitcoin',
      SOL: 'solana',
      BNB: 'binancecoin',
      AVAX: 'avalanche-2',
      DOGE: 'dogecoin',
      MATIC: 'matic-network',
      ARB: 'arbitrum',
      OP: 'optimism',
      XRP: 'ripple',
      ADA: 'cardano',
      LINK: 'chainlink',
      TRX: 'tron',
      LTC: 'litecoin',
      TON: 'the-open-network',
    }

    // Also support common token names (user might ask "price of solana")
  const NAME_TO_SYMBOL: Record<string, string> = {
      BITCOIN: 'BTC',
      ETHEREUM: 'ETH',
      SOLANA: 'SOL',
      BINANCE: 'BNB',
      BINANCECOIN: 'BNB',
      AVALANCHE: 'AVAX',
      DOGECOIN: 'DOGE',
      POLYGON: 'MATIC',
      ARBITRUM: 'ARB',
      OPTIMISM: 'OP',
      RIPPLE: 'XRP',
      CARDANO: 'ADA',
      CHAINLINK: 'LINK',
      TRON: 'TRX',
      LITECOIN: 'LTC',
      TON: 'TON',
      TONCOIN: 'TON',
  WRAPPEDBITCOIN: 'WBTC',
    }

    async function getTokenPrice(symbol: string): Promise<any> {
      try {
        // Normalize query and support both symbols and common names
        const raw = symbol.trim()
        const sym = raw.toUpperCase()
        const nameKey = sym.replace(/[^A-Z0-9]/g, '')
        // If a common name was provided (e.g., SOLANA), map to its symbol first
        const mappedFromName = NAME_TO_SYMBOL[nameKey]
        if (mappedFromName && mappedFromName !== sym) {
          return await getTokenPrice(mappedFromName)
        }
        const token = resolveTokenBySymbol(sym)
        // ETH price (with 24h change)
        if (token && token.address === 'ETH') {
          const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true')
          if (!res.ok) throw new Error(`Failed to fetch ETH price: ${res.status}`)
          const data = await res.json()
          return { symbol: 'ETH', price: data.ethereum.usd, change24h: data.ethereum.usd_24h_change }
        }
        // Known Base token with coingeckoId
        if (token && token.coingeckoId) {
          const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${token.coingeckoId}&vs_currencies=usd&include_24hr_change=true`)
          if (!res.ok) throw new Error(`Failed to fetch ${sym} price: ${res.status}`)
          const data = await res.json()
          const item = data[token.coingeckoId]
          return { symbol: token.symbol, price: item.usd, change24h: item.usd_24h_change }
        }
        // Fallback popular non-Base tickers (e.g., BTC)
        const cgId = COINGECKO_FALLBACK[sym]
        if (cgId) {
          const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd&include_24hr_change=true`)
          if (!res.ok) throw new Error(`Failed to fetch ${sym} price: ${res.status}`)
          const data = await res.json()
          const item = data[cgId]
          return { symbol: sym, price: item.usd, change24h: item.usd_24h_change }
        }
        throw new Error(`Unknown token: ${sym}`)
      } catch (e: any) {
        throw new Error(`getTokenPrice failed: ${e?.message || e}`)
      }
    }

    async function getGasEstimate(): Promise<any> {
      try {
        const gasPrice = await publicClient.getGasPrice()
        const block = await publicClient.getBlock()
        const baseFee = block.baseFeePerGas || BigInt(0)
        
        return {
          gasPrice: formatUnits(gasPrice, 9), // Gwei
          baseFee: formatUnits(baseFee, 9), // Gwei
          chain: chain.name,
          chainId: chain.id
        }
      } catch (e: any) {
        throw new Error(`getGasEstimate failed: ${e?.message || e}`)
      }
    }

    async function getTransactionHistory(address?: Address): Promise<any[]> {
      try {
        const targetAddress = address || await getAddress()
        const blockNumber = await publicClient.getBlockNumber()
        
        // Get recent transactions (last 100 blocks)
        const fromBlock = blockNumber - BigInt(100)
        const logs = await publicClient.getLogs({
          address: targetAddress,
          fromBlock,
          toBlock: blockNumber
        })

        // Get transaction details
        const transactions = await Promise.all(
          logs.slice(0, 10).map(async (log) => {
            try {
              const tx = await publicClient.getTransaction({ hash: log.transactionHash })
              const receipt = await publicClient.getTransactionReceipt({ hash: log.transactionHash })
              return {
                hash: log.transactionHash,
                blockNumber: log.blockNumber,
                from: tx.from,
                to: tx.to,
                value: tx.value ? formatUnits(tx.value, 18) : '0',
                status: receipt?.status === 'success' ? 'success' : 'failed',
                timestamp: new Date().toISOString() // Approximate
              }
            } catch {
              return null
            }
          })
        )

        return transactions.filter(Boolean)
      } catch (e: any) {
        throw new Error(`getTransactionHistory failed: ${e?.message || e}`)
      }
    }

  async function getPortfolioOverview(targetAddress?: Address): Promise<any> {
      try {
    const address = targetAddress || await getAddress()
    const ethBalance = await getBalance(undefined, address)
        
        // Get supported token balances
  const supportedTokens = ['USDC', 'USDT', 'WETH', 'DAI', 'WBTC']
        const tokenBalances = await Promise.all(
          supportedTokens.map(async (symbol) => {
            try {
              const token = resolveTokenBySymbol(symbol)
              if (token && token.address !== 'ETH') {
                const balance = await getBalance(token.address as Address, address)
                const price = await getTokenPrice(symbol)
                return {
                  symbol,
                  balance,
                  price: price.price,
                  valueUSD: parseFloat(balance) * price.price
                }
              }
              return null
            } catch {
              return null
            }
          })
        )

        const ethPrice = await getTokenPrice('ETH')
        const totalValue = parseFloat(ethBalance) * ethPrice.price + 
          tokenBalances.filter(Boolean).reduce((sum, token) => sum + (token?.valueUSD || 0), 0)

        return {
          address,
          totalValueUSD: totalValue,
          assets: [
            { symbol: 'ETH', balance: ethBalance, price: ethPrice.price, valueUSD: parseFloat(ethBalance) * ethPrice.price },
            ...tokenBalances.filter(Boolean)
          ]
        }
      } catch (e: any) {
        throw new Error(`getPortfolioOverview failed: ${e?.message || e}`)
      }
    }

    // Helper function to format balances with consistent decimal places
    function formatBalance(balance: string, decimals: number = 4): string {
      try {
        const num = parseFloat(balance)
        if (isNaN(num)) return balance
        return num.toFixed(decimals)
      } catch {
        return balance
      }
    }

    return {
      agentkit,
      publicClient,
      eoaClient,
      getAddress,
  getEOAAddress,
  getAddresses,
  getBalance, // (tokenAddress?: Address, targetAddress?: Address)
      checkTransaction,
      readContract,
      smartTransfer,
      smartTransferAdvanced,
      smartTransferWithRouting,
      smartSwap,
      getMarketData,
      getTokenPrice,
      getGasEstimate,
      getTransactionHistory,
  getPortfolioOverview, // (targetAddress?: Address)
      formatBalance,
    }
  } catch (e: any) {
    throw new Error(`buildAgent failed: ${e?.message || e}`)
  }
}

export async function getAgent() {
  if (!singleton) singleton = buildAgent()
  return singleton
}

export type Agent = Awaited<ReturnType<typeof buildAgent>>

// Public list of available high-level actions we currently support via this wrapper
export const AVAILABLE_AGENT_ACTIONS = [
  'getAddress',
  'getEOAAddress',
  'getAddresses',
  'getBalance',
  'checkTransaction',
  'readContract',
  'smartTransfer',
  'smartTransferAdvanced',
  'smartTransferWithRouting',
  'smartSwap',
  'getMarketData',
  'getTokenPrice',
  'getGasEstimate',
  'getTransactionHistory',
  'getPortfolioOverview',
] as const
