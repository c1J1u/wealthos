// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { afterEach } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); });
import { compositionErrors, regularityRows, stabilityRows, transactionSummaryRows, viewPeriodErrors } from "../domain/view-models";
import { transactionSummaryView } from "../components/view-read-models";

describe("view read-model mappers", () => {
  it("accepts only bounded composition values", () => {
    expect(compositionErrors([{ label: "现金", amount_cents: 100, share: 1, data_state: "ACTUAL" }])).toEqual([]);
    expect(compositionErrors([{ label: "现金", amount_cents: 1.5, share: 2, data_state: "ACTUAL" }])).toContain("金额/占比");
    expect(compositionErrors(undefined)).toContain("未提供");
  });

  it("maps server income stability and expense regularity without recalculation", () => {
    expect(stabilityRows({ recurring_income_cents: 100, one_off_income_cents: 20, source_count: 2, top_source_label: "工资", top_source_amount_cents: 100, top_source_share: 0.5 }).map(([label]) => label)).toEqual(["经常性收入", "一次性收入", "来源数", "最大来源", "最大来源金额", "最大来源占比"]);
    expect(regularityRows({ fixed_expense_cents: 100, variable_expense_cents: 80, reimbursable_expense_cents: 50, reimbursement_received_cents: 20 }).map(([label]) => label)).toEqual(["固定支出", "变动支出", "可报销支出", "已收到报销"]);
    expect(transactionSummaryRows({ count: 4, inflow_cents: 500, outflow_cents: 200 }).map(([label]) => label)).toEqual(["流水笔数", "流入", "流出"]);
  });

  it("rejects a view from another period and describes unfiltered summary as all-book", () => {
    expect(viewPeriodErrors("2025-06", "2025-04")).toContain("期间");
    expect(viewPeriodErrors("2025-04", "2025-04")).toEqual([]);
    expect(viewPeriodErrors("2025-04", undefined)).toContain("期间");
  });

  it("shows reconciliation and data-state scope returned by the server", () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const view = transactionSummaryView({ count: 10, inflow_cents: 0, outflow_cents: 0, scope: {
      reconciliation: "UNRECONCILED", data_state: "ESTIMATE",
    } });
    expect(view.textContent).toContain("对账 UNRECONCILED");
    expect(view.textContent).toContain("数据态 ESTIMATE");
  });
});
