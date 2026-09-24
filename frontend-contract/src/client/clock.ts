import type { ClockControlRequest, ClockStatus } from "../index";
import { Node } from "./node";

/// The virtual business clock.
///
/// Most of the time the node just reads the wall clock, and there is nothing
/// to show: a console that said "jam nyata" on every screen forever would be
/// chrome pretending to be information. These routes exist so a staging node
/// can be told to live in a different week — to demo a month-end close, to
/// run a price cascade without waiting for its date, to rehearse expiry.
///
/// Everything here is gated: the node answers 403 unless test controls are
/// compiled in and the caller is an Admin. A console built against it in
/// production gets 403 — which is the honest answer rather than a hidden
/// chip.
export class Clock {
  private readonly node: Node;

  constructor(node: Node) {
    this.node = node;
  }

  status(signal?: AbortSignal): Promise<ClockStatus> {
    return this.node.get<ClockStatus>("/api/v1/inventory/control/clock", {
      signal,
    });
  }

  /// One endpoint for every control, in the node's own words.
  ///
  /// A request says what to become (`set_mode`, `rescale`, `pause`, `resume`,
  /// `advance_to`) rather than how to get there, so the server stays the one
  /// place that knows the arithmetic — including which anchors survive a
  /// rescale. The answer is the new `ClockStatus`, so the caller never has to
  /// re-ask to know what it did.
  control(
    request: ClockControlRequest,
    signal?: AbortSignal
  ): Promise<ClockStatus> {
    return this.node.post<ClockStatus>(
      "/api/v1/inventory/control/clock",
      request,
      { signal }
    );
  }
}
