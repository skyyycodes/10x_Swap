import { Footer } from "@/components/footer"
import { MarketOverview } from "@/components/market-overview"
import { TopCryptocurrencies } from "@/components/top-cryptocurrencies"
import BackgroundPaths from "@/components/animated-background"

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <BackgroundPaths />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <MarketOverview />
        <TopCryptocurrencies />
      </main>
      <Footer />
    </div>
  )
}
