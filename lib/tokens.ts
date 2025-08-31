import type { Address } from 'viem'

// Minimal Base token registry and helper resolvers.
// Extend safely as we add more supported targets.

export type TokenInfo = {
  symbol: string
  address: Address | 'ETH' // Use 'ETH' sentinel for native
  decimals: number
  coingeckoId?: string
}

// Common Base mainnet tokens
export const BASE_SYMBOL_TO_TOKEN: Record<string, TokenInfo> = {
  ETH: { symbol: 'ETH', address: 'ETH', decimals: 18 },
  WETH: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  USDC: { symbol: 'USDC', address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', decimals: 6, coingeckoId: 'usd-coin' },
  // Tether USD (USDT) on Base Sepolia (user-provided)
  USDT: { symbol: 'USDT', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 6, coingeckoId: 'tether' },
  DAI: { symbol: 'DAI', address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', decimals: 18, coingeckoId: 'dai' },
  // Wrapped Bitcoin on Base (8 decimals)
  WBTC: { symbol: 'WBTC', address: '0x0555e30da8f98308edb960aa94c0db47230d2b9c', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  // Common typo/alias mapped to WBTC
  WBTS: { symbol: 'WBTC', address: '0x0555e30da8f98308edb960aa94c0db47230d2b9c', decimals: 8, coingeckoId: 'wrapped-bitcoin' },
  // USDbC (old bridged USDC) left out intentionally
}

// Known Coinranking uuids (used by our UI) mapped to Base symbols
// Add more as we curate supported on-Base assets.
export const COINRANKING_UUID_TO_SYMBOL: Record<string, string> = {
  // Ethereum
  razxDUgYGNAdQ: 'ETH',
  // USD Coin
  HIVsRcGKkPFtW: 'USDC',
  // Tether USD
  aKzUVe4Hh_CON: 'USDT',
}

export function resolveTokenBySymbol(symbol?: string): TokenInfo | null {
  if (!symbol) return null
  const key = symbol.toUpperCase()
  return BASE_SYMBOL_TO_TOKEN[key] ?? null
}

export function resolveTokenByCoinrankingId(coinId?: string): TokenInfo | null {
  if (!coinId) return null
  const sym = COINRANKING_UUID_TO_SYMBOL[coinId]
  if (!sym) return null
  return resolveTokenBySymbol(sym)
}
