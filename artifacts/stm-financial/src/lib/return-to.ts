/**
 * "Take me back where I was going" for links opened while logged out — e.g. a
 * Telegram shift alert linking to /shifts?shift=<id>.
 *
 * The destination rides in the login page's own URL (/?next=...) rather than
 * in storage, so the two things that redirect after sign-in (AuthRoute and the
 * login form) read the same value and can't race each other into different
 * pages.
 */
export function loginPathFor(destination: string): string {
  return `/?next=${encodeURIComponent(destination)}`;
}

/** The in-app path from `?next=`, or null. Only same-site paths are accepted, so this can't be used as an open redirect. */
export function nextFromSearch(search: string): string | null {
  const next = new URLSearchParams(search).get("next");
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return null;
  return next;
}
