import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/// The record card — the ONE unit every list is made of on a phone, and on a
/// desk wherever a list is a grid of things rather than a table.
///
/// It is the hub's lead-figure card (`DataTable`'s card mode `cardLead`, as the
/// hub's `PhoneCards` and `PhoneGroups` draw it), written once so no screen
/// invents its own. The anatomy, which is the owner's ruling of 2026-10-06 and
/// does not vary:
///
///   ┌──────────────────────────────────────────┐
///   │ [media]  Name                  Rp 129.000 │  the thing, and the ONE
///   │          CODE-IN-MONO             3 SKUs  │  figure that matters (24px)
///   ├──────────────────────────────────────────┤
///   │ what it says about itself      [ Action ] │  info left; a tint WORD
///   └──────────────────────────────────────────┘  button or a status right
///
///  - name + a thin mono `code` top-left, extra `lines` under them (14px grey);
///  - the lead figure top-right, 24px semibold, with a plain `caption` under
///    it;
///  - a hairline, then the foot: `info` on the left and, on the right, EITHER
///    one text button (`action` — `variant="tint" size="card"`, 32px with a
///    44px hit area, never a pencil) OR one status (`status`, a `Pill` or
///    `Status`), never both;
///  - nothing else: no second figure, no chips, no progress bar.
///
/// A card with no foot is its head alone — a list of terms has nothing to say
/// under them.
export function LeadCard({
  title,
  code,
  lines,
  media,
  lead,
  foot,
  onOpen,
  tone,
  selected = false,
  className,
}: {
  /// The thing's name.
  title: React.ReactNode
  /// A thin mono code under the name, where the code says something the name
  /// does not (an article code, a PO number).
  code?: React.ReactNode
  /// Lines under the code, 14px grey, one to a line. A line that is `null`,
  /// `undefined` or `false` is left out.
  lines?: readonly React.ReactNode[]
  /// A thumbnail left of the name: a photograph, a swatch. Drawn 64px square,
  /// clipped to the corners; the node fills it.
  media?: React.ReactNode
  /// The one figure that matters, at the right of the head.
  lead?: {
    figure: React.ReactNode
    /// Under the figure, plain: "3 SKUs", "pcs".
    caption?: React.ReactNode
    /// A figure with nothing to say (a zero, a dash) recedes.
    muted?: boolean
  }
  /// What the card says about itself, and the one thing to do or know.
  foot?: {
    /// On the left, 14px grey: "12 SKUs · Pria".
    info?: React.ReactNode
    /// A text button on the right. `onClick` does not open the card.
    action?: {
      label: string
      onClick: () => void
      disabled?: boolean
      pending?: boolean
    }
    /// A status on the right: a `Pill` or a `Status`.
    status?: React.ReactNode
  }
  /// Makes the whole card the target, keyboard included (Enter or Space).
  onOpen?: () => void
  /// `alert`: the foot takes a light red wash, so a card that needs somebody
  /// shows from across the page without a word on it.
  tone?: "alert"
  /// The card whose record is open.
  selected?: boolean
  className?: string
}) {
  const hasFoot =
    foot !== undefined &&
    (foot.info !== undefined ||
      foot.action !== undefined ||
      foot.status !== undefined)
  const extra = (lines ?? []).filter(
    (one) => one !== null && one !== undefined && one !== false && one !== "",
  )
  return (
    <div
      onClick={onOpen}
      {...(onOpen !== undefined ? openable(onOpen) : {})}
      aria-current={selected || undefined}
      className={cn(
        "relative flex min-w-0 flex-col rounded-card border border-hairline bg-canvas shadow-soft transition-colors duration-(--t-press) ease-(--ease-out)",
        onOpen !== undefined &&
          "cursor-pointer outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent",
        selected ? "bg-accent-bg" : onOpen !== undefined && "active:bg-soft",
        className,
      )}
    >
      <div className="flex items-start gap-3 p-4">
        {media !== undefined && (
          <div className="size-16 shrink-0 overflow-hidden rounded-inner bg-soft-2">
            {media}
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="line-clamp-2 text-card-title font-semibold break-words text-ink">
            {title}
          </div>
          {code !== undefined && code !== null && code !== "" && (
            <div className="truncate font-mono text-[0.875rem] font-normal text-mute">
              {code}
            </div>
          )}
          {extra.map((line, index) => (
            <div key={index} className="text-[0.875rem] text-mute">
              {line}
            </div>
          ))}
        </div>
        {lead !== undefined && (
          <div className="min-w-0 shrink-0">
            <LeadFigure
              value={lead.figure}
              caption={lead.caption}
              muted={lead.muted}
            />
          </div>
        )}
      </div>
      {hasFoot && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-b-card border-t px-4 py-3",
            tone === "alert" ? "border-bad/10 bg-bad-bg/50" : "border-hairline",
          )}
        >
          <div className="min-w-0 text-[0.875rem] text-mute">{foot.info}</div>
          {(foot.action !== undefined || foot.status !== undefined) && (
            <div className="flex shrink-0 items-center">
              {foot.action !== undefined ? (
                <Button
                  variant="tint"
                  size="card"
                  disabled={foot.action.disabled}
                  pending={foot.action.pending}
                  onClick={(event) => {
                    event.stopPropagation()
                    foot.action?.onClick()
                  }}
                >
                  {foot.action.label}
                </Button>
              ) : (
                foot.status
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/// The figure a card leads with: 24px, semibold, with a plain caption under it.
export function LeadFigure({
  value,
  caption,
  muted = false,
}: {
  value: React.ReactNode
  caption?: React.ReactNode
  muted?: boolean
}) {
  return (
    <span className="flex flex-col items-end text-right tabular-nums">
      <span
        className={cn(
          "text-[1.5rem] leading-tight font-semibold tracking-tight",
          muted ? "text-mute" : "text-ink",
        )}
      >
        {value}
      </span>
      {caption !== undefined && (
        <span className="text-[0.875rem] text-mute">{caption}</span>
      )}
    </span>
  )
}

/// What a card that opens needs of the keyboard: a tab stop, Enter and Space
/// open it, and the arrows walk to the card above or below. Only when the card
/// itself has the focus — a button inside it keeps its own keys.
function openable(open: () => void) {
  return {
    tabIndex: 0,
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.target !== event.currentTarget) return
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault()
        open()
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const next =
          event.key === "ArrowDown"
            ? event.currentTarget.nextElementSibling
            : event.currentTarget.previousElementSibling
        if (next instanceof HTMLElement && next.tabIndex === 0) {
          event.preventDefault()
          next.focus()
        }
      }
    },
  }
}
