import { Node } from "./node";

/// Who is signed in.
export interface Me {
  readonly id: string;
  readonly username: string;
  readonly display_name: string;
  readonly role: string;
}

/// Signing in and out.
///
/// The session is a cookie the server sets, so nothing here stores a token.
/// A token in browser storage is a token that outlives the tab it was meant
/// for and can be read by anything else running on the page.
export class Auth {
  constructor(private readonly node: Node) {}

  me(signal?: AbortSignal): Promise<Me> {
    return this.node.get<Me>("/api/v1/auth/me", { signal });
  }

  async login(username: string, password: string): Promise<void> {
    await this.node.post("/api/v1/auth/login", { username, password });
  }

  async logout(): Promise<void> {
    await this.node.post("/api/v1/auth/logout", {});
  }
}
