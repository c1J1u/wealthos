import type { Account, Category, TransactionPreview } from "@wealthos/api-client";
import { api, queryClient } from "../data/store";
import { el } from "./dom";
import { openDrawer } from "./drawer";
import { dataTable } from "./table";
import { errorState } from "./states";
import { commandDraftErrors, commandErrorMessage, createCommandIntent, parseMoneyCents, requestForPreview, requestForSubmit, type CommandDraft, type CommandIntent } from "../domain/commands";
import { formatMoney, flowEffectLabel, txnTypeLabel } from "../presentation/format";
import { isDate } from "../domain/period";
import { dataText } from "../app/locale";

const TYPES = ["EXPENSE", "INCOME", "TRANSFER", "REFUND", "REIMBURSEMENT", "CREDIT_CARD_PURCHASE", "CREDIT_CARD_REPAYMENT", "LOAN_REPAYMENT"] as const;
const REPAYMENTS = new Set(["LOAN_REPAYMENT", "CREDIT_CARD_REPAYMENT"]);

function field(label: string, input: HTMLElement): HTMLElement {
  return el("label", { className: "command-field" }, [el("span", { textContent: label }), input]);
}

function amount(value: string): number | null {
  return parseMoneyCents(value);
}

function splitAmount(value: string): number | null {
  return parseMoneyCents(value, true);
}

