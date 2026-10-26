import { el } from "./dom";

export type TableCell = string | Node;

export function dataTable(headers: string[], rows: (TableCell | { content: TableCell; className?: string })[][]): HTMLElement {
  const table = el("table", { className: "data-table" }, [
    el("thead", {}, [el("tr", {}, headers.map((header) => el("th", { scope: "col", textContent: header })))]),
    el("tbody", {}, rows.map((row) => el("tr", {}, row.map((entry, index) => {
      const cell = tableCell(entry);
      cell.dataset.label = headers[index] ?? "值";
      return cell;
    })))),
  ]);
  const viewport = el("div", { className: "table-scroll", role: "region", "aria-label": "数据表格，可横向滚动查看全部列", tabindex: "0" }, [table]);
  const frame = el("div", { className: "table-frame" }, [viewport]);
  queueMicrotask(() => {
    const syncOverflow = () => {
      const overflow = viewport.scrollWidth > viewport.clientWidth + 1;
      frame.toggleAttribute("data-overflow", overflow);
    };
    syncOverflow();
    new ResizeObserver(syncOverflow).observe(viewport);
  });
  return el("div", { className: "table-region" }, [
    frame,
    el("div", { className: "table-scroll-hint", textContent: "左右滑动查看金额与状态" }),
  ]);
}

function tableCell(entry: TableCell | { content: TableCell; className?: string }): HTMLTableCellElement {
  const cell = typeof entry === "object" && entry !== null && "content" in entry ? entry.content : entry;
  if (cell instanceof HTMLTableCellElement) {
    if (cell.childElementCount > 0) {
      const td = el("td", { className: cell.className });
      td.dataset.label = cell.dataset.label;
      td.append(...cell.childNodes);
      return td;
    }
    return cell;
  }
  const td = el("td", typeof entry === "object" && entry !== null && "className" in entry && entry.className ? { className: entry.className } : {});
  if (cell instanceof Node) td.append(cell); else td.textContent = String(cell);
  return td;
}
