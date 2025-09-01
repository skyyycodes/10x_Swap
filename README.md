# 10xSwap: AI-Powered Gasless Crypto Explorer

10xSwap is a modern web application that allows users to explore cryptocurrency markets, manage assets, and execute gasless transactions on the Base network now support Avax-fuji netwrok. It features an AI-powered chat agent that can understand natural language commands to perform actions like checking balances, getting token prices, and executing swaps and transfers.

## How It Works: Project Architecture

The project is built on **Next.js** using the App Router, providing a fast, server-rendered frontend with serverless API endpoints for backend logic.

-   **`app/`**: Contains the main pages (`/`, `/cryptocurrencies`, etc.) and the primary UI layout.
-   **`components/`**: Houses all reusable React components, including the chat interface, data tables, and UI primitives from `shadcn/ui`.
-   **`lib/`**: The core of the backend logic resides here.
    -   `lib/agent.ts`: Configures the 0xGasless Agentkit, defines all blockchain interaction functions (e.g., `getBalance`, `smartSwap`), and sets up the AI agent's tools.
    -   `lib/tokens.ts`: A registry for supported ERC-20 tokens on the Base network.
-   **`app/api/`**: Contains all backend serverless functions. The most important is `/api/agent/chat`, which serves as the brain for the AI chat.

The application runs on the **Base** network (or Base Sepolia for testing), leveraging its low fees and fast transaction times.

## Getting Started

Follow these steps to set up and run the project locally.

### Prerequisites

