import type { Address } from 'viem'

// Minimal Base token registry and helper resolvers.
// Extend safely as we add more supported targets.

export type TokenInfo = {
  symbol: string
  address: Address | 'ETH' // Use 'ETH' sentinel for native
  decimals: number
}

// Common Base mainnet tokens
export const BASE_SYMBOL_TO_TOKEN: Record<string, TokenInfo> = {
  ETH: { symbol: 'ETH', address: 'ETH', decimals: 18 },
  WETH: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18 },
  USDC: { symbol: 'USDC', address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', decimals: 6 },
  // Tether USD (USDT) on Base Sepolia (user-provided)
  USDT: { symbol: 'USDT', address: '0x2d1aDB45Bb1d7D2556c6558aDb76CFD4F9F4ed16', decimals: 6 },
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
