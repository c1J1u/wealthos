import { el } from "../components/dom";
import { dataTable, type TableCell } from "../components/table";
import { skeleton } from "../components/states";
import { dataStateBadgeClass, dataStateLabel } from "../presentation/format";
import { metricPartialBadge } from "../components/metric-state";

export function valueMetricCard(label: string, value: string, state?: string, hint?: string, completeness?: { partial: boolean; missingCount?: number }): HTMLElement {
  return el("div", { className: "metric-card" }, [
    el("div", { className: "metric-card__label", textContent: label }),
    el("div", { className: "metric-card__value", textContent: value }),
    el("div", { className: "metric-card__meta" }, [
      state ? el("span", { className: dataStateBadgeClass(state), textContent: dataStateLabel(state) }) : "",
      metricPartialBadge({ partial: completeness?.partial, missing_count: completeness?.missingCount }),
      hint ? el("span", { textContent: ` ${hint}` }) : "",
    ]),
  ]);
}

export function metricGrid(children: HTMLElement[]): HTMLElement {
  return el("div", { className: "metric-grid rise rise-1", style: "margin-bottom: 1rem" }, children);
}

export function metricSkeletons(count: number): HTMLElement[] {
  return Array.from({ length: count }, () => skeleton(86));
}

export function moneyCell(text: string, muted = false): HTMLElement {
  return el("span", { className: `cell-money${muted ? " cell-muted" : ""}`, textContent: text });
}

export function table(headers: string[], rows: TableCell[][]): HTMLElement {
  return dataTable(headers, rows);
}
