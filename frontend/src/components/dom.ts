import { localizeText, localizeTree } from "../app/locale";

// Minimal DOM helpers — string-free injection safe (text nodes only).
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | boolean | undefined> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    if (key === "className") node.className = String(value);
    else if (key === "textContent") node.textContent = String(value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value as unknown as EventListener);
    else if (value === true) node.setAttribute(key, "");
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  localizeTree(node);
  return node;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export const icons: Record<string, string> = {
  search: "M21 21l-4.35-4.35m2.35-5.15a7.5 7.5 0 11-15 0 7.5 7.5 0 0115 0z",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6L6 18",
  "chevron-left": "m15 18-6-6 6-6",
  "chevron-right": "m9 18 6-6-6-6",
  filter: "M4 5h16l-6 7v6l-4 2v-8Z",
  overview: "M3 12l9-9 9 9M5 10v10h14V10",
  transactions: "M8 7h13M8 12h13M8 17h13M3 7h.01M3 12h.01M3 17h.01",
  accounts: "M3 10h18M3 10l9-7 9 7M5 10v10M19 10v10M9 20v-6h6v6",
  income: "M12 3v18M17 8c0-1.7-2.2-3-5-3s-5 1.3-5 3 2.2 3 5 3 5 1.3 5 3-2.2 3-5 3-5-1.3-5-3",
  expenses: "M20 12V8a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-4zm0 0h-5a2 2 0 000 4h5",
  cashflow: "M3 17l6-6 4 4 8-8M21 7v6h-6",
  assets: "M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z",
  investments: "M3 3v18h18M7 14l4-4 4 3 5-6",
  reports: "M9 17v-6M13 17V7M17 17v-3M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z",
  analytics: "M18 20V10M12 20V4M6 20v-6",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1l2-1.5-2-3.4-2.4 1a7.5 7.5 0 00-1.7-1L14.8 3h-4l-.4 2.6a7.5 7.5 0 00-1.7 1l-2.4-1-2 3.4 2 1.5a7.4 7.4 0 000 2l-2 1.5 2 3.4 2.4-1a7.5 7.5 0 001.7 1l.4 2.6h4l.4-2.6a7.5 7.5 0 001.7-1l2.4 1 2-3.4-2-1.5c.07-.3.1-.7.1-1z",
};

export function icon(name: string, size = 16): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", icons[name] ?? icons.overview ?? "");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("icon");
  svg.append(path);
  return svg;
}
