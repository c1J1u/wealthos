// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { el } from "../components/dom";
import { metricDeck, metricDeckFailure } from "../components/metric-deck";

describe("overview metric deck", () => {
  it("keeps the eight primary metrics separate from the two supporting metrics", () => {
    const primary = Array.from({ length: 8 }, (_, i) => el("a", { className: "metric-card", "data-id": `primary-${i}` }));
    const supporting = [el("div", { className: "metric-card" }), el("a", { className: "metric-card", "data-kpi": "net-cash-flow" })];
    const deck = metricDeck(primary, supporting);
    expect(deck.classList.contains("metric-grid")).toBe(true);
    expect(deck.querySelectorAll('[data-metric-group="primary"] > .metric-card')).toHaveLength(8);
    expect(deck.querySelectorAll('[data-metric-group="supporting"] > .metric-card')).toHaveLength(2);
    expect(deck.querySelectorAll(".metric-card")).toHaveLength(10);
    expect(deck.querySelector('[data-kpi="net-cash-flow"]')).toBe(supporting[1]);
  });

  it("uses the same grouped regions for loading and loaded metrics", () => {
    const skeletons = Array.from({ length: 8 }, () => el("div", { className: "skeleton" }));
    const deck = metricDeck(skeletons, [el("div", { className: "skeleton" }), el("a", { "data-kpi": "net-cash-flow" })]);
    expect(deck.querySelectorAll('[data-metric-group="primary"] > *')).toHaveLength(8);
    expect(deck.querySelectorAll('[data-metric-group="supporting"] > *')).toHaveLength(2);
  });

  it("preserves independent supporting content when primary metrics fail", () => {
    const cashCard = el("a", { "data-kpi": "net-cash-flow" });
    const runway = el("div", { textContent: "Runway N/A" });
    const deck = metricDeck([skeletonForTest()], [skeletonForTest(), cashCard]);
    metricDeckFailure(deck, el("div", { className: "error-state", textContent: "Metrics unavailable" }), runway);
    expect(deck.querySelector('[data-metric-group="primary"]')?.textContent).toBe("Metrics unavailable");
    expect(deck.querySelector('[data-metric-group="supporting"] [data-kpi="net-cash-flow"]')).toBe(cashCard);
    expect(deck.querySelector('[data-metric-group="supporting"] > :first-child')).toBe(runway);
    expect(deck.querySelector('[data-metric-group="primary"] .error-state')).not.toBeNull();
    expect(deck.querySelectorAll(".error-state")).toHaveLength(1);
  });
});

function skeletonForTest(): HTMLElement {
  return el("div", { className: "skeleton" });
}
