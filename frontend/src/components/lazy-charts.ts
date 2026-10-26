type Charts = typeof import("./charts");
type Options = Parameters<Charts["createLineChart"]>[1];

let chartModule: Promise<Charts> | null = null;

function loadCharts(): Promise<Charts> {
  chartModule ??= import("./charts");
  return chartModule;
}

export async function lineChart(points: Parameters<Charts["createLineChart"]>[0], options?: Options, timeline?: Parameters<Charts["createLineChart"]>[2], area?: boolean) {
  return (await loadCharts()).createLineChart(points, options, timeline, area);
}

export async function barChart(points: Parameters<Charts["createBarChart"]>[0], options?: Options) {
  return (await loadCharts()).createBarChart(points, options);
}

export async function donutChart(points: Parameters<Charts["createDonutChart"]>[0], options?: Options) {
  return (await loadCharts()).createDonutChart(points, options);
}
