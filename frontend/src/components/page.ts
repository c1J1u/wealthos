import { el, clear } from "./dom";
import { errorState, skeleton } from "./states";
import type { QueryError } from "../data/query";

export function panel(title: string, body: Node, flush = false, busy = true, name?: string): HTMLElement {
  return el("section", { className: "panel", "data-panel": name }, [
    el("header", { className: "panel__header" }, [el("div", { className: "panel__title", textContent: title })]),
    el("div", { className: flush ? "panel__body panel__body--flush" : "panel__body", "aria-busy": String(busy) }, [body]),
  ]);
}

export function setPanelBody(target: HTMLElement, body: Node, flush = false): void {
  const element = target.classList.contains("panel") ? target.querySelector(".panel__body") as HTMLElement : target;
  element.classList.toggle("panel__body--flush", flush);
  element.setAttribute("aria-busy", "false");
  clear(element);
  element.append(body);
}

export function setPanelLoading(target: HTMLElement, height = 180): void {
  setPanelBody(target, skeleton(height));
  const element = target.classList.contains("panel") ? target.querySelector(".panel__body") as HTMLElement : target;
  element.setAttribute("aria-busy", "true");
}

export function setPanelError(target: HTMLElement, error: QueryError | undefined, retry?: () => void): void {
  setPanelBody(target, errorState(error ?? { message: "加载失败" }, retry));
}
