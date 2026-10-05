import type { EdgeSyncStatus, EdgeSyncTriggered } from "../index";
import { Node } from "./node";

/// This node's outbox.
///
/// The types describe an EDGE's answer, and an Edge is what these are for: a
/// till or a warehouse box uploads on its own cadence and nobody watching it
/// can otherwise see whether today's facts reached head office.
///
/// Cloud answers both paths too, with bodies of its own that these types do
/// NOT describe: `/api/v1/sync/status` is the receiver's snapshot (its
/// `node_id`, one entry per ingest stream, the breaker, dead letters) and
/// `/api/v1/sync/trigger` is `{"status":"triggered"}` — it wakes the cloud's
/// own sender rather than an edge's. Read those through the hub's own query
/// layer (`cloud/postgres/sync.rs`), not through this class.
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
