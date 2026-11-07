export type DrawerId = "research" | "risk" | "network" | "system" | "setup" | null;
export type InspectorTab = "signal" | "position" | "activity" | "research";
export type ActivityTab = "positions" | "decisions" | "trades";

const PAIR_KEY = "meridian.selectedPair";
const INSPECTOR_KEY = "meridian.inspectorTab";

export function loadSelectedPair(fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return window.localStorage.getItem(PAIR_KEY) || fallback;
}

export function saveSelectedPair(id: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PAIR_KEY, id);
}

export function loadInspectorTab(): InspectorTab {
  if (typeof window === "undefined") return "signal";
  const value = window.localStorage.getItem(INSPECTOR_KEY);
  if (value === "signal" || value === "position" || value === "activity" || value === "research") return value;
  return "signal";
}

export function saveInspectorTab(tab: InspectorTab): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(INSPECTOR_KEY, tab);
}

/** Command palette entries. Actions are handled by the workstation shell. */
export const COMMANDS = [
  { id: "start", label: "Start trading loop", hint: "Engine", keywords: "run resume" },
  { id: "stop", label: "Stop trading loop", hint: "Engine", keywords: "pause idle" },
  { id: "flatten", label: "Flatten open positions", hint: "Risk", keywords: "close exit" },
  { id: "kill", label: "Kill switch…", hint: "Risk", keywords: "halt emergency" },
  { id: "research", label: "Open research", hint: "Workflow", keywords: "backtest walk-forward" },
  { id: "risk", label: "Open risk & routing", hint: "Config", keywords: "limits gates mode" },
  { id: "network", label: "Open network & wallets", hint: "Config", keywords: "rpc keys" },
  { id: "setup", label: "Open readiness guide", hint: "Setup", keywords: "checklist wallets" },
  { id: "system", label: "Open system & alerts", hint: "Ops", keywords: "alerts assumptions" },
] as const;

export type CommandId = (typeof COMMANDS)[number]["id"];
