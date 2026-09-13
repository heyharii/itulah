import { useEffect, useMemo, useState } from "react"

/// What the counter tells the screen that faces the shopper.
///
/// The display is a second OS window with its own document, so nothing reaches
/// it as a prop: the two windows share an origin and nothing else.
/// `BroadcastChannel` is what an origin already has for exactly this — no
/// server, no dependency, no port to configure — and it does not care which
/// window opened first, which matters because the display is opened by hand
/// from the shell and can be opened, closed and opened again mid-sale.
///
/// # What may cross, and what may not
///
/// A screen facing the public is not a debug view. What the shopper is owed is
/// what they are being charged and why: the lines, the total, whether that
/// total is final, and the change at the end. Everything else on the counter —
/// the EPCs, the member number, the cashier's name, the tenders, which node
/// and which terminal this is — is either somebody's identity or the shop's
/// own business, and a screen a queue of strangers can read is the last place
/// any of it belongs. So none of it is merely left undrawn by the display: it
/// is left out of the *type*, and there is no field to put it back into.
///
/// # Why there is a heartbeat
///
/// A window that is closed sends no goodbye, and a till whose WebView has hung
/// posts nothing either. Both look precisely like a cashier who has not
/// scanned anything for a minute — and the difference is the whole question,
/// because one of them means the total on the public screen is still true and
/// the other means it is a frozen number about a sale that ended. So the last
/// view is re-sent on a beat, the display measures silence rather than trust,
/// and `publish` stays cheap enough to be called on every basket change.

/// One line, as the person paying for it may see it.
///
/// No EPC and no SKU. The shopper is buying a garment, not a tag, and the tag
/// number is the one field on a basket line that identifies a specific piece
/// of this shop's stock. Both fields are nullable and neither is filled in by
/// the counter: a unit the price book does not carry has no price and a unit
/// the book has never heard of has no name, and the words a shopper reads in
/// either case belong to the screen that faces them, not to the till.
export type CustomerLine = {
  readonly name: string | null
  readonly priceMinor: number | null
}

/// The whole of what the shopper's screen is allowed to know.
///
/// Three shapes rather than one shape with optional fields, because a basket
/// has no change and a finished sale has no provisional total — and a screen
/// that had to work out which of its fields were meaningful would eventually
/// show the one that was not. `shopName` and `currency` sit on all three:
/// whose shop this is, and what the numbers are counted in, are true in every
/// state.
///
/// `shopName` is null until a node tells a till which shop it is. The display
/// falls back to the brand rather than printing a blank where a name goes.
export type CustomerView =
  /// Nothing on the counter — and also what the display falls back to when the
  /// counter stops speaking. A greeting is the right copy for both, because
  /// "welcome" is true either way where "your basket is empty" would be a
  /// claim about a counter this window can no longer see.
  | {
      readonly stage: "idle"
      readonly shopName: string | null
      readonly currency: string
    }
  /// A basket being built. `provisional` is the counter's own admission that
  /// the figure came from the shop's price book and not yet from the node's
  /// quote — the same distinction `till.tsx` prints under its own total, and
  /// the shopper is the person with the most right to be told it.
  | {
      readonly stage: "basket"
      readonly shopName: string | null
      readonly currency: string
      readonly lines: readonly CustomerLine[]
      readonly totalMinor: number
      readonly provisional: boolean
    }
  /// Paid. Zero change is an answer and not a missing field: somebody who
  /// handed over the exact amount is entitled to see that nothing is owed
  /// back, which is the one thing they cannot check by looking at the drawer.
  | {
      readonly stage: "change"
      readonly shopName: string | null
      readonly currency: string
      readonly totalMinor: number
      readonly changeMinor: number
    }

/// Versioned, because the shape above is a wire format between two windows a
/// shop can end up running from two different builds — a display left open
/// across an update, most obviously. A v2 counter and a v1 display should hear
/// nothing from each other rather than half of it.
const CHANNEL = "itulah.pos.customer.v1"

/// How often the last view is re-sent, and how long the display goes on
/// believing it. Two beats of slack, so one message dropped by a busy WebView
/// cannot blank a screen somebody is reading.
const BEAT_MS = 2_000
const SILENCE_MS = 6_000

/// A channel, or nothing at all.
///
/// An old WebView without `BroadcastChannel` costs this shop its customer
/// display. It must not cost it the till: every path out of here is a return,
/// never a throw, because a counter that fell over on the way to a courtesy
/// screen would be the most expensive possible way to not have one.
function open(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null
  try {
    return new BroadcastChannel(CHANNEL)
  } catch {
    return null
  }
}

