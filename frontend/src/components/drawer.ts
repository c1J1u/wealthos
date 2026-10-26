import { clear, el } from "./dom";
import { dataText } from "../app/locale";

let activeDrawer: (() => void) | undefined;

export interface DrawerHandle {
  body: HTMLElement;
  close: () => void;
  readonly closed: boolean;
  signal: AbortSignal;
  onClose: (listener: () => void) => void;
}

export function openDrawer(options: { title: string; label: string; rawTitle?: boolean }): DrawerHandle {
  // Replacing a detail with another detail/command must release the old
  // dialog's inert state before installing the new one.
  activeDrawer?.();
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = el("div", { className: "drawer-backdrop" });
  const drawer = el("aside", {
    className: "drawer",
    role: "dialog",
    "aria-modal": "true",
    "aria-label": options.label,
  });
  const body = el("div", { className: "drawer__body" });
  const closeButton = el("button", { className: "button", textContent: "关闭" });
  const controller = new AbortController();
  const closeListeners = new Set<() => void>();
  const shell = document.getElementById("app");
  const wasInert = shell?.inert ?? false;
  const backgroundSiblings = shell ? [...document.body.children].filter((node) => node !== shell && !node.classList.contains("drawer") && !node.classList.contains("drawer-backdrop")) : [];
  const siblingInert = backgroundSiblings.map((node) => (node as HTMLElement).inert);
  if (shell) shell.inert = true;
  backgroundSiblings.forEach((node, index) => { (node as HTMLElement).inert = siblingInert[index] ?? true; });
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    for (const listener of closeListeners) listener();
    closeListeners.clear();
    backdrop.remove();
    drawer.remove();
    document.removeEventListener("keydown", onKeydown);
    if (shell) shell.inert = wasInert;
    backgroundSiblings.forEach((node, index) => { (node as HTMLElement).inert = siblingInert[index] ?? false; });
    if (activeDrawer === close) activeDrawer = undefined;
    previousFocus?.focus();
  };
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...drawer.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((node) => !node.hidden && node.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      closeButton.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", onKeydown);
  drawer.append(
    el("header", { className: "drawer__header" }, [
      el("div", { className: "drawer__title" }, [options.rawTitle ? dataText(options.title) : options.title]),
      closeButton,
    ]),
    body,
  );
  document.body.append(backdrop, drawer);
  activeDrawer = close;
  closeButton.focus();
  return { body, close, signal: controller.signal, onClose: (listener) => { closeListeners.add(listener); }, get closed() { return closed; } };
}

export function setDrawerContent(handle: DrawerHandle, content: Node): void {
  if (handle.closed) return;
  clear(handle.body);
  handle.body.append(content);
}
