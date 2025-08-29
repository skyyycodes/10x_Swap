import { Footer } from "@/components/footer"
import { CryptocurrenciesList } from "@/components/cryptocurrencies-list"
import BackgroundPaths from "@/components/animated-background"

export default function CryptocurrenciesPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <BackgroundPaths />
      <main className="flex-1 container mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        <h1 className="text-3xl sm:text-4xl font-bold mb-6 sm:mb-8">Cryptocurrencies</h1>
        <CryptocurrenciesList />
      </main>
      <Footer />
    </div>
  )
}
