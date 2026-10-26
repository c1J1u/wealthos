import { el } from "./dom";

export function emptyState(title: string, hint: string): HTMLElement {
  return el("div", { className: "empty-state", role: "status" }, [
    el("div", { className: "empty-state__title", textContent: title }),
    el("div", { textContent: hint }),
  ]);
}

export function errorState(
  err: { message: string; status?: number; code?: string; requestId?: string },
  onRetry?: () => void,
  actions: { onReconnect?: () => void; onReturn?: () => void } = {},
): HTMLElement {
  const title = err.code === "UNAUTHENTICATED" ? "会话已失效"
    : err.code === "FORBIDDEN" || err.code === "SCOPE_INSUFFICIENT" ? "没有访问权限"
      : err.code === "NOT_FOUND" ? "数据不存在"
          : err.code === "DATABASE_UNAVAILABLE" ? "数据服务暂不可用"
            : err.code === "UNKNOWN_METRIC" || err.code === "UNSUPPORTED_CAPABILITY" ? "暂未提供"
          : err.code === "VALIDATION_FAILED" ? "请求参数有误"
            : err.code === "VERSION_CONFLICT" ? "版本冲突"
            : "加载失败";
  const box = el("div", { className: "error-state", role: "alert" }, [
    el("div", { className: "error-state__title", textContent: title }),
    el("div", { textContent: err.message }),
  ]);
  if (err.code === "VALIDATION_FAILED") box.append(el("div", { className: "cell-muted", textContent: "请修正查询条件或输入后重新请求。" }));
  if (err.code === "UNKNOWN_METRIC" || err.code === "UNSUPPORTED_CAPABILITY") box.append(el("div", { className: "cell-muted", textContent: "服务端尚未提供所选指标或能力；请查看接口能力说明或选择已支持项。" }));
  if (err.code === "VERSION_CONFLICT") box.append(el("div", { className: "cell-muted", textContent: "服务端数据已变化，请重新读取最新状态。" }));
  if (err.code || err.requestId) {
    box.append(el("div", { className: "error-state__code", textContent: `code=${err.code ?? "?"} request_id=${err.requestId ?? "?"}` }));
  }
  if (actions.onReconnect) {
    const btn = el("button", { className: "button", textContent: "重新连接" });
    btn.addEventListener("click", actions.onReconnect);
    box.append(el("div", { className: "mt-4" }, [btn]));
  } else if (err.code === "UNAUTHENTICATED" && onRetry) {
    const btn = el("button", { className: "button", textContent: "重新连接" });
    btn.addEventListener("click", onRetry);
    box.append(el("div", { className: "mt-4" }, [btn]));
  } else if (actions.onReturn) {
    const btn = el("button", { className: "button", textContent: "返回列表" });
    btn.addEventListener("click", actions.onReturn);
    box.append(el("div", { className: "mt-4" }, [btn]));
  } else if (onRetry && err.code !== "UNAUTHENTICATED" && err.code !== "FORBIDDEN" && err.code !== "SCOPE_INSUFFICIENT" && err.code !== "NOT_FOUND" && err.code !== "VALIDATION_FAILED") {
    const btn = el("button", { className: "button", textContent: err.code === "VERSION_CONFLICT" ? "重新读取" : "重试" });
    btn.addEventListener("click", onRetry);
    box.append(el("div", { className: "mt-4" }, [btn]));
  }
  return box;
}

export function partialState(missingCount: number, detail?: string): HTMLElement {
  return el("div", { className: "partial-state", role: "status" }, [
    el("span", { className: "partial-mark", textContent: "≈" }),
    el("span", { textContent: `部分数据${missingCount > 0 ? ` · 缺失 ${missingCount} 项` : ""}${detail ? ` · ${detail}` : ""}` }),
  ]);
}

export function skeleton(height = 120): HTMLElement {
  const s = el("div", { className: "skeleton" });
  s.style.height = `${height}px`;
  return s;
}

export function deferredState(pageName: string, phase: string, note: string): HTMLElement {
  return el("div", { className: "empty-state", role: "status" }, [
    el("div", { className: "empty-state__title", textContent: `${pageName} · 本阶段尚未接入` }),
    el("div", { textContent: note }),
    el("div", { className: "badge badge--neutral", textContent: `计划阶段 ${phase}` }),
  ]);
}
