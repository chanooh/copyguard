# Implementation Plan

## Goal

Build a complete CopyGuard MVP in this repository:

1. User enters a Polymarket wallet address.
2. Backend fetches real public Polymarket data.
3. Metrics engine computes copy-safety and risk features.
4. Agent layer generates a structured decision and USDC allocation plan.
5. Frontend renders the dashboard and recommendation receipt.

## Architecture

```txt
public dashboard
  -> /api/analyze
  -> PolymarketDataClient
  -> Normalizers
  -> MetricsEngine
  -> RiskAgent
  -> ReceiptHasher
```

## Backend Modules

- `src/server.js`: HTTP server, static files, JSON API routing.
- `src/polymarket/client.js`: fetches real Polymarket data.
- `src/polymarket/normalizers.js`: converts variable API payloads into stable app structures.
- `src/analysis/metrics.js`: deterministic metrics and scoring.
- `src/analysis/agent.js`: structured decision, explanation, allocation, stop triggers.
- `src/analysis/receipt.js`: canonical receipt and stable hash.

## Frontend Modules

- `public/index.html`: dashboard shell.
- `public/styles.css`: responsive dashboard layout.
- `public/app.js`: form handling, API calls, result rendering.

## Delivery Order

1. Docs and test plan.
2. Unit tests for normalizers, metrics, and receipt hashing.
3. Backend data client and analysis modules.
4. API route.
5. Frontend dashboard.
6. End-to-end local verification.
7. Optional Arc receipt follow-up.

## Non-Goals

- No custody.
- No real trading.
- No private-key handling.
- No automatic order placement.
- No dependency on a database for MVP.

