import type { EdgeSyncStatus, EdgeSyncTriggered } from "../index";
import { Node } from "./node";

/// This node's outbox.
///
/// Only an Edge answers these. Cloud is where facts arrive, so it has no
/// outbox of its own and a console built against it will get 404 — which is
/// the honest answer rather than a fabricated empty one.
export class Sync {
  private readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  status(signal?: AbortSignal): Promise<EdgeSyncStatus> {
    return this.node.get<EdgeSyncStatus>("/api/v1/sync/status", { signal });
  }

  /// Ask for the backlog to be sent now rather than at the next interval.
  ///
  /// This does not shorten an open breaker, and the status it is displayed
  /// beside will still say the sender is in cooldown. A button that appeared
  /// to force a send during an outage would only hide the outage.
  trigger(signal?: AbortSignal): Promise<EdgeSyncTriggered> {
    return this.node.post<EdgeSyncTriggered>("/api/v1/sync/trigger", {}, { signal });
  }
}

/// Is this backlog a problem, or just a moment?
///
/// Written here rather than at each call site so the till and the warehouse
/// agree on what "behind" means. Anything the operator should act on is
/// `blocked`; `behind` is ordinary and clears itself.
export type SyncHealth = "off" | "blocked" | "behind" | "current";

export function syncHealth(status: EdgeSyncStatus): SyncHealth {
  if (!status.sender_enabled || status.origin_id === null) {
    return "off";
  }
  const openUntil = status.breaker_open_until;
  if (
    status.dead_lettered > 0 ||
    (openUntil !== null && Date.parse(openUntil) > Date.now())
  ) {
    return "blocked";
  }
  return status.pending_facts > 0 ? "behind" : "current";
}
