import type { Address } from 'viem'

// Minimal token registry and helpers for Avalanche Fuji (43113), Avalanche mainnet (43114), and Base mainnet (8453).

export type TokenInfo = {
  symbol: string
  address: Address | 'AVAX' | 'ETH' // Use sentinels for native coins
  decimals: number
  coingeckoId?: string
}

// Fuji common tokens (43113)
export const FUJI_SYMBOL_TO_TOKEN: Record<string, TokenInfo> = {
  AVAX: { symbol: 'AVAX', address: 'AVAX', decimals: 18, coingeckoId: 'avalanche-2' },
  WAVAX: { symbol: 'WAVAX', address: '0xd00ae08403B9bbb9124bb305C09058E32C39A48c', decimals: 18, coingeckoId: 'avalanche-2' },
  // USDC.e test token on Fuji (commonly used in docs)
  USDC: { symbol: 'USDC', address: '0x5425890298aed601595a70AB815c96711a31Bc65', decimals: 6, coingeckoId: 'usd-coin' },
}

// Base mainnet common tokens (8453)
export const BASE_SYMBOL_TO_TOKEN: Record<string, TokenInfo> = {
  ETH: { symbol: 'ETH', address: 'ETH', decimals: 18, coingeckoId: 'ethereum' },
  WETH: { symbol: 'WETH', address: '0x4200000000000000000000000000000000000006', decimals: 18, coingeckoId: 'weth' },
  USDC: { symbol: 'USDC', address: '0x833589fCD6EDb6E08f4c7C10d6D3e96cF6a47b8f', decimals: 6, coingeckoId: 'usd-coin' },
}

// Avalanche mainnet common tokens (43114)
export const AVALANCHE_SYMBOL_TO_TOKEN: Record<string, TokenInfo> = {
  AVAX: { symbol: 'AVAX', address: 'AVAX', decimals: 18, coingeckoId: 'avalanche-2' },
  WAVAX: { symbol: 'WAVAX', address: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7', decimals: 18, coingeckoId: 'avalanche-2' },
  USDC: { symbol: 'USDC', address: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', decimals: 6, coingeckoId: 'usd-coin' },
}

export function resolveTokenBySymbol(symbol?: string, chainId?: number): TokenInfo | null {
  if (!symbol) return null
  const key = symbol.toUpperCase()
  if (chainId === 8453) return BASE_SYMBOL_TO_TOKEN[key] ?? null
  if (chainId === 43114) return AVALANCHE_SYMBOL_TO_TOKEN[key] ?? null
  // Default to Fuji if chainId not provided
  return FUJI_SYMBOL_TO_TOKEN[key] ?? null
}

export function resolveTokenByCoinrankingId(coinId?: string): TokenInfo | null {
  // Not used in this build, but keep API stable
  return null
}
