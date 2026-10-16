import type { ReactNode } from "react"

import { useCustomerView } from "@/customer-link"
import { money } from "@itulah/contract/money"

/// The other side of the counter.
///
/// Every decision here comes from one fact about who is reading it: somebody
/// standing up, a metre and a half away, across a counter, who did not choose
/// to look at this screen and cannot do anything to it. So the total is the
/// largest thing on the glass by a wide margin, the lines are legible but
/// plainly secondary, and there is not one button, field or handle anywhere —
/// a public screen with something pressable on it is a screen a stranger will
/// press.
///
/// # The rules this screen obeys
///
/// **It says nothing it does not know.** The counter's state arrives over a
/// channel, and a channel can go quiet because a window was closed as easily
/// as because a cashier paused. `useCustomerView` measures that silence and
/// hands back a greeting instead of the last total it saw — so the worst this
/// screen does when it loses the counter is welcome somebody, rather than show
/// the person now at the front of the queue a figure belonging to the customer
/// before them.
///
/// **A provisional total is labelled as one.** The counter prices a basket
/// from the shop's price book so it can keep drawing with the line down, and
/// the node's quote lands a moment later. The shopper is the party with the
/// most at stake in that gap and the least ability to see it, so it is said in
/// words, under the number.
///
/// **Three states, each written on purpose.** A greeting for an empty counter,
/// a basket being built, and the change owed once it is paid. They are not one
/// screen with fields blanked out: what a shopper needs to read is different
/// in each, and at the end the number that matters is not the total any more.
///
/// # Why there is no scrollbar
///
/// Nobody can operate one. A scroll region on a screen with no pointer and no
/// hands on it is a promise the glass cannot keep, and a basket taller than
/// the panel would simply hide its own total. So the most recent lines are
/// shown, growing upward from the total, and the rest are counted honestly in
/// a line above them — the shopper watches each garment land as it is scanned,
/// which is the moment they actually care about.

/// How many lines the panel shows before it starts counting the rest. Eight at
/// this size clears any display taller than about 600px, which is every second
/// screen a counter has ever had bolted to it.
const SHOWN = 8

/// The bottom panel. Roomier than `.totals` is on the cashier's side, because
/// nothing else competes for the height here.
const PANEL = { padding: "22px 34px 26px", gap: 12 } as const

/// The figure itself. `clamp` rather than a fixed size: a customer display is
/// whatever panel the shop had, from a repurposed 1024px tablet to a 1080p
/// monitor turned sideways, and the total has to be the biggest thing on all
/// of them without running off the right edge of the narrow ones.
const HUGE = {
  fontSize: "clamp(44px, 8.5vw, 136px)",
  letterSpacing: "-0.035em",
  lineHeight: 1,
} as const

const LEAD = { fontSize: 24 } as const

/// `.grand` draws its own rule, which is right under a subtotal and wrong
/// directly under the panel's own border.
const FLUSH = { paddingTop: 0, borderTop: 0 } as const

const ROW = { fontSize: 21, color: "var(--ink)", alignItems: "baseline" } as const

export function CustomerScreen() {
  const view = useCustomerView()
  // Never an empty space where a shop's name goes. Until a node tells a till
  // which shop it is, the brand is the truest thing this window knows.
  const name = view?.shopName ?? "central"

  // Nothing published yet, no channel on this WebView at all, or a counter
  // that has gone quiet — one greeting covers all three, because it is the
  // only sentence that stays true through every one of them.
  if (view === null || view.stage === "idle") {
    return (
      <Frame name={name} foot="Happy shopping">
        <div className="empty" style={{ gap: 16 }}>
          <h3 style={{ fontSize: 46, color: "var(--ink)" }}>Welcome</h3>
        </div>
      </Frame>
    )
  }

  if (view.stage === "change") {
    const owed = view.changeMinor > 0
    return (
      <Frame name={name} foot="Thank you for shopping with us">
        <div className="empty" style={{ gap: 14 }}>
          <h3 style={{ fontSize: 40, color: "var(--ink)" }}>Thank you</h3>
          <p style={{ fontSize: 19, maxWidth: 540 }}>
            {owed
              ? "Please take your change."
              : "Exact amount, no change."}
          </p>
        </div>
        <div className="totals" style={PANEL}>
          {/* The total drops to a supporting line the moment it is paid: what
              the shopper is now waiting for is the money coming back, and the
              biggest number on the glass should be the one they check. */}
          {owed && (
            <div className="total-line" style={{ fontSize: 19 }}>
              <span className="muted">Total</span>
              <span className="num">{money(view.totalMinor, view.currency)}</span>
            </div>
          )}
          <div className="grand" style={owed ? undefined : FLUSH}>
            <span style={LEAD}>{owed ? "CHANGE" : "PAID"}</span>
            <strong
              className="num"
              style={owed ? { ...HUGE, color: "var(--green)" } : HUGE}
            >
              {money(owed ? view.changeMinor : view.totalMinor, view.currency)}
            </strong>
          </div>
        </div>
      </Frame>
    )
  }

  const shown = view.lines.slice(-SHOWN)
  const earlier = view.lines.length - shown.length
  return (
    <Frame
      name={name}
      foot={`${view.lines.length} ${view.lines.length === 1 ? "item" : "items"} at the counter`}
    >
      {/* Lines stack up from the bottom, so the tag just scanned always lands
          in the same place: immediately above the total, where somebody
          watching for it is already looking. */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          padding: "18px 34px 0",
        }}
      >
        {earlier > 0 && (
          <p className="muted" style={{ fontSize: 16, marginBottom: 12 }}>
            + {earlier} earlier items
          </p>
        )}
        <div className="pay-items" style={{ gap: 13 }}>
          {/* Keyed by position. The EPC is the natural key for a basket line
              and is precisely the field that must not reach this window — and
              the list is rebuilt whole on every publish and holds no state of
              its own, so position is all a key has to be here. */}
          {shown.map((one, at) => (
            <div key={at} className="pay-item" style={ROW}>
              <span>{one.name ?? "Item"}</span>
              <span className="num">
                {one.priceMinor === null
                  ? "—"
                  : money(one.priceMinor, view.currency)}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="totals" style={PANEL}>
        <div className="grand" style={FLUSH}>
          <span style={LEAD}>TOTAL</span>
          <strong className="num" style={HUGE}>
            {money(view.totalMinor, view.currency)}
          </strong>
        </div>
        {view.provisional && (
          <div className="total-line">
            <span className="muted" style={{ fontSize: 15 }}>
              Still being calculated — the figure that counts is the one printed on the receipt.
            </span>
          </div>
        )}
      </div>
    </Frame>
  )
}

/// The shop's name at the top, a quiet line at the bottom, and whatever the
/// counter is doing in between.
///
/// The frame never moves between the three states. A shopper glances up from
/// their wallet, and a screen whose furniture had rearranged itself since the
/// last look is a screen they have to read from the beginning again.
function Frame({
  name,
  foot,
  children,
}: {
  name: string
  foot: string
  children: ReactNode
}) {
  return (
    <div
      id="app"
      data-screen="customer"
      // Nothing here is for handling. Selection and the text cursor are the
      // last two things on a page that still invite a stranger to touch it.
      style={{ userSelect: "none", cursor: "default" }}
    >
      <div style={{ flex: "none", padding: "22px 34px 0" }}>
        <span className="brand" style={{ fontSize: 22 }}>
          <span className="brand-mark">c.</span>
          {name}
        </span>
      </div>
      {children}
      <footer className="statusbar" style={{ height: 42, fontSize: 13 }}>
        <span>{foot}</span>
      </footer>
    </div>
  )
}
