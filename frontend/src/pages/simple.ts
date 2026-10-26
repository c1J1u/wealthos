import { deferredState } from "../components/states";
import { pageHeading, type PageContext } from "./flows";

const DEFERRED: Record<string, { name: string; phase: string; note: string }> = {
  liabilities: { name: "负债", phase: "P3", note: "负债账户余额可在「账户」页只读查看；完整的负债管理在 P3 接入。" },
  savings: { name: "储蓄", phase: "P3", note: "定存与储蓄结构将在 P3 接入真实数据。" },
  budgets: { name: "预算", phase: "P3", note: "预算执行将在 P3 接入；总览页对应组件保持空态。" },
  goals: { name: "目标", phase: "P3", note: "目标进度将在 P3 接入。" },
  forecast: { name: "预测", phase: "P4", note: "预测结果依赖 P4 forecast 域；本阶段不显示预测数字。" },
  review: { name: "复盘", phase: "P4", note: "复盘内容将在 P4 接入。" },
  automation: { name: "自动化", phase: "P4/P5", note: "规则、异常与 Agent 审计将在后续阶段接入。" },
};

export function renderDeferred(page: string) {
  return ({ root }: PageContext): void => {
    const d = DEFERRED[page] ?? { name: page, phase: "P3", note: "本阶段尚未接入。" };
    pageHeading(root, d.name, "本阶段尚未接入");
    root.append(deferredState(d.name, d.phase, d.note));
  };
}
