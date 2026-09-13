/// The one way this app talks to the node.
///
/// Relative URLs, always. The front end and the API are one origin in
/// production and the dev server proxies to reproduce that (see
/// `vite.config.ts`); a client that knew an absolute base would be a client
/// that works in development and drops its `SameSite=Strict` session cookie in
/// production — where the login appears to succeed and immediately fail.

/// What the server says went wrong, as RFC 7807 gives it.
///
/// Carried as a class rather than a string so a screen can tell a 409 from a
/// 500 without parsing prose. `detail` is written for a person and is what a
/// screen should show; `title` is the category and is what a log wants.
export class ApiError extends Error {
  // Written out rather than declared as constructor parameters: this project
  // compiles with `erasableSyntaxOnly`, which forbids the shorthand because it
  // emits code rather than only erasing types.
  readonly status: number
  readonly title: string
  readonly detail: string

  constructor(status: number, title: string, detail: string) {
    super(detail || title)
    this.name = "ApiError"
    this.status = status
    this.title = title
    this.detail = detail
  }
}

/// Headers a WRITE may carry beyond the content type.
///
/// Only writes take them, and in this app only two names are ever sent:
/// `Idempotency-Key`, so a retried request is replayed rather than applied
/// twice, and `If-Match`, so a write against a record somebody else has already
/// moved past is refused instead of silently winning. See `lib/mutate.ts` for
/// where both come from and why a screen never spells them itself.
export type Headers_ = Readonly<Record<string, string>>

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
  headers?: Headers_,
): Promise<T> {
  const response = await fetch(path, {
    method,
    // The session is a cookie the node sets. Without this the browser sends
    // nothing and every call is anonymous — which reads as "signed out" rather
    // than as a bug, and is the reason it is spelled out here once.
    credentials: "same-origin",
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    // A body is not guaranteed on an error — a proxy can answer 502 with HTML,
    // and a node can answer 204-shaped failures with nothing at all. Falling
    // back to the status line keeps the thrown value useful either way.
    let title = response.statusText || `HTTP ${response.status}`
    let detail = ""
    try {
      const problem = (await response.json()) as {
        title?: string
        detail?: string
      }
      title = problem.title ?? title
      detail = problem.detail ?? ""
    } catch {
      /* not JSON; the status line stands */
    }
    throw new ApiError(response.status, title, detail)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) =>
    request<T>("GET", path, undefined, signal),
  post: <T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    headers?: Headers_,
  ) => request<T>("POST", path, body, signal, headers),
  /// The verb a partial edit actually is.
  ///
  /// Added for purchasing, which is the first module here that corrects a
  /// record rather than only reading one: a supplier and a supplier item are
  /// both amended through `PATCH`, where an absent field means "leave it
  /// alone" and a present one replaces. A `POST` of the whole record would
  /// have meant reading it, merging in the browser and writing it back — which
  /// is how one person's edit of an address quietly reverts another's edit of
  /// a price.
  patch: <T>(
    path: string,
    body: unknown,
    signal?: AbortSignal,
    headers?: Headers_,
  ) => request<T>("PATCH", path, body, signal, headers),
}

/// A query string built from whatever is actually set.
///
/// An absent option and an empty string mean the same thing to every handler —
/// take the default — so neither is put on the wire. This matters beyond
/// tidiness: the query string is part of the React Query cache key, and
/// `?site=` and no `site` at all would otherwise be two cache entries holding
/// one answer.
export function search(
  params: Readonly<
    Record<string, string | number | boolean | null | undefined>
  >,
): string {
  const parts = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue
    parts.set(key, String(value))
  }
  const text = parts.toString()
  return text === "" ? "" : `?${text}`
}
