import { el } from "./dom";

export function disclosure(summary: string, content: Node): HTMLElement {
  return el("details", { className: "disclosure" }, [
    el("summary", { textContent: summary }),
    el("div", { className: "disclosure__body" }, [content]),
  ]);
}
