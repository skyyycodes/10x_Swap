import { NextResponse } from "next/server";
import { getAgent } from "@/lib/agent";
import { resolveTokenBySymbol } from "@/lib/tokens";
import { createPublicClient, http, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalanche } from "viem/chains";
import { AgentkitToolkit } from "@0xgasless/agentkit";

export const runtime = "nodejs";

// GET: optionally accepts ?symbols=ETH,USDC,WBTC,AVAX
export async function GET(req: Request) {
  try {
    const requested = parseSymbolsFromReq(req);
    const symbols = requested.length ? requested : ['ETH', 'USDC', 'WBTC', 'AVAX'];
    const baseSymbols = symbols.filter((s) => s.toUpperCase() !== 'AVAX');

    const { agentkit } = await getAgent();
    const toolkit = new AgentkitToolkit(agentkit as any);
    const tools = toolkit.getTools();
    const find = (name: string) => tools.find((t: any) => (t?.name || '').toLowerCase() === name.toLowerCase());
    const toolResults: Record<string, any> = {};

    // 1) switch_network -> Base (8453)
    try { await find('switch_network')?.invoke({ chainId: 8453 }); toolResults.switchBase = 'ok'; } catch (e: any) { toolResults.switchBase = String(e?.message||e); }
    // 2) get_balance for Base
    try { toolResults.baseBalances = await find('get_balance')?.invoke({ tokenSymbols: baseSymbols }); } catch (e: any) { toolResults.baseBalances = String(e?.message||e); }
    // 3) get_gas_estimate (if available)
    try { toolResults.gas = await find('get_gas_estimate')?.invoke({}); } catch (e: any) { toolResults.gas = String(e?.message||e); }
    // 4) switch_network -> Avalanche (43114)
    const avaxRequested = symbols.some((s) => s.toUpperCase() === 'AVAX');
    if (avaxRequested) {
      try { await find('switch_network')?.invoke({ chainId: 43114 }); toolResults.switchAvax = 'ok'; } catch (e: any) { toolResults.switchAvax = String(e?.message||e); }
    }
    // 5) get_balance for AVAX
    let avaxItem: BalanceItem | null = null;
    try {
      if (avaxRequested) {
        const out = await find('get_balance')?.invoke({ tokenSymbols: ['AVAX'] });
        toolResults.avaxBalances = out;
      }
    } catch (e: any) { toolResults.avaxBalances = String(e?.message||e); }

    // Fallback structured balances from our local logic
    const baseBalances = await getBaseBalances(baseSymbols);
    if (avaxRequested && !toolResults.avaxBalances) {
      avaxItem = await getAvalancheNativeBalance();
    }
    const items = [...baseBalances, ...(avaxItem ? [avaxItem] : [])];
    const addrLine = items.length ? '' : '';
    const lines = [
      'Balances:',
      ...items.map((i) => `${i.network.toUpperCase()} ${i.symbol}: ${i.amount}`),
    ].join('\n');

  return NextResponse.json({ ok: true, balances: lines, items, toolResults });
  } catch (e: any) {
    console.error("Balance GET error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const requested: string[] = Array.isArray(body.tokenSymbols)
      ? body.tokenSymbols.map((s: string) => s.trim()).filter(Boolean)
      : [];
    const symbols = requested.length ? requested : ["ETH", "USDC", "WBTC", "AVAX"];
    const baseSymbols = symbols.filter((s) => s.toUpperCase() !== 'AVAX');

    const baseBalances = await getBaseBalances(baseSymbols);
    const avaxRequested = symbols.some((s) => s.toUpperCase() === 'AVAX');
    const avaxItem = avaxRequested ? await getAvalancheNativeBalance() : null;

    const items = [...baseBalances, ...(avaxItem ? [avaxItem] : [])];
    const lines = [
      'Balances:',
      ...items.map((i) => `${i.network.toUpperCase()} ${i.symbol}: ${i.amount}`),
    ].join('\n');

    return NextResponse.json({ ok: true, balances: lines, items });
  } catch (e: any) {
    console.error("Balance error:", e);
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

type BalanceItem = { symbol: string; amount: string; network: string };

function formatTo4(amount: string): string {
  try {
    if (!amount) return '0';
    let s = amount;
    let sign = '';
    if (s[0] === '-') { sign = '-'; s = s.slice(1); }
    if (!s.includes('.')) return sign + s; // integer-only
    const [intPart, fracRaw] = s.split('.');
    // if already <= 4 decimals, trim trailing zeros
    if (fracRaw.length <= 4) {
      const trimmed = fracRaw.replace(/0+$/, '');
      return sign + (trimmed ? `${intPart}.${trimmed}` : intPart);
    }
    const cut = fracRaw.slice(0, 4);
    const nextDigit = parseInt(fracRaw[4] || '0', 10);
    let fracArr = cut.split('').map((d) => parseInt(d, 10));
    let carry = nextDigit >= 5 ? 1 : 0;
    for (let i = fracArr.length - 1; i >= 0 && carry; i--) {
      const v = fracArr[i] + carry;
      fracArr[i] = v % 10;
      carry = v >= 10 ? 1 : 0;
    }
    // If carry remains, increment integer part
    let intOut = intPart;
    if (carry) {
      const digs = intPart.split('');
      let c = 1;
      for (let j = digs.length - 1; j >= 0 && c; j--) {
        const v = (digs[j].charCodeAt(0) - 48) + c;
        digs[j] = String(v % 10);
        c = v >= 10 ? 1 : 0;
      }
      if (c) digs.unshift('1');
      intOut = digs.join('');
    }
    const fracStr = fracArr.join('').replace(/0+$/, '');
    return sign + (fracStr ? `${intOut}.${fracStr}` : intOut);
  } catch {
    return amount; // fallback
  }
}

async function getBaseBalances(symbols: string[]): Promise<BalanceItem[]> {
  const { getAddress, getBalance } = await getAgent();
  const addr = await getAddress();
  const out: BalanceItem[] = [];
  for (const symRaw of symbols) {
    const sym = symRaw.toUpperCase();
    const token = resolveTokenBySymbol(sym);
    if (!token) {
      continue; // unknown on Base
    }
  const amtRaw = await getBalance(token.address === 'ETH' ? undefined : (token.address as any));
  out.push({ symbol: sym, amount: formatTo4(amtRaw), network: 'base' });
  }
  return out;
}

async function getAvalancheNativeBalance(): Promise<BalanceItem | null> {
  // Read-only AVAX (native) balance using EOA address derived from PRIVATE_KEY
  const pk = process.env.PRIVATE_KEY as string | undefined;
  if (!pk) return null;
  const PRIVATE_KEY = (pk.startsWith('0x') ? pk : `0x${pk}`) as `0x${string}`;
  const account = privateKeyToAccount(PRIVATE_KEY);
  const client = createPublicClient({ chain: avalanche, transport: http('https://api.avax.network/ext/bc/C/rpc') });
  const bal = await client.getBalance({ address: account.address });
  return { symbol: 'AVAX', amount: formatTo4(formatUnits(bal, 18)), network: 'avalanche' };
}

function parseSymbolsFromReq(req: Request): string[] {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get('symbols');
    if (q) return q.split(',').map((s) => s.trim()).filter(Boolean);
  } catch {}
  return [];
}