// ── the counter's end ───────────────────────────────────────────────────

// Dialled on the first publish rather than at import, so a window that only
// ever displays never opens a second channel it has no use for. The counter
// and the display hold separate channel objects on purpose: the display closes
// its own on unmount, and a shared one would take the counter's voice with it.
let out: BroadcastChannel | null = null
let dialled = false
let last: CustomerView | null = null
let sent: string | null = null
let beat: ReturnType<typeof setInterval> | null = null

function line(): BroadcastChannel | null {
  if (!dialled) {
    out = open()
    dialled = true
  }
  return out
}

/// Forget the channel, and stop beating at it.
///
/// `sent` goes with it, so the next publish is sent in full rather than
/// skipped as a duplicate of something the dead channel never delivered.
function drop(): void {
  out = null
  dialled = false
  sent = null
  if (beat !== null) {
    clearInterval(beat)
    beat = null
  }
}

function say(view: CustomerView): void {
  const channel = line()
  if (channel === null) return
  try {
    channel.postMessage(view)
  } catch {
    // Posting into a channel whose context is going away throws, and there is
    // nobody to tell about it: the display is a courtesy and the sale is not.
    // Let it go, and let the next publish dial again — a display reopened
    // later in the day is the ordinary case, not the exceptional one.
    drop()
  }
}

/// Put what is on the counter onto the shopper's screen.
///
/// Idempotent against what was last actually sent: the counter calls this on
/// every basket change, and a basket change is every tag swept off a rack.
/// Serialising a few dozen lines to compare them costs microseconds and saves
/// the display a re-render per identical message.
///
/// What the beat promises is narrow, and the counter has to cover the rest. It
/// says *this window is alive and this is still what is on its counter*. It
/// does not say a cashier is still standing at one — so a screen that leaves
/// the counter (payment abandoned, a shift opened, a sign-out) publishes an
/// idle view on its way out, because nothing in this file can tell that from a
/// cashier who has merely stopped scanning.
export function publish(view: CustomerView): void {
  if (line() === null) return
  const wire = JSON.stringify(view)
  if (wire !== sent) {
    sent = wire
    last = view
    say(view)
  }
  beat ??= setInterval(() => {
    if (last !== null) say(last)
  }, BEAT_MS)
}

// ── the shopper's end ───────────────────────────────────────────────────

/// Anything on the channel this build does not recognise is skipped.
///
/// Not a trust boundary — the only writer is this app's own counter window —
/// but a version boundary. A display left open across an update hears a shape
/// it was never compiled against, and skipping it leaves a greeting on the
/// glass, which is the right resting state for a screen nobody can dismiss.
function read(data: unknown): CustomerView | null {
  if (typeof data !== "object" || data === null) return null
  const stage = (data as { readonly stage?: unknown }).stage
  return stage === "idle" || stage === "basket" || stage === "change"
    ? (data as CustomerView)
    : null
}

/// Subscribe this window to the counter.
///
/// Null only until the counter has been heard from at all — including forever,
/// on a WebView with no `BroadcastChannel`, which is the honest answer there
/// rather than an invented empty basket.
///
/// After that it is always a view, and when the counter has gone quiet for
/// longer than the beat allows the view is downgraded to `idle` instead of
/// held. That downgrade is the entire reason silence is measured: a frozen
/// total on a public screen is a number the next person in the queue will read
/// as theirs, while the shop's name and a greeting are the two things still
/// true about a counter that has stopped talking.
export function useCustomerView(): CustomerView | null {
  const [seen, setSeen] = useState<CustomerView | null>(null)
  const [fresh, setFresh] = useState(false)

  useEffect(() => {
    const ear = open()
    if (ear === null) return
    let lapse: ReturnType<typeof setTimeout> | undefined
    ear.onmessage = (event: MessageEvent) => {
      const view = read(event.data)
      if (view === null) return
      setSeen(view)
      setFresh(true)
      // Restarted per message rather than run as a clock, so the window that
      // matters is "time since the counter last spoke" and not "time since
      // this window mounted".
      clearTimeout(lapse)
      lapse = setTimeout(() => setFresh(false), SILENCE_MS)
    }
    return () => {
      clearTimeout(lapse)
      ear.close()
    }
  }, [])

  return useMemo<CustomerView | null>(() => {
    if (seen === null || fresh) return seen
    return { stage: "idle", shopName: seen.shopName, currency: seen.currency }
  }, [seen, fresh])
}
