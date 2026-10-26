import type { ApiClient } from "@wealthos/api-client";
import { el } from "../components/dom";
import { openDrawer, type DrawerHandle } from "../components/drawer";
import { errorState } from "../components/states";
import { normalizeQueryError } from "../data/query";

type PairClient = Pick<ApiClient, "pairSession">;

export class PairingController {
  private token: string | undefined;
  private handle: DrawerHandle | undefined;
  private submitting = false;

  constructor(private readonly api: PairClient, private readonly onPaired: () => Promise<void> | void) {}

  getCsrfToken(): string | undefined { return this.token; }

  request(): void {
    this.token = undefined;
    this.open();
  }

  open(): void {
    if (this.handle && !this.handle.closed) return;
    this.submitting = false;
    const handle = openDrawer({ title: "配对此设备", label: "设备配对" });
    this.handle = handle;
    const input = el("input", {
      "aria-label": "配对码", name: "code", type: "text", inputmode: "numeric",
      autocomplete: "one-time-code", pattern: "[0-9]{8}", maxlength: "8", required: true,
      placeholder: "8 位配对码", "data-pairing-code": "true",
    });
    const feedback = el("div", { className: "command-feedback", role: "status", "aria-live": "polite" });
    const submit = el("button", { className: "button button--primary", type: "submit", textContent: "配对并继续" });
    const form = el("form", { className: "command-form", noValidate: true }, [
      el("p", { className: "cell-muted", textContent: "输入服务端控制台显示的一次性 8 位配对码，5 分钟内有效。配对仅用于建立本地会话，不会创建交易。" }),
      el("label", { className: "command-field" }, [el("span", { textContent: "配对码" }), input]),
      feedback, el("div", { className: "command-actions" }, [submit]),
    ]);
    handle.body.append(form);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.submitting) return;
      feedback.replaceChildren();
      if (!/^\d{8}$/.test(input.value)) {
        feedback.append(el("p", { className: "cell-muted", textContent: "请输入服务端显示的 8 位数字配对码。" }));
        input.focus();
        return;
      }
      void this.submit(input.value, handle, input, submit, feedback);
    });
    handle.onClose(() => {
      this.submitting = false;
      if (this.handle === handle) this.handle = undefined;
    });
    input.focus();
  }

  private async submit(code: string, handle: DrawerHandle, input: HTMLInputElement, button: HTMLButtonElement, feedback: HTMLElement): Promise<void> {
    this.submitting = true;
    input.disabled = true;
    button.disabled = true;
    button.textContent = "正在配对…";
    try {
      const response = await this.api.pairSession(code, { signal: handle.signal });
      if (handle.closed) return;
      if (response.data.paired !== true || !response.data.csrf_token) {
        throw Object.assign(new Error("配对响应缺少确认或 CSRF token。"), { problem: { code: "INVALID_RESPONSE", request_id: response.meta?.request_id } });
      }
      this.token = response.data.csrf_token;
      await this.onPaired();
      handle.close();
    } catch (error) {
      if (handle.closed) return;
      this.token = undefined;
      feedback.replaceChildren(errorState(normalizeQueryError(error)));
    } finally {
      this.submitting = false;
      if (!handle.closed) {
        input.disabled = false;
        button.disabled = false;
        button.textContent = "配对并继续";
      }
    }
  }
}
