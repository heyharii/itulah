import { readError } from "./error";

/// Which node this browser is talking to, and what it can do there.
///
/// Asked rather than assumed. The three surfaces are built and deployed
/// separately, but a till pointed at a DC — or at the centre — should say so
/// plainly instead of showing buttons that will be refused.
export interface NodeIdentity {
  readonly node_id: string;
  readonly role: "DC" | "STORE";
  readonly site_id: string;
  /// The operations this node performs locally, as the node itself reports
  /// them. A surface can hide what its node does not do rather than guessing
  /// from the role.
  readonly local_operations: readonly string[];
}

export interface RequestOptions {
  readonly signal?: AbortSignal;
}

/// A node, addressed by its base URL.
///
/// Empty base URL means "the server that served this page", which is the
/// normal case: each binary serves its own front end, so the till talks to the
/// till's own edge and nothing has to be configured.
export class Node {
  constructor(private readonly baseUrl: string = "") {}

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    options: RequestOptions = {},
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      // The session cookie the edge sets, when auth is on.
      credentials: "same-origin",
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
  catalog: () => ["store", "catalog"] as const,
  pools: () => ["inventory", "pools"] as const,
};
