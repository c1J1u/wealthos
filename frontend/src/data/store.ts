import { ApiClient } from "@wealthos/api-client";
import { QueryClient } from "./query";
import { APP_MODE } from "../app/mode";
import { activeDemoPersona } from "../app/demo-persona";

let csrfToken: string | undefined;
export const pairingRequests = new EventTarget();
export function setCsrfToken(token: string | undefined): void { csrfToken = token; }
export function notifyPairingRequired(): void { pairingRequests.dispatchEvent(new Event("pairing-required")); }

export const api = new ApiClient(APP_MODE === "demo" ? { demoPersona: () => activeDemoPersona() } : { csrfToken: () => csrfToken, onPairingRequired: notifyPairingRequired });
export const queryClient = new QueryClient();
export type { ApiClient };
