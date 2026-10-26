import { el } from "../components/dom";
import { emptyState } from "../components/states";
import { routeWithParams } from "../app/route-state";

export function cashflowBasisUnavailable(): HTMLElement {
  const state = emptyState("请选择现金流账户", "选择账户后按 account_id 请求单账户现金流；未复用合并数字。");
  const button = el("button", { className: "button", textContent: "查看合并现金流" });
  button.addEventListener("click", () => {
    location.hash = routeWithParams(location.hash, { basis: "consolidated" }, ["cursor", "history"]);
  });
  state.append(el("div", { className: "state-actions" }, [button]));
  return state;
}
