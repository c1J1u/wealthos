export function registerOfflineShell(): void {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Offline support is optional; the online shell remains usable without it.
    });
  }, { once: true });
}
