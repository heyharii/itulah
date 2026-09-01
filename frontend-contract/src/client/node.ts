import { readError } from "./error";

/// The cookie the server sets alongside the session, readable by script on
/// purpose: its whole job is to be echoed back in a header that a cross-site
/// form cannot set. Named in `backend/src/security.rs`.
const CSRF_COOKIE = "inventory_csrf";

/// Methods the server treats as safe, and so does not demand a CSRF token for.
/// Kept in step with the middleware in `cloud/http/auth.rs` and `edge/http.rs`.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) {
      continue;
    }
    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

/// Which node this browser is talking to, and what it can do there.
///
/// Asked rather than assumed. The three surfaces are built and deployed
/// separately, but a till pointed at a DC — or at the centre — should say so
/// plainly instead of showing buttons that will be refused.
export interface NodeIdentity {
  readonly node_id: string;
  readonly node_role: "CLOUD" | "DC" | "STORE";
  readonly site_id?: string;
  /// Capitalised on purpose by the server when it is off — a shout, not a
  /// value to be tidied. `cloud/http/mod.rs` and `edge/http.rs` both write
  /// `if enabled { "enabled" } else { "DISABLED" }`, so typing this as
  /// lower-case would be a lie that only comes true on a node running without
  /// authentication, which is the one moment anybody needs to be told.
  readonly auth: "enabled" | "DISABLED";
  /// The operations this node performs locally, as the node itself reports
  /// them. A surface can hide what its node does not do rather than guessing
  /// from the role.
  readonly local_operations?: readonly string[];
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
  /// Extra headers for this one request — `Idempotency-Key` on a write that
  /// must not be applied twice, `If-Match` on a conditional update. Transport
  /// concerns (content type, CSRF, credentials) are set below and are not
  /// overridable from here.
  readonly headers?: Readonly<Record<string, string>>;
}

/// A node, addressed by its base URL.
///
/// Empty base URL means "the server that served this page", which is the
/// normal case: each deployment puts its API on the same origin as its front
/// end, so nothing has to be configured and the session cookie — which is
/// `SameSite=Strict` — is actually sent.
export class Node {
  // A field and an assignment rather than a constructor parameter property:
  // the apps compile with `erasableSyntaxOnly`, which allows only syntax that
  // survives having its types stripped, and a parameter property does not.
  private readonly baseUrl: string;

  constructor(baseUrl: string = "") {
    this.baseUrl = baseUrl;
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) {
      headers["content-type"] = "application/json";
    }
    return this.send<T>(
      method,
      path,
      body === undefined ? undefined : JSON.stringify(body),
      headers,
      options,
    );
  }

  /// A write whose body is bytes rather than a document.
  ///
  /// Upload is the only one: the browser hands the `File` straight to `fetch`,
  /// and the name and content type travel as query parameters — see
  /// `cloud/http/files.rs`, which chose that over a header so no cross-origin
  /// preflight has to be widened, and over multipart so nothing has to be
  /// re-encoded. Everything else is an ordinary write, and it lives here for
  /// that reason: a loose `fetch` in one screen would be a write without the
  /// CSRF header, which the server refuses, and without the error shape every
  /// other call already knows how to read.
  upload<T>(path: string, body: Blob, options: RequestOptions = {}): Promise<T> {
    return this.send<T>("POST", path, body, {}, options);
  }

  private async send<T>(
    method: string,
    path: string,
    body: BodyInit | undefined,
    headers: Record<string, string>,
    options: RequestOptions,
  ): Promise<T> {
    // A cookie-authenticated write must carry the CSRF token in a header as
    // well as the cookie; the server compares the two and rejects the request
    // when either is missing. Omitting this header is why a signed-in browser
    // gets 403 on everything except reads.
    if (!SAFE_METHODS.has(method.toUpperCase())) {
      const csrf = readCookie(CSRF_COOKIE);
      if (csrf !== undefined) {
        headers["x-csrf-token"] = csrf;
      }
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers[name] = value;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      // The session cookie the node sets when auth is on.
      credentials: "include",
      signal: options.signal,
    });
    if (!response.ok) {
      throw await readError(response);
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("GET", path, undefined, options);
  }

  post<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("POST", path, body, options);
  }

  /// Who am I talking to.
  identity(options?: RequestOptions): Promise<NodeIdentity> {
    return this.get<NodeIdentity>("/api/v1/health", options);
  }
}

/// A key that changes whenever a request's answer could change.
///
/// Written out rather than composed ad hoc at each call site: a cache that
/// invalidates the wrong key is a till showing yesterday's price, and that is
/// not a bug anybody finds by reading the screen.
export const cacheKey = {
  identity: () => ["identity"] as const,
  me: () => ["auth", "me"] as const,
  catalog: () => ["store", "catalog"] as const,
  pools: () => ["inventory", "pools"] as const,
};