export function openTransactionCommand(accounts: Account[], categories: Category[], today: string, onCommitted: () => Promise<void> | void): void {
  const handle = openDrawer({ title: "记一笔", label: "新增交易 · 预览后提交真实 API" });
  const assetAccounts = accounts.filter((account) => account.normal_side === "ASSET");
  const liabilityAccounts = accounts.filter((account) => account.normal_side === "LIABILITY");
  const type = el("select", { "aria-label": "记账类型", required: true }, TYPES.map((value) => el("option", { value, textContent: txnTypeLabel(value) })));
  const money = el("input", { "aria-label": "记账金额", type: "text", inputmode: "decimal", placeholder: "例如 99.00", required: true });
  const date = el("input", { "aria-label": "交易日期", type: "date", value: today, required: true });
  const source = el("select", { "aria-label": "付款账户", required: true }, [el("option", { value: "", textContent: "选择付款账户" }), ...assetAccounts.map((account) => el("option", { value: account.account_id }, [dataText(account.name)]))]);
  const destination = el("select", { "aria-label": "到账或负债账户" }, [el("option", { value: "", textContent: "选择到账或负债账户" })]);
  const credit = el("select", { "aria-label": "信用卡账户" }, [el("option", { value: "", textContent: "选择信用卡账户" }), ...liabilityAccounts.map((account) => el("option", { value: account.account_id }, [dataText(account.name)]))]);
  const creditField = field("信用卡账户", credit);
  creditField.hidden = true;
  const destinationField = field("到账/负债账户", destination);
  const category = el("select", { "aria-label": "记账分类" }, [el("option", { value: "", textContent: "选择分类" })]);
  const merchant = el("input", { "aria-label": "商户", maxlength: "200", placeholder: "商户或来源" });
  const description = el("textarea", { "aria-label": "备注", maxlength: "500", rows: "3" });
  const principal = el("input", { "aria-label": "偿还本金", type: "text", inputmode: "decimal", value: "0" });
  const interest = el("input", { "aria-label": "偿还利息", type: "text", inputmode: "decimal", value: "0" });
  const fees = el("input", { "aria-label": "偿还费用", type: "text", inputmode: "decimal", value: "0" });
  const repaymentFields = el("div", { className: "command-grid", hidden: true }, [field("本金", principal), field("利息", interest), field("费用", fees)]);
  const previewButton = el("button", { className: "button", type: "button", textContent: "生成分录预览" });
  const submitButton = el("button", { className: "button button--primary", type: "button", textContent: "确认提交真实账本", disabled: true });
  const feedback = el("div", { className: "command-feedback", role: "status", "aria-live": "polite" });
  const preview = el("div");
  const form = el("form", { className: "command-form" }, [
    el("p", { className: "cell-muted", textContent: "先预览服务端分录，不会写入账本。只有确认提交才会调用真实创建命令。" }),
    el("div", { className: "command-grid" }, [field("类型", type), field("金额（CNY）", money), field("交易日期", date)]),
    el("div", { className: "command-grid" }, [field("付款账户", source), destinationField, creditField, field("分类", category)]),
    repaymentFields, field("商户（可选）", merchant), field("备注（可选）", description),
  ]);
  handle.body.append(form, feedback, preview, el("div", { className: "command-actions" }, [previewButton, submitButton]));
  let intent: CommandIntent | undefined;
  let previewFingerprint: string | null = null;
  let operation = 0;
  let submitting = false;
  let committed = false;
  const inputs = [...form.querySelectorAll("input, select, textarea")];
  const lockForm = () => { for (const input of inputs) (input as HTMLInputElement).disabled = submitting || committed; };

  const draft = (): CommandDraft => ({
    transaction_type: type.value as CommandDraft["transaction_type"], amount_cents: amount(money.value) ?? 0,
    transaction_date: date.value, source_account_id: source.value || null,
    destination_account_id: destination.value || null, category_code: category.value || null,
    credit_account_id: credit.value || null,
    merchant_name: merchant.value.trim() || null, description: description.value.trim() || null,
    ...(REPAYMENTS.has(type.value) ? { repayment: {
      principal_cents: splitAmount(principal.value) ?? -1, interest_cents: splitAmount(interest.value) ?? -1, fees_cents: splitAmount(fees.value) ?? -1,
    } } : {}),
  });

  const invalidate = () => {
    syncFields();
    operation += 1;
    intent = undefined;
    previewFingerprint = null;
    preview.replaceChildren();
    feedback.replaceChildren();
    submitButton.disabled = true;
    if (!committed) submitButton.textContent = "确认提交真实账本";
  };

  function syncFields() {
    const value = type.value as CommandDraft["transaction_type"];
    repaymentFields.hidden = !REPAYMENTS.has(value);
    creditField.hidden = value !== "CREDIT_CARD_PURCHASE";
    destinationField.hidden = value === "EXPENSE" || value === "CREDIT_CARD_PURCHASE";
    source.required = value !== "INCOME" && value !== "REFUND" && value !== "CREDIT_CARD_PURCHASE";
    source.parentElement!.hidden = value === "INCOME" || value === "REFUND" || value === "CREDIT_CARD_PURCHASE";
    const destinationAccounts = REPAYMENTS.has(value) ? liabilityAccounts : assetAccounts;
    const previousDestination = destination.value;
    destination.replaceChildren(el("option", { value: "", textContent: REPAYMENTS.has(value) ? "选择负债账户" : "选择到账账户" }), ...destinationAccounts.map((account) => el("option", { value: account.account_id }, [dataText(account.name)])));
    destination.value = destinationAccounts.some((account) => account.account_id === previousDestination) ? previousDestination : "";
    const kind = value === "INCOME" ? "INCOME" : "EXPENSE";
    const categoryRequired = ["EXPENSE", "INCOME", "REFUND", "CREDIT_CARD_PURCHASE"].includes(value);
    category.parentElement!.hidden = !categoryRequired;
    category.required = categoryRequired;
    const previousCategory = category.value;
    category.replaceChildren(el("option", { value: "", textContent: "选择分类" }), ...categories.filter((item) => item.kind === kind).map((item) => el("option", { value: item.category_code }, [dataText(item.name_zh)])));
    category.value = categories.some((item) => item.kind === kind && item.category_code === previousCategory) ? previousCategory : "";
  }
  form.addEventListener("input", invalidate);
  form.addEventListener("change", invalidate);
  form.addEventListener("submit", (event) => { event.preventDefault(); previewButton.click(); });
  syncFields();

  previewButton.addEventListener("click", async () => {
    if (submitting) return;
    const current = draft();
    if (current.amount_cents <= 0 || !isDate(current.transaction_date)) {
      feedback.replaceChildren(errorState({ message: "请填写有效正金额、交易日期和付款账户；金额最多两位小数。" }));
      submitButton.disabled = true;
      return;
    }
    const draftErrors = commandDraftErrors(current, { categories });
    if (draftErrors.length > 0) {
      const messages: Record<string, string> = {
        category: "请选择与交易类型匹配的分类。",
        kind: "支出/信用卡消费/退款只能选择支出分类，收入只能选择收入分类。",
        source: "请选择付款账户。",
        credit: "信用卡消费请选择信用卡账户；不要把它当作现金付款账户。",
        destination: "请选择到账或负债账户。",
        distinct: "转出与到账账户不能相同。",
        repayment: "本金、利息与费用之和必须等于还款总额；零金额分项可填 0。",
      };
      feedback.replaceChildren(errorState({ message: messages[draftErrors[0]!] ?? "请填写有效的金额、日期、账户和分类。" }));
      return;
    }
    const ticket = ++operation;
    previewButton.disabled = true;
    feedback.replaceChildren(el("p", { className: "cell-muted", textContent: "正在生成无副作用预览…" }));
    try {
      const response = await api.previewTransaction(requestForPreview(current), { signal: handle.signal });
      if (ticket !== operation || handle.closed) return;
      const previewData = response.data;
      if (previewData.balanced !== true || previewData.amount_cents !== current.amount_cents
        || previewData.debit_total_cents !== current.amount_cents || previewData.credit_total_cents !== current.amount_cents
        || previewData.debit_total_cents !== previewData.credit_total_cents
        || !Array.isArray(previewData.entries) || previewData.entries.some((entry) => !entry.ledger_account_id || !entry.ledger_account_code || !Number.isSafeInteger(entry.amount_cents))) {
        throw new Error("预览未确认借贷平衡、合计金额或完整分录，已禁止提交。");
      }
      intent = createCommandIntent(current);
      previewFingerprint = intent.fingerprint;
      renderPreview(preview, response.data);
      feedback.replaceChildren(el("p", { className: "cell-muted", textContent: "预览已确认，未写入账本。请核对分录后提交。" }));
      submitButton.disabled = false;
    } catch (error) {
      if (ticket !== operation || handle.closed) return;
      preview.replaceChildren(errorState({ message: commandErrorMessage(error) }));
      submitButton.disabled = true;
    } finally {
      if (!handle.closed) previewButton.disabled = false;
    }
  });

  submitButton.addEventListener("click", async () => {
    const current = draft();
    if (submitting || !intent || previewFingerprint !== createCommandIntent(current, intent).fingerprint) {
      submitButton.disabled = true;
      feedback.replaceChildren(errorState({ message: "表单已变化，请重新生成预览后再提交。" }));
      return;
    }
    submitting = true;
    lockForm();
    previewButton.disabled = true;
    submitButton.disabled = true;
    feedback.replaceChildren(el("p", { className: "cell-muted", textContent: "正在提交，重复点击已锁定…" }));
    try {
      const response = await api.createTransaction(requestForSubmit(current), intent.idempotencyKey, { signal: handle.signal });
      if (handle.closed) return;
      queryClient.clear();
      await onCommitted();
      if (handle.closed) return;
      feedback.replaceChildren(el("p", { className: "command-success", textContent: response.data.replayed ? "服务端已重放首次提交结果，未重复记账。" : `已创建交易 ${response.data.transaction_id}，账本已重新读取。` }));
      submitButton.textContent = "已提交";
      committed = true;
      lockForm();
      previewButton.disabled = true;
    } catch (error) {
      if (handle.closed) return;
      if (!intent || previewFingerprint !== intent.fingerprint) {
        feedback.replaceChildren(errorState({ message: "表单已变化，请重新生成预览；旧提交结果不会被当作新交易。" }));
        return;
      }
      feedback.replaceChildren(errorState({ message: commandErrorMessage(error) }));
      // The unchanged intent retains its key, so a safe retry cannot duplicate.
      submitButton.disabled = false;
      submitButton.textContent = "重试同一提交";
    } finally {
      submitting = false;
      lockForm();
      if (!handle.closed) previewButton.disabled = false;
    }
  });
}

function renderPreview(target: HTMLElement, preview: TransactionPreview): void {
  target.replaceChildren(el("div", { className: "command-preview" }, [
    el("h2", { textContent: "服务端分录预览" }),
    el("p", { className: "cell-muted", textContent: `借 ${formatMoney(preview.debit_total_cents ?? null)} · 贷 ${formatMoney(preview.credit_total_cents ?? null)} · ${preview.balanced ? "已平衡" : "未平衡"} · 占位 ID，未持久化` }),
    dataTable(["#", "方向", "科目", "Flow", "金额"], preview.entries.map((entry) => [
      String(entry.line_no), entry.direction === "DEBIT" ? "借" : "贷", entry.ledger_account_code,
      flowEffectLabel(entry.flow_effect), formatMoney(entry.amount_cents, entry.currency),
    ])),
    ...(preview.warnings?.map((warning) => el("p", { className: "partial-state", textContent: warning })) ?? []),
  ]));
}
