// The operator chooses the test server. Fixture content may choose a route, never
// another origin or a redirect destination for synthetic bodies/authentication.
export function fixtureRequestUrl(baseUrl, route) {
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    throw new Error("Invalid fixture server origin.");
  }
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error("Invalid fixture server origin.");
  if (
    typeof route !== "string" ||
    !route.startsWith("/") ||
    route.startsWith("//") ||
    /[\\\u0000-\u0020\u007f]/u.test(route)
  )
    throw new Error("Fixture route must be a rooted path on the configured server.");
  const url = new URL(route, base);
  if (url.origin !== base.origin || url.username || url.password || url.hash)
    throw new Error("Fixture route escaped the configured server.");
  return url;
}

export function fetchFixture(baseUrl, route, init, transport = fetch) {
  const url = fixtureRequestUrl(baseUrl, route);
  return transport(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
}
