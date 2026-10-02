// Content detection, not a URL allowlist. Search every occurrence without printing
// matched tokens or weakening detection to an anchored whole-file expression.
export function containsSlackWebhook(contents) {
  const prefix = "https://hooks.slack.com/services/";
  let from = 0;
  for (;;) {
    const at = contents.indexOf(prefix, from);
    if (at < 0) return false;
    const tail = contents[at + prefix.length] ?? "";
    if (/^[A-Za-z0-9/]$/u.test(tail)) return true;
    from = at + prefix.length;
  }
}
