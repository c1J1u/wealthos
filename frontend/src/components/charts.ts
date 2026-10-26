import * as echarts from "echarts/core";
import { BarChart, LineChart, PieChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import { el } from "./dom";
import { dataText } from "../app/locale";

echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

function theme() {
  const styles = getComputedStyle(document.documentElement);
  const token = (name: string) => styles.getPropertyValue(name).trim();
  const accent = token("--accent");
  return {
    accent,
    text: token("--text-secondary"),
    border: token("--border-default"),
    grid: token("--border-subtle"),
    surface: token("--bg-surface"),
    foreground: token("--text-primary"),
    palette: [accent, token("--positive"), token("--warning"), "#38bdf8", "#f472b6", token("--text-tertiary")],
  };
}

function alpha(hex: string, opacity: number): string {
  const match = /^#([\da-f]{6})$/i.exec(hex);
  if (!match) return `rgba(139, 92, 246, ${opacity})`;
  const value = Number.parseInt(match[1]!, 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${opacity})`;
}

interface ChartOptions {
  title?: string;
  description?: string;
  formatY?: (value: number) => string;
  source?: string;
  timeRange?: string;
}

function mount(height: number, opts: ChartOptions, values: { label: string; formatted: string }[], missing = 0): HTMLElement {
  const summaryPrefix = values.length > 0 ? `${values.length} 个有效点${missing > 0 ? `，${missing} 个缺失点（不补 0）` : ""}。` : "暂无可绘制数据。";
  const summaryValues = values.map((value) => `${value.label} · ${value.formatted}`).join("；");
  const summary = `${summaryPrefix}${summaryValues}`;
  const accessible = `${opts.title ?? "财务图表"}。${opts.description ?? "图表数据由服务端提供。"}${summary}`;
  return el("figure", { className: "chart-frame", style: `min-height:${height}px` }, [
    el("div", { className: "chart-canvas", role: "img", "aria-label": accessible }),
    el("figcaption", { className: "chart-caption", textContent: `${opts.description ?? "当前账本服务端只读数据"} 来源：${opts.source ?? "当前账本服务端只读接口"}${opts.timeRange ? ` · 期间：${opts.timeRange}` : ""}` }),
    el("details", { className: "chart-data" }, [
      el("summary", { textContent: "查看图表数据" }),
    el("div", { className: "chart-summary" }, [el("span", { textContent: summaryPrefix }), dataText(summaryValues)]),
    ]),
  ]);
}

function chartAt(node: HTMLElement, option: Record<string, unknown>): void {
  requestAnimationFrame(() => {
    if (!node.isConnected) return;
    const chart = echarts.init(node, undefined, { renderer: "canvas" });
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(node);
    const cleanup = () => {
      observer.disconnect();
      chart.dispose();
      mutations.disconnect();
    };
    node.addEventListener("wealthos:dispose", cleanup, { once: true });
    const mutations = new MutationObserver(() => {
      if (!node.isConnected) cleanup();
    });
    mutations.observe(document.body, { childList: true, subtree: true });
  });
}

function themedChartAt(frame: HTMLElement, option: (colors: ReturnType<typeof theme>) => Record<string, unknown>): void {
  const render = () => {
    const canvas = frame.querySelector(".chart-canvas") as HTMLElement | null;
    if (!canvas) return;
    canvas.dispatchEvent(new Event("wealthos:dispose"));
    canvas.replaceChildren();
    chartAt(canvas, option(theme()));
  };
  (frame as HTMLElement & { __wealthosThemeRender?: () => void }).__wealthosThemeRender = render;
  render();
}

export function createLineChart(points: { x: string; y: number }[], opts: ChartOptions = {}, timeline?: { x: string; y: number | null }[], area = true): HTMLElement {
  const returned = timeline ?? points;
  const node = mount(260, opts, returned.filter((point) => point.y != null).map((point) => ({ label: point.x, formatted: opts.formatY?.(point.y!) ?? String(point.y) })), returned.filter((point) => point.y == null).length);
  if (points.length === 0) {
    node.append(el("div", { className: "chart-fallback", textContent: "暂无序列数据" }));
    return node;
  }
  themedChartAt(node, (colors) => {
    const baseText = { color: colors.text, fontFamily: "SF Mono, ui-monospace, monospace" };
    return {
      animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground, fontSize: 12 },
        valueFormatter: (v: number) => opts.formatY?.(v) ?? String(v),
      },
      xAxis: { type: "category", data: (timeline ?? points).map((p) => p.x), axisLine: { lineStyle: { color: colors.border } }, axisLabel: baseText },
      yAxis: { type: "value", splitLine: { lineStyle: { color: colors.grid } }, axisLabel: baseText },
      series: [{
        type: "line", data: (timeline ?? points).map((p) => p.y), smooth: true, symbol: points.length === 1 ? "circle" : "none", symbolSize: points.length === 1 ? 7 : 0, itemStyle: { color: colors.accent }, connectNulls: false,
        lineStyle: { width: 2, color: colors.accent },
        areaStyle: area ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [
          { offset: 0, color: alpha(colors.accent, 0.22) }, { offset: 1, color: alpha(colors.accent, 0) },
        ] } } : undefined,
      }],
    };
  });
  return node;
}

export function createDonutChart(items: { name: string; value: number }[], opts: ChartOptions = {}): HTMLElement {
  const node = mount(260, opts, items.map((item) => ({ label: item.name, formatted: opts.formatY?.(item.value) ?? `¥${item.value.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}` })));
  const total = items.reduce((s, i) => s + i.value, 0);
  if (total <= 0) {
    node.append(el("div", { className: "chart-fallback", textContent: "暂无构成数据" }));
    return node;
  }
  themedChartAt(node, (colors) => {
    const baseText = { color: colors.text, fontFamily: "SF Mono, ui-monospace, monospace" };
    return {
      animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      color: colors.palette,
      tooltip: { backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground, fontSize: 12 },
        valueFormatter: (v: number) => `¥${v.toLocaleString("zh-CN", { maximumFractionDigits: 0 })}` },
      legend: { bottom: 0, textStyle: baseText, icon: "circle", itemWidth: 8, itemHeight: 8 },
      series: [{
        type: "pie", radius: ["55%", "78%"], center: ["50%", "44%"],
        label: { show: false }, itemStyle: { borderColor: colors.surface, borderWidth: 2 },
        data: items,
      }],
    };
  });
  return node;
}

export function refreshChartsTheme(): void {
  document.querySelectorAll<HTMLElement>(".chart-frame").forEach((frame) => {
    (frame as HTMLElement & { __wealthosThemeRender?: () => void }).__wealthosThemeRender?.();
  });
}

document.addEventListener("wealthos:themechange", refreshChartsTheme);

export function createBarChart(items: { name: string; value: number }[], opts: ChartOptions = {}): HTMLElement {
  const node = mount(260, opts, items.map((item) => ({ label: item.name, formatted: opts.formatY?.(item.value) ?? String(item.value) })));
  if (items.length === 0) {
    node.append(el("div", { className: "chart-fallback", textContent: "暂无数据" }));
    return node;
  }
  themedChartAt(node, (colors) => {
    const baseText = { color: colors.text, fontFamily: "SF Mono, ui-monospace, monospace" };
    return {
      animation: !matchMedia("(prefers-reduced-motion: reduce)").matches,
      grid: { left: 8, right: 8, top: 16, bottom: 4, containLabel: true },
        tooltip: { backgroundColor: colors.surface, borderColor: colors.border, textStyle: { color: colors.foreground, fontSize: 12 },
        valueFormatter: (v: number) => opts.formatY?.(v) ?? String(v) },
      xAxis: { type: "category", data: items.map((i) => i.name), axisLabel: { ...baseText, rotate: 24 }, axisLine: { lineStyle: { color: colors.border } } },
      yAxis: { type: "value", splitLine: { lineStyle: { color: colors.grid } }, axisLabel: baseText },
      series: [{ type: "bar", data: items.map((i) => i.value), itemStyle: { color: colors.accent, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 28 }],
    };
  });
  return node;
}
