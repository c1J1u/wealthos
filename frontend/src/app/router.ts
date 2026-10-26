export interface Route {
  page: string;
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const page = pathPart || "overview";
  return { page, params: new URLSearchParams(queryPart ?? "") };
}

export function navigate(page: string, params?: URLSearchParams): void {
  const qs = params?.toString();
  location.hash = `#/${page}${qs ? `?${qs}` : ""}`;
}

export function onRouteChange(handler: (route: Route) => void): void {
  window.addEventListener("hashchange", () => handler(parseHash(location.hash)));
}
