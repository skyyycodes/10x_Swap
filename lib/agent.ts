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

    async function getBalance(tokenAddress?: Address): Promise<string> {
      try {
        const addr = await getAddress()
        if (!tokenAddress) {
          const bal = await publicClient.getBalance({ address: addr })
          return formatUnits(bal, 18)
        }
        const decimals = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        }) as unknown as number
        const raw = await publicClient.readContract({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [addr],
        }) as bigint
        return formatUnits(raw, decimals)
      } catch (e: any) {
        throw new Error(`getBalance failed: ${e?.message || e}`)
      }
    }

    async function smartTransfer(opts: { tokenAddress?: Address; amount: string; destination: Address; wait?: boolean }): Promise<{ hash: string }> {
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
          return { hash: tx as string }
        } else {
          // Native ETH transfer via smart account
          const value = parseUnits(amount, 18)
          const tx = await sa.sendTransaction({ to: destination, value })
          if (wait) await publicClient.waitForTransactionReceipt({ hash: tx as `0x${string}` })
          return { hash: tx as string }
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
    async function smartSwap(opts: { tokenInSymbol: string; tokenOutSymbol: string; amount: string; slippage?: number; wait?: boolean }): Promise<{ hash: string }> {
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
        return { hash: txHash as string }
      } catch (e: any) {
        throw new Error(`smartSwap failed: ${e?.message || e}`)
      }
    }

    return {
      agentkit,
      publicClient,
      eoaClient,
      getAddress,
      getBalance,
      checkTransaction,
      readContract,
      smartTransfer,
      smartSwap,
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
  'getBalance',
  'checkTransaction',
  'readContract',
  'smartTransfer',
  'smartSwap',
] as const
