import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeClosedPositions,
  normalizePositions,
  normalizeTrades,
  normalizeValue,
  toArray,
  toNumber,
} from "../src/polymarket/normalizers.js";

test("toArray handles direct arrays and common object wrappers", () => {
  assert.deepEqual(toArray([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(toArray({ data: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(toArray({ positions: [{ id: 3 }] }), [{ id: 3 }]);
  assert.deepEqual(toArray(null), []);
});

test("toNumber converts strings and preserves safe fallbacks", () => {
  assert.equal(toNumber("1,234.56"), 1234.56);
  assert.equal(toNumber(42), 42);
  assert.equal(toNumber("not-a-number", 7), 7);
  assert.equal(toNumber(undefined, 9), 9);
});

test("normalizePositions produces stable fields from mixed Polymarket-like payloads", () => {
  const positions = normalizePositions({
    data: [
      {
        asset: "asset-1",
        title: "Will rates fall?",
        outcome: "Yes",
        currentValue: "120.50",
        cashPnl: "18.25",
        realizedPnl: "4",
        size: "200",
        avgPrice: "0.51",
        curPrice: "0.61",
        category: "macro",
      },
    ],
  });

  assert.equal(positions.length, 1);
  assert.equal(positions[0].id, "asset-1");
  assert.equal(positions[0].title, "Will rates fall?");
  assert.equal(positions[0].currentValue, 120.5);
  assert.equal(positions[0].cashPnl, 18.25);
  assert.equal(positions[0].category, "macro");
});

test("normalizeClosedPositions and normalizeTrades keep analysis-safe numerics", () => {
  const closed = normalizeClosedPositions([
    {
      conditionId: "market-1",
      title: "Election market",
      outcome: "No",
      realizedPnl: "-15.5",
      closedAt: "2026-05-10T00:00:00.000Z",
    },
  ]);
  const trades = normalizeTrades({
    trades: [
      {
        id: "trade-1",
        market: "market-1",
        title: "Election market",
        side: "BUY",
        price: "0.45",
        size: "100",
        timestamp: "2026-05-09T12:00:00.000Z",
      },
    ],
  });

  assert.equal(closed[0].realizedPnl, -15.5);
  assert.equal(closed[0].win, false);
  assert.equal(trades[0].side, "buy");
  assert.equal(trades[0].value, 45);
});

test("normalizeValue accepts number, object, and array responses", () => {
  assert.deepEqual(normalizeValue(88), { portfolioValue: 88 });
  assert.deepEqual(normalizeValue({ value: "100.25" }), { portfolioValue: 100.25 });
  assert.deepEqual(normalizeValue([{ value: "55" }]), { portfolioValue: 55 });
});

