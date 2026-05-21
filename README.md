# CopyGuard

CopyGuard is a Polymarket wallet risk agent for copy-trading decisions. Users enter a Polymarket wallet address, and the app analyzes real public Polymarket activity, positions, trades, and closed positions to decide whether the wallet is safe to copy and how much USDC should be allocated.

## Product Scope

CopyGuard answers a different question than most prediction market agents:

> Do not tell me what market to bet on. Tell me whether this wallet is still worth trusting.

The MVP includes:

- Real Polymarket public data ingestion through a backend adapter.
- Deterministic risk and copy-score metrics.
- Optional DeepSeek-powered AI thesis that explains the deterministic result without replacing it.
- Agent-style wallet profile, decision, allocation plan, and stop-copy triggers.
- A recommendation receipt with a stable hash that can later be recorded on Arc.
- A single dashboard UI for demo and submission.

The MVP intentionally does not include custody, automatic trading, or real order execution.

## Run Locally

```bash
npm run dev
```

Then open:

```txt
http://localhost:3000
```

Use a Polymarket wallet address, linked profile address, `@username`, or profile URL and click **Analyze Wallet**.

## Verify

```bash
npm run verify
```

## Environment

Optional:

```txt
PORT=3000
POLYMARKET_API_BASE=https://data-api.polymarket.com
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
ARC_PAYMENT_REQUIRED=false
ARC_PAYMENT_RECIPIENT=
ARC_PAYMENT_AMOUNT_USDC=0.01
ARC_RPC_URL=https://rpc.testnet.arc.network
ARC_EXPLORER_URL=https://testnet.arcscan.app
```

Create a local `.env` file from `.env.example` to enable the AI thesis panel. `.env` is ignored by git.

DeepSeek is used only as an explanation layer. Copy score, risk score, allocation caps, and receipt hashes remain deterministic and testable.

To enable paid queries, set `ARC_PAYMENT_REQUIRED=true` and set `ARC_PAYMENT_RECIPIENT` to the Arc Testnet wallet that should receive the native USDC payment. The app verifies the transaction on Arc before running `/api/analyze`, and each verified payment transaction can be consumed only once.

## Data Sources

The app uses public Polymarket API surfaces:

- Data API introduction: https://docs.polymarket.com/api-reference/introduction
- Current positions: https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user
- Closed positions: https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user
- Trades and activity endpoints from the same Polymarket API reference.

## Arc Integration Plan

Arc is integrated as a configurable pay-per-analysis gate:

1. The user connects an EVM wallet.
2. The app switches or adds Arc Testnet.
3. The user sends `ARC_PAYMENT_AMOUNT_USDC` native USDC to `ARC_PAYMENT_RECIPIENT`.
4. The backend verifies the transaction through Arc RPC.
5. The verified payment is consumed once when analysis runs.

The remaining receipt flow is still available as the next onchain proof layer:

1. Generate canonical JSON for the agent decision.
2. Hash the receipt.
3. Record the hash and key fields on Arc testnet as a verifiable decision event.
4. Display the Arc transaction hash in the dashboard.

Arc uses USDC as its native gas token. Native transfers and gas accounting use 18-decimal internal values, while wallets should display USDC with 6 decimals.
