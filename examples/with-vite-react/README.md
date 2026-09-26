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

# Add your Blockfrost project ID for the selected network.
# Server-only: without the VITE_ prefix, Vite never puts it in the browser bundle.
BLOCKFROST_PROJECT_ID=your_blockfrost_project_id_here
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
├── server/
│   ├── payments.ts                # Payment API: builds and submits transactions
│   └── index.ts                   # Production server: the built app plus the API
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

Vite exposes every `VITE_` variable to the browser, so the Blockfrost key stays on the server. The
app follows the split in the Evolution SDK's wallet security guide: the server builds, the browser
signs.

```typescript
// Browser (src/components/TransactionBuilder.tsx): no provider, only the CIP-30 wallet
const client = Client.make(chain).withCip30(walletApi)
const from = Address.toBech32(await client.address())
const { txCbor } = await post("/api/build-payment", { from, to, lovelace })
const witnessSet = await client.signTx(txCbor)
const signedTxCbor = Transaction.addVKeyWitnessesHex(txCbor, TransactionWitnessSet.toCBORHex(witnessSet))
const { txHash } = await post("/api/submit-tx", { signedTxCbor })

// Server (server/payments.ts): the provider, with the key
const tx = await Client.make(chain)
  .withBlockfrost({ baseUrl, projectId: process.env.BLOCKFROST_PROJECT_ID })
  .withAddress(from)
  .newTx()
  .payToAddress({ address: Address.fromBech32(to), assets: Assets.fromLovelace(lovelace) })
  .build()
```

`pnpm dev` serves the API from the Vite dev server. In production, `server/index.ts` serves it with
the built app. The API is public, so add rate limiting or an origin check before deploying it.

## Development

### Building for Production

```bash
pnpm build
pnpm start
```

`pnpm build` puts the app in `dist/` and the server in `dist-server/`. `pnpm start` serves both on
port 3000 (set `PORT` to change it).

## Environment Configuration

The app uses environment variables to configure the network:

```env
VITE_NETWORK=preprod          # Network to use
BLOCKFROST_PROJECT_ID=...     # Your Blockfrost API key (server-only)
```

### Switching Networks

To switch between networks, update your `.env` file:

**For Preprod Testnet (Development):**
```env
VITE_NETWORK=preprod
BLOCKFROST_PROJECT_ID=preprodXXXXXXXXXXXXXXXX
```

**For Preview Testnet (Testing):**
```env
VITE_NETWORK=preview
BLOCKFROST_PROJECT_ID=previewXXXXXXXXXXXXXXXX
```

**For Mainnet (Production):**
```env
VITE_NETWORK=mainnet
BLOCKFROST_PROJECT_ID=mainnetXXXXXXXXXXXXXXXX
```

Restart the dev server after changing the `.env` file.

## Learn More

- [Evolution SDK Documentation](https://github.com/IntersectMBO/evolution-sdk)
- [Vite Documentation](https://vitejs.dev/)
- [React Documentation](https://react.dev/)
- [Cardano Connect with Wallet](https://github.com/cardano-foundation/cardano-connect-with-wallet)
