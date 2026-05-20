# Test Plan

## Unit Tests

Use Node's built-in test runner.

### Normalizers

- Handles array payloads and object-wrapped payloads.
- Produces stable numeric values from string or number API fields.
- Keeps unknown fields from breaking analysis.

### Metrics Engine

- Computes portfolio value, PnL, open position count, and closed position count.
- Detects concentration risk from the largest open position.
- Computes win rate from closed positions.
- Applies risk penalties for high concentration, recent losses, and limited sample size.
- Keeps score ranges within `0..100`.

### Agent Layer

- Converts metrics into one of `follow`, `watch`, `reduce`, or `avoid`.
- Produces a USDC allocation plan from portfolio size.
- Generates stop-copy triggers for material risk patterns.

### Receipt Layer

- Produces deterministic hashes for equivalent receipt content.
- Changes hash when decision-critical fields change.

## Manual Verification

1. Start the server with `npm run dev`.
2. Open `http://localhost:3000`.
3. Enter a Polymarket wallet address.
4. Confirm wallet snapshot, positions, decision, allocation plan, and receipt render.
5. Try an invalid address and confirm a helpful error state.
6. Try a wallet with little or no activity and confirm the app does not crash.

