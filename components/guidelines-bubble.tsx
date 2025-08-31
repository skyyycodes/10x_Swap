"use client"
import React, { useState } from "react"
import { AnimatePresence, motion } from "framer-motion"
import { BookOpen, X } from "lucide-react"
import { BASE_SYMBOL_TO_TOKEN } from "@/lib/tokens"

export default function GuidelinesBubble() {
  const [open, setOpen] = useState(false)

  const SUPPORTED = ["ETH", "WETH", "USDC", "USDT", "DAI", "WBTC"] as const

  return (
    <div className="relative mx-auto">
      <motion.button
        aria-label="Open guidelines"
        onClick={() => setOpen((v) => !v)}
        className="relative z-40 grid h-9 w-28 place-items-center rounded-full border border-slate-200/70 bg-white/90 text-xs font-medium text-slate-700 shadow-sm backdrop-blur hover:bg-white dark:border-white/10 dark:bg-white/10 dark:text-slate-200"
        whileHover={{ scale: 1.03 }}
        whileTap={{ scale: 0.97 }}
      >
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          <span>Guidelines</span>
        </div>
      </motion.button>

      <AnimatePresence>
        {open && (
          <motion.div
            key="guidelines-panel"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 260, damping: 22 }}
            className="absolute bottom-[calc(100%+0.5rem)] left-1/2 z-50 w-[28rem] -translate-x-1/2 overflow-hidden rounded-2xl border border-slate-200/60 bg-white/95 p-3 text-slate-900 shadow-2xl backdrop-blur-xl dark:border-white/10 dark:bg-[#171717]/95 dark:text-slate-100"
          >
            <div className="flex items-center justify-between border-b border-slate-200/60 pb-2 dark:border-white/10">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <BookOpen className="h-4 w-4 text-blue-500 dark:text-[#F3C623]" />
                Quick guidelines
              </div>
              <button onClick={() => setOpen(false)} className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 grid max-h-[22rem] gap-3 overflow-y-auto pr-1 text-xs">
              <section>
                <div className="mb-1 font-semibold">Supported tokens (Base)</div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                  {SUPPORTED.map((sym) => {
                    const t = BASE_SYMBOL_TO_TOKEN[sym]
                    const addr = t.address === "ETH" ? "native" : t.address
                    return (
                      <li key={sym} className="flex items-center justify-between gap-2">
                        <span className="font-medium">{sym}</span>
                        <span className="truncate text-[11px] text-slate-600 dark:text-slate-300">{addr}</span>
                      </li>
                    )
                  })}
                </ul>
              </section>

              <section>
                <div className="mb-1 font-semibold">Prod vs local (cron/poller)</div>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Prod: Vercel cron triggers serverless poller; logs in app/api/logs.</li>
                  <li>Local: scripts/dev-cron.js + run-poller.js; ensure .env values and DB file exist.</li>
                  <li>If rules don’t fire, check time windows and that the poller is running.</li>
                </ul>
              </section>

              <section>
                <div className="mb-1 font-semibold">Why Execute may not run</div>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Smart account not deployed/initialized yet.</li>
                  <li>Insufficient value or missing token approvals.</li>
                  <li>Paymaster/gasless not available on current chain.</li>
                </ul>
              </section>

              <section>
                <div className="mb-1 font-semibold">API rate limits</div>
                <ul className="list-disc space-y-1 pl-5">
                  <li>Third-party market APIs can throttle.</li>
                  <li>If a coin can’t load, show a friendly notice or retry later.</li>
                </ul>
              </section>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