-   [Node.js](https://nodejs.org/en) (v18 or later)
-   [Bun](https://bun.sh/) (for package management and running scripts)

### 1. Installation

Clone the repository and install the dependencies using Bun:

```bash
git clone <repository-url>
cd 10x_Swap
bun install
```

### 2. Environment Setup

Create a `.env.local` file in the root of the project by copying the example below. This file will store all your secret keys and configuration variables.

**.env.example**

```env
# Server's private key for signing transactions (EOA)
# DO NOT USE A KEY WITH SIGNIFICANT REAL FUNDS
PRIVATE_KEY="YOUR_SERVER_WALLET_PRIVATE_KEY"

# RPC endpoint for the Base network
# Examples: https://mainnet.base.org, or from Infura/Alchemy
RPC_URL="YOUR_BASE_RPC_URL"

# Chain ID: 8453 for Base Mainnet, 84532 for Base Sepolia
CHAIN_ID="8453"

# 0xGasless API Key and Paymaster URL for sponsoring transactions
GASLESS_API_KEY="YOUR_0XGASLESS_API_KEY"
GASLESS_PAYMASTER_URL="YOUR_0XGASLESS_PAYMASTER_URL"

# API key for an LLM provider (choose one)
# Recommended: OpenRouter for model flexibility
OPENROUTER_API_KEY="YOUR_OPENROUTER_API_KEY"
# Or, use OpenAI directly
# OPENAI_API_KEY="YOUR_OPENAI_API_KEY"

# (Optional) API keys for market data providers
COINRANKING_API_KEY="YOUR_COINRANKING_API_KEY"
OX_API_KEY="YOUR_0X_SWAP_API_KEY"
```

### 3. Running the Application

Once your `.env.local` file is configured, you can start the development server:

```bash
bun run dev
```

The application will be available at `http://localhost:3000`.

## API Endpoints

The project's backend is primarily centered around a single, powerful API endpoint that drives the AI chat.

### `POST /api/agent/chat`

This is the main endpoint for all user interactions with the AI agent.

-   **Responsibility**: It receives chat messages, determines user intent, and orchestrates calls to the appropriate backend functions or the AI agent. It supports both a fast, regex-based fallback for simple commands and a full LLM-based agent for complex queries.
-   **File Location**: `app/api/agent/chat/route.ts`

#### Request Body

```json
{
  "messages": [
    { "role": "user", "content": "what's my address?" }
  ],
  "threadId": "optional-session-id",
  "walletAddress": "0x... (optional, from user's connected wallet)"
}
```

#### Response Body

```json
{
  "ok": true,
  "content": "Smart Account (gasless): 0x...",
  "threadId": "session-id"
}
```

### Other API Routes

-   `/api/db/`: Handles database interactions (not fully implemented).
-   `/api/price/`: Could be used for direct price queries (currently handled within the agent).
-   `/api/poller/`, `/api/rules/`, `/api/logs/`: Support for background tasks and internal tooling.

## 0xGasless & AI Agent Implementation

The core of this project is the integration of gasless transactions via **0xGasless Agentkit** and natural language processing with an AI agent.

### 0xGasless Smart Account

We use an ERC-4337 Smart Account to execute transactions on behalf of the user without requiring them to pay for gas directly.

1.  **Initialization**: In `lib/agent.ts`, we configure the `Agentkit` with the server's private key. This key controls the Smart Account. The `GASLESS_PAYMASTER_URL` is used to sponsor the transactions, making them "gasless" for the end-user.

    ```typescript
    // lib/agent.ts
    import { Agentkit } from '@0xgasless/agentkit';

    // ... inside buildAgent()
    const agentkit = await Agentkit.configureWithWallet({
      privateKey: PRIVATE_KEY,
      rpcUrl: RPC_URL,
      apiKey: GASLESS_API_KEY,
      chainID: CHAIN_ID,
      paymasterUrl: GASLESS_PAYMASTER_URL,
    });

    // The smart account is accessed via agentkit.smartAccount
    const smartAccountAddress = await agentkit.smartAccount.getAddress();
    ```

2.  **Executing Transactions**: All on-chain actions like `smartTransfer` and `smartSwap` are executed through the `agentkit.smartAccount` instance. This ensures they are routed through the paymaster for gas sponsorship.

    ```typescript
    // lib/agent.ts
    async function smartTransfer(opts) {
      const sa = agentkit.smartAccount;
      // For native ETH transfer
      const tx = await sa.sendTransaction({ to: destination, value });
      // For ERC20 transfer
      const tx = await sa.writeContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'transfer',
        args: [destination, value],
      });
      return { hash: tx };
    }
    ```

### AI Agent Actions & Triggers

The AI chat understands a variety of commands. For speed and cost-efficiency, simple commands are handled by a regex-based parser in `app/api/agent/chat/route.ts`. More complex requests are passed to a LangChain agent.

Here is a detailed map of triggers and actions:

#### 🔑 Address
- **Triggers**: `address`, `wallet`
- **Action**: Shows the gasless Smart Account, the server's EOA, and the user's connected wallet address (if available).

#### 💰 Balances
- **Triggers**: `balance`, `balances`
- **Default Account**: Smart Account
- **Examples**:
  - `ETH balance` → `ETH: 0.0000 ($0.00)`
  - `USDC balance` → `USDC: 5.0000 ($5.00)`
  - `balance 0x...` → Fetches balance for a specific token contract.
- **Targeting Other Accounts**:
  - `ETH balance connected eoa` → Shows balance for your connected wallet.
  - `USDC balance server eoa` → Shows balance for the server's key.

#### 📊 Prices & Market
- **Triggers**: `price`, `prices`, `market`, `top`, `tokens`
- **Examples**:
  - `price eth`, `price of solana`
  - `market`, `top 10 coins`

#### ⛽ Gas
- **Triggers**: `gas`, `gas price`, `fees`
- **Action**: Shows the current gas and base fee on the Base network.

#### 📂 Portfolio
- **Triggers**: `portfolio`, `overview`, `total value`, `net worth`
- **Default Account**: Smart Account
- **Targeting**: Works just like balances (`portfolio connected eoa`, `portfolio server eoa`).

#### 🔄 Transactions
- **Triggers**: `transactions`, `history`, `recent`, `tx`
- **Action**: Shows a summary of recent transactions from the Smart Account.

#### 💸 Transfer (from Smart Account)
- **Basic**: `transfer 0.01 ETH to 0x...`
- **Priority**: `fast transfer 1 USDC to 0x...` (options: `fast`, `cheap`, `urgent`, `economy`)
- **Smart (Auto-Swap)**: `smart transfer 5 USDC to 0x...` (swaps other assets if balance is too low)
- **Batch**: `batch transfer 1 USDC to 0xA and 0.5 ETH to 0xB`
- **Scheduled**: `schedule transfer 2 USDC to 0x... for tomorrow at 2pm`

#### 🔁 Swap (gasless, from Smart Account)
- **Format**: `swap <amount> <FROM> to <TO>`
- **Example**: `swap 5 USDC to ETH`

#### 🎯 Address Targeting Keywords
Use these keywords in your balance or portfolio queries to specify the address.
- **Connected EOA**: `connected`, `my wallet`, `metamask`, `my eoa`
- **Server EOA**: `server eoa`, `agent key`, `server wallet`
- **Smart Account**: `smart account`, `smart`, `gasless`
- **Plain "eoa"**: Defaults to your connected wallet if available, otherwise falls back to the server EOA.
