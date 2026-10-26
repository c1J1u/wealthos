import { el } from "./dom";

export function metricDeck(primary: HTMLElement[], supporting: HTMLElement[]): HTMLElement {
  return el("div", { className: "metric-grid metric-deck rise rise-1" }, [
    el("div", { className: "metric-deck__primary", "data-metric-group": "primary" }, primary),
    el("div", { className: "metric-deck__supporting", "data-metric-group": "supporting" }, supporting),
  ]);
}

export function metricDeckFailure(deck: HTMLElement, failure: HTMLElement, supportingFallback?: HTMLElement): void {
  deck.querySelector('[data-metric-group="primary"]')?.replaceChildren(failure);
  if (supportingFallback) deck.querySelector('[data-metric-group="supporting"] > :not([data-kpi])')?.replaceWith(supportingFallback);
}
