import type { CloudMe, EdgeMe, LoginResponse } from "../index";
import { Node } from "./node";

/// Who is signed in.
///
/// Cloud and Edge answer `/auth/me` with different widths — an Edge also says
/// which identity store the session came from and which site the caller is
/// standing in. Both always carry these three, so a shell that only wants to
/// print a name and gate on a role can read this and ignore the difference.
export type Identity = CloudMe | EdgeMe;

/// Signing in and out.
///
/// The session is a cookie the server sets, so nothing here stores a token.
/// A token in browser storage is a token that outlives the tab it was meant
/// for and can be read by anything else running on the page. The login
/// response does carry one, for native and CLI callers; a browser ignores it.
export class Auth {
  private readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  me(signal?: AbortSignal): Promise<Identity> {
    return this.node.get<Identity>("/api/v1/auth/me", { signal });
  }

  /// Returns the signed-in identity so the caller can render a name and a role
  /// without a second round trip. The cookies that actually authorise the next
  /// request are set by this response, not by anything here.
  login(
    username: string,
    password: string,
    signal?: AbortSignal,
  ): Promise<LoginResponse> {
    return this.node.post<LoginResponse>(
      "/api/v1/auth/login",
      { username, password },
      { signal },
    );
  }

  async logout(signal?: AbortSignal): Promise<void> {
    await this.node.post("/api/v1/auth/logout", {}, { signal });
  }
}
