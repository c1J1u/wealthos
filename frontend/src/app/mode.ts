export type AppMode = "api" | "demo";

export const APP_MODE: AppMode = parseAppMode(import.meta.env.VITE_WEALTHOS_MODE);

export function parseAppMode(value: string | undefined): AppMode {
  return value === "demo" ? "demo" : "api";
}

export function appModeLabel(mode: AppMode): string {
  return mode === "demo" ? "演示数据" : "真实 API";
}

export const COMMANDS_ENABLED = commandsEnabled(import.meta.env.VITE_WEALTHOS_COMMANDS, APP_MODE);

export function commandsEnabled(value: string | undefined, mode: AppMode): boolean {
  return mode === "api" && value !== "readonly";
}

export function modeStageLabel(commands: boolean): string {
  return commands ? "本地记账" : "只读模式";
}
