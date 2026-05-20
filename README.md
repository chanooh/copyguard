# CopyGuard

CopyGuard is a Polymarket wallet risk agent for copy-trading decisions. Users enter a Polymarket wallet address, and the app analyzes real public Polymarket activity, positions, trades, and closed positions to decide whether the wallet is safe to copy and how much USDC should be allocated.

## Product Scope

CopyGuard answers a different question than most prediction market agents:

> Do not tell me what market to bet on. Tell me whether this wallet is still worth trusting.

The MVP includes:

- Real Polymarket public data ingestion through a backend adapter.
- Deterministic risk and copy-score metrics.
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

Use a Polymarket wallet address and click **Analyze Wallet**.

## Verify

```bash
npm run verify
```

## Environment

Optional:

```txt
PORT=3000
POLYMARKET_API_BASE=https://data-api.polymarket.com
```

## Data Sources

The app uses public Polymarket API surfaces:

- Data API introduction: https://docs.polymarket.com/api-reference/introduction
- Current positions: https://docs.polymarket.com/api-reference/core/get-current-positions-for-a-user
- Closed positions: https://docs.polymarket.com/api-reference/core/get-closed-positions-for-a-user
- Trades and activity endpoints from the same Polymarket API reference.

## Arc Integration Plan

Arc is not required for the core risk analysis. The planned lightweight integration is a recommendation receipt:

1. Generate canonical JSON for the agent decision.
2. Hash the receipt.
3. Record the hash and key fields on Arc testnet as a verifiable decision event.
4. Display the Arc transaction hash in the dashboard.

This keeps the demo focused on wallet intelligence while still giving the project a clean Circle/Arc story.
