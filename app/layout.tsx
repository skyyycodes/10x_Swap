// app/layout.tsx
import './globals.css'
import { Inter as FontSans } from 'next/font/google'
import { Fira_Code as FontMono } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { Providers as ExistingProviders } from '@/components/providers'
import { ReduxProvider } from '../components/redux-provider'
import { Header } from "@/components/header";
import { Toaster } from "@/components/ui/toaster";

const fontSans = FontSans({ subsets: ['latin'], variable: '--font-sans' })
const fontMono = FontMono({ subsets: ['latin'], weight: ['400'], variable: '--font-mono' })

export const metadata = {
  title: 'PharosDEX - Cryptocurrency Market Explorer',
  description: 'Explore cryptocurrencies, exchanges, and market data with our responsive crypto platform',
  viewport: 'width=device-width, initial-scale=1',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5" />
      </head>
      <body className={`${fontSans.variable} ${fontMono.variable} font-sans relative scroll-smooth`}>
      <ReduxProvider>
          <ExistingProviders>
            <Header />
            {children}
          </ExistingProviders>
        </ReduxProvider>
        <SpeedInsights />
        <Analytics />
  <Toaster />
      </body>
    </html>
  )
}
