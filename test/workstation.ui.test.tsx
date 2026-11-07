/** @vitest-environment jsdom */
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PairRail } from "../src/components/workstation/pair-rail";
import { StatusRail } from "../src/components/workstation/status-rail";
import { gateLabel } from "../src/lib/readiness";
import type { Snapshot } from "../src/lib/types";

const snapshot: Snapshot = {
  now: Date.now(),
  banner: "mode: PAPER",
  engine: {
    running: false,
    mode: "paper",
    modeSource: "default",
    kill: { engaged: false, reason: null, source: null },
    loopIntervalMs: 60_000,
    iteration: 0,
    lastLoopAt: null,
    lastError: null,
    liveBlocked: [],
    paperEquity: 10_000,
    dayPnl: 0,
    drawdownPct: 0,
    reconciled: ["paper mode uses the ledger"],
  },
  settings: {
    mode: "paper",
    modeSource: "default",
    loopIntervalMs: 60_000,
    paperStartingEquity: 10_000,
    risk: {
      riskPerTradePct: 0.75,
      maxPositionPct: 10,
      maxConcurrentPositions: 4,
      maxChainExposurePct: 40,
      maxTokenExposurePct: 15,
      dailyDrawdownKillPct: 3,
      totalDrawdownKillPct: 10,
      maxSlippageBps: 50,
      maxPriceImpactBps: 100,
      maxGasEdgePct: 25,
      conservativeWinRate: 0.45,
      circuitBarMovePct: 15,
      staleDataMinutes: 120,
      quoteDivergencePct: 5,
      emergencyExitSlippageBps: 150,
    },
    gates: {
      minExpectancyUsd: 0,
      minProfitFactor: 1.3,
      maxDrawdownPct: 15,
      minTrades: 30,
      minWalkForwardWindows: 4,
      minProfitableWindowFraction: 0.55,
      minStableGridFraction: 0.67,
      paperMinTrades: 10,
      paperMinProfitFactor: 1.1,
      paperMaxDrawdownPct: 15,
    },
    strategy: { enabled: { trend: true, breakout: true, mean_reversion: true } },
    chains: {},
    pairs: {},
    overrideGates: false,
    alertWebhookSource: "none",
  },
  assumptions: ["Signals use closed 1h bars only."],
  chains: [],
  pairs: [
    {
      id: "sol-usdc",
      label: "SOL/USDC",
      chain: "solana",
      enabled: true,
      dex: "jupiter",
      feeBps: 5,
      shortMode: "hyperliquid-perp",
      perpCoin: "SOL",
      price: 96.3,
      regime: "trend",
      indicators: { adx: 28, rsi: 55, emaFast: 95, emaSlow: 90, atr: 1.2 },
      lastSignal: "trend regime, no EMA pullback",
      eligibility: "backtest_pass_pending_paper",
    },
    {
      id: "ray-usdc",
      label: "RAY/USDC",
      chain: "solana",
      enabled: true,
      dex: "jupiter",
      feeBps: 25,
      shortMode: "spot-flat",
      perpCoin: null,
      price: 1.7,
      regime: "trend",
      indicators: { adx: 40, rsi: 60, emaFast: 1.6, emaSlow: 1.5, atr: 0.05 },
      lastSignal: "waiting",
      eligibility: "fail",
    },
  ],
  positions: [],
  trades: [],
  decisions: [],
  equity: [],
  alerts: [],
  backtest: { id: "bt_1", createdAt: Date.now(), status: "done", error: null },
  researchRunning: false,
};

const deskState = {
  snap: snapshot,
  phase: "ready" as const,
  offline: false,
  error: null,
  feedback: null,
  busy: null,
  selectedPairId: "sol-usdc",
  setSelectedPairId: vi.fn(),
  inspectorTab: "signal" as const,
  setInspectorTab: vi.fn(),
  drawer: null,
  openDrawer: vi.fn(),
  call: vi.fn(),
  refresh: vi.fn(),
  run: vi.fn(async () => true),
  setFeedback: vi.fn(),
};

vi.mock("../src/components/desk", () => ({
  useDesk: () => deskState,
}));

describe("workstation rails", () => {
  beforeEach(() => {
    deskState.selectedPairId = "sol-usdc";
    deskState.run.mockClear();
    deskState.setSelectedPairId.mockClear();
    deskState.openDrawer.mockClear();
  });
  afterEach(() => cleanup());

  it("shows engine controls and opens readiness without inventing PnL", async () => {
    const user = userEvent.setup();
    render(<StatusRail />);
    expect(screen.getByText(/Stopped/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Readiness" }));
    expect(deskState.openDrawer).toHaveBeenCalledWith("setup");
    await user.click(screen.getByRole("button", { name: "Start" }));
    await waitFor(() => expect(deskState.run).toHaveBeenCalled());
    expect(deskState.run.mock.calls[0]?.[1]).toBe("/api/engine/start");
  });

  it("selects a pair from the rail and surfaces the real gate label", async () => {
    const user = userEvent.setup();
    render(<PairRail />);
    expect(screen.getByText(gateLabel("backtest_pass_pending_paper"))).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /RAY\/USDC/ }));
    expect(deskState.setSelectedPairId).toHaveBeenCalledWith("ray-usdc");
  });
});
