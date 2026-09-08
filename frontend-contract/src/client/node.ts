import { readError } from "./error";

/// The cookie the server sets alongside the session, readable by script on
/// purpose: its whole job is to be echoed back in a header that a cross-site
/// form cannot set. Named in `backend/src/security.rs`.
const CSRF_COOKIE = "inventory_csrf";

/// The member surface's own pair, from `cloud/http/member.rs`.
///
/// A shopper's session is not an operator's, and the two cookies are named
/// apart so that neither can be mistaken for the other. A `Node` built for the
/// member app is told to echo this one instead.
export const MEMBER_CSRF_COOKIE = "member_csrf";

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

  /// Which CSRF cookie a write echoes back.
  ///
  /// Almost always the operator one. The member app passes
  /// `MEMBER_CSRF_COOKIE`, because its session is a different session with a
  /// different cookie — see `cloud/http/member.rs`.
  private readonly csrfCookie: string;

  /// A bearer token, when this node is addressed without cookies.
  ///
  /// Normally undefined: a surface served from its own node authenticates with
  /// the session cookie, and that is the whole story. It is set on the *second*
  /// node a surface talks to — the hub reaching a DC edge node — because both
  /// backends name their cookies identically (`inventory_session`,
  /// `inventory_csrf`, from `security.rs`). Two sessions under one cookie name
  /// on one origin is not a nuisance, it is signing out of the centre by
  /// signing in to the warehouse, and back again on the next login. A token
  /// carried in a header belongs to the client that holds it, so the two
  /// sessions cannot overwrite each other.
  ///
  /// While it is set, this node sends no cookies at all — neither the session
  /// nor the CSRF echo. Both would be the *other* node's, and the CSRF header
  /// built from a foreign cookie is refused rather than ignored. The server
  /// agrees: `edge/http.rs` demands the CSRF pair only of cookie-authenticated
  /// requests.
  private bearer: string | undefined;

  constructor(baseUrl: string = "", csrfCookie: string = CSRF_COOKIE) {
    this.baseUrl = baseUrl;
    this.csrfCookie = csrfCookie;
  }

  /// Hand this node a session token, or `null` to forget the one it has.
  setBearer(token: string | null | undefined): void {
    this.bearer = token ?? undefined;
  }

  /// Whether this node currently holds a token. A surface asks before deciding
  /// to draw a login box for a second backend.
  get hasBearer(): boolean {
    return this.bearer !== undefined;
  }

  /// The transport bits every request shares: who we are, and whether cookies
  /// travel. In one place because getting it wrong on one verb is a session
  /// that works for reads and 403s on writes.
  private authorise(
    headers: Record<string, string>,
    method: string,
  ): RequestCredentials {
    if (this.bearer !== undefined) {
      headers["authorization"] = `Bearer ${this.bearer}`;
      return "omit";
    }
    if (!SAFE_METHODS.has(method.toUpperCase())) {
      const csrf = readCookie(this.csrfCookie);
      if (csrf !== undefined) {
        headers["x-csrf-token"] = csrf;
      }
    }
    return "include";
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
  upload<T>(
    path: string,
    body: Blob,
    options: RequestOptions = {},
  ): Promise<T> {
    return this.send<T>("POST", path, body, {}, options);
  }

  /// A read whose answer is bytes rather than a document.
  ///
  /// The counterpart to `upload`, and it exists for the same reason: a page
  /// cannot reach these bytes with an `<img src>` or a plain link, because
  /// this node is authenticated with a bearer token that only this client
  /// holds. The caller gets a `Blob` and makes an object URL out of it.
  async download(path: string, options: RequestOptions = {}): Promise<Blob> {
    const headers: Record<string, string> = {};
    const credentials = this.authorise(headers, "GET");
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers[name] = value;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "GET",
      headers,
      credentials,
      signal: options.signal,
    });
    if (!response.ok) {
      throw await readError(response);
    }
    return response.blob();
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
    // gets 403 on everything except reads. A token-authenticated node sends
    // neither — see `bearer`.
    const credentials = this.authorise(headers, method);
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers[name] = value;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      // The session cookie the node sets when auth is on.
      credentials,
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

  /// Change one field of something that already exists.
  ///
  /// Distinct from `post` because the server distinguishes them: pulling a
  /// campaign's switch is `PATCH`, and routing it as a POST would 405. Added
  /// when the first such endpoint arrived rather than in advance — a verb with
  /// no route behind it is a verb somebody uses wrongly.
  patch<T>(path: string, body: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>("PATCH", path, body, options);
  }

  /// Put something away.
  ///
  /// Here for the same reason `patch` is: a route that answers `DELETE` and
  /// nothing else exists — archiving an assistant conversation — and sending it
  /// as a POST would 405. What the server does with it is the server's
  /// business; several of these archive rather than erase.
  delete<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>("DELETE", path, undefined, options);
  }

  /// A POST whose answer arrives in pieces, as server-sent events.
  ///
  /// The assistant is the only caller: its reply is written a word at a time
  /// and the tool calls behind it happen while it is being written, so waiting
  /// for a whole body would throw away the only part of an agent's turn worth
  /// watching. `EventSource` cannot be used for it — that is GET-only and
  /// cannot carry a CSRF header — so this is `fetch` reading the body itself.
  ///
  /// It lives here for the same reason every other verb does: the session
  /// cookie, the CSRF token and the error shape are set in one place, and a
  /// loose `fetch` in a screen is a request missing all three.
  ///
  /// `onEvent` is called with each frame's event name and its parsed `data`.
  /// A frame whose data is not JSON is skipped rather than thrown: the server
  /// also sends keep-alive comments, and a heartbeat must not end a stream.
  async stream(
    path: string,
    body: unknown,
    onEvent: (event: string, data: unknown) => void,
    options: RequestOptions = {},
  ): Promise<void> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      accept: "text/event-stream",
    };
    const credentials = this.authorise(headers, "POST");
    for (const [name, value] of Object.entries(options.headers ?? {})) {
      headers[name] = value;
    }
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials,
      signal: options.signal,
    });
    if (!response.ok) {
      throw await readError(response);
    }
    if (!response.body) {
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    // Frames are separated by a blank line and a frame can be split across
    // two network chunks, so whatever follows the last blank line is held
    // back rather than parsed.
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");

        let name = "message";
        let data = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) {
            name = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            data += line.slice(5).trim();
          }
        }
        if (data === "") {
          continue;
        }
        try {
          onEvent(name, JSON.parse(data));
        } catch {
          // Not JSON, so not ours. Skipping beats tearing down the stream.
        }
      }
    }
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
