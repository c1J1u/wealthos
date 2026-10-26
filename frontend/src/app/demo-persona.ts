import { APP_MODE } from "./mode";
import { readPreference, writePreference } from "./preferences";

export type DemoPersona = "chen" | "me";

let selectedDemoPersona: DemoPersona = readDemoPersona();

interface PreferenceStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

export function parseDemoPersona(value: string | null): DemoPersona {
  return value === "me" ? "me" : "chen";
}

export function readDemoPersona(storage?: PreferenceStore, urlValue?: string | null): DemoPersona {
  if (urlValue) return parseDemoPersona(urlValue);
  return parseDemoPersona(storage?.getItem("wealthos.demo.persona") ?? readPreference("wealthos.demo.persona"));
}

export function writeDemoPersona(storage: PreferenceStore | undefined, persona: DemoPersona): void {
  if (storage) storage.setItem("wealthos.demo.persona", persona);
  else writePreference("wealthos.demo.persona", persona);
}

export function selectDemoPersona(urlValue?: string | null): DemoPersona {
  if (APP_MODE === "demo" && urlValue) selectedDemoPersona = parseDemoPersona(urlValue);
  return APP_MODE === "demo" ? selectedDemoPersona : "chen";
}

export function activeDemoPersona(): DemoPersona {
  return APP_MODE === "demo" ? selectedDemoPersona : "chen";
}
