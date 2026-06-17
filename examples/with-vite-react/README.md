# Evolution SDK - Vite + React Example

A simple React application demonstrating how to use the Evolution SDK with Vite.

## Features

- ⚡️ Vite for fast development and builds
- ⚛️ React 18 with TypeScript
- 🎨 TailwindCSS for styling
- 💼 Cardano wallet integration
- 🔗 Evolution SDK integration

## Prerequisites

- Node.js 18+ and pnpm
- A Cardano wallet browser extension (e.g., Nami, Eternl, Flint)
- A Blockfrost API key (get one free at [blockfrost.io](https://blockfrost.io))

## Getting Started

### 1. Configure Environment Variables

Create a `.env` file in this directory:

```bash
cp .env.example .env
```

Then edit `.env` and configure your network and Blockfrost project ID:

```env
# Choose your network: "preprod", "preview", or "mainnet"
VITE_NETWORK=preprod

# Add your Blockfrost project ID for the selected network
VITE_BLOCKFROST_PROJECT_ID=your_blockfrost_project_id_here
```

**Network Options:**
- `preprod` - Cardano preprod testnet (recommended for development)
- `preview` - Cardano preview testnet (for testing upcoming features)
- `mainnet` - Cardano mainnet (production)

**Important:** Make sure your Blockfrost project ID matches your selected network!

### 2. Install Dependencies

From the root of the Evolution SDK monorepo:

```bash
pnpm install
```

### 3. Build the Evolution SDK

```bash
pnpm --filter @evolution-sdk/evolution run build
```

### 4. Run the Development Server

Navigate to this example directory and start the dev server:

```bash
cd examples/with-vite-react
pnpm dev
```

The app will be available at `http://localhost:5173`

## Project Structure

```
with-vite-react/
├── src/
│   ├── components/
│   │   ├── Main.tsx              # Main container component
│   │   ├── WalletConnect.tsx     # Wallet connection UI
│   │   └── TransactionBuilder.tsx # Transaction building demo
│   ├── App.tsx                    # App component
│   ├── main.tsx                   # Entry point
│   ├── index.css                  # Global styles with Tailwind
│   └── vite-env.d.ts             # Type definitions
├── index.html                     # HTML template
├── vite.config.ts                 # Vite configuration
├── tsconfig.json                  # TypeScript configuration
├── tailwind.config.js             # Tailwind CSS configuration
└── package.json
```

## Usage

1. **Connect Wallet**: Click the "Connect Wallet" button and select your Cardano wallet
2. **View Balance**: Once connected, your wallet address and balance will be displayed
3. **Send ADA**:
   - Enter the recipient's Cardano address
   - Enter the amount in ADA (e.g., 5.0 for 5 ADA)
   - Click "Send ADA"
   - Approve the transaction in your wallet
   - Wait for confirmation and view the transaction hash

## Evolution SDK Integration

The app demonstrates how to use the Evolution SDK for building and submitting transactions:

```typescript
import { client, preprod } from "@evolution-sdk/evolution";

// Create a staged client with provider and CIP-30 wallet access
const sdk = client(preprod)
  .withBlockfrost({
    baseUrl: "https://cardano-preprod.blockfrost.io/api/v0",
    projectId: "your_project_id"
  })
  .withCip30(walletApi);

// Build and submit transaction
const txHash = await sdk
  .newTx()
  .payToAddress({
    address: recipientAddress,
    assets: { lovelace: 5_000_000n }
  })
  .build()
  .then(tx => tx.sign())
  .then(tx => tx.submit());
```

### Key Concepts

- **Client Assembly**: Start with `client(chain)` and add capabilities with `.withX(...)`
- **Wallet Capability**: Connect a CIP-30 wallet with `.withCip30(walletApi)`
- **Provider Capability**: Add Blockfrost, Maestro, Kupmios, or Koios with `.withBlockfrost(...)` and the related methods
- **Transaction Building**: Chain operations like `payToAddress()`, `collectFrom()`, etc.
- **Signing & Submission**: Build → Sign → Submit pipeline

## Development

### Building for Production

```bash
pnpm build
```

The built files will be in the `dist/` directory.

### Preview Production Build

```bash
pnpm preview
```

## Environment Configuration

The app uses environment variables to configure the network:

```env
VITE_NETWORK=preprod          # Network to use
VITE_BLOCKFROST_PROJECT_ID=... # Your Blockfrost API key
```

### Switching Networks

To switch between networks, update your `.env` file:

**For Preprod Testnet (Development):**
```env
VITE_NETWORK=preprod
VITE_BLOCKFROST_PROJECT_ID=preprodXXXXXXXXXXXXXXXX
```

**For Preview Testnet (Testing):**
```env
VITE_NETWORK=preview
VITE_BLOCKFROST_PROJECT_ID=previewXXXXXXXXXXXXXXXX
```

**For Mainnet (Production):**
```env
VITE_NETWORK=mainnet
VITE_BLOCKFROST_PROJECT_ID=mainnetXXXXXXXXXXXXXXXX
```

Restart the dev server after changing the `.env` file.

## Learn More

- [Evolution SDK Documentation](https://github.com/IntersectMBO/evolution-sdk)
- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
- [Cardano Connect with Wallet](https://github.com/cardano-foundation/cardano-connect-with-wallet)
