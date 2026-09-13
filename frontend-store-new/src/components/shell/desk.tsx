import { cn } from "@/lib/utils"

/// The counter, laid out the way a till is laid out.
///
/// This is the **pos-electron** shape, in this system's tokens: a left column
/// for what goes in and who is buying, a right column for what it comes to and
/// the one button that takes the money. It is not the phone expression the rest
/// of this app uses, and that is deliberate — a cashier stands at a fixed
/// screen with a customer waiting, not a tablet held in one hand.
///
/// Two rules the reference got right and this keeps:
///
///   - **The left column is 42%.** Wide enough for a full-width scan field,
///     which leaves the majority of the screen for the list a customer looks
///     at over the counter.
///   - **The function board never scrolls and never moves.** Muscle memory is
///     the whole interface at four in the afternoon, and a key that shifts
///     position is a key that has to be read again every time.
///
/// Below `md` it collapses to a single column, because a shop with a tablet on
/// the counter is a real shop and a 42% column on a 5-inch screen is not a
/// layout.
export function Desk({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row",
        className,
      )}
      {...props}
    />
  )
}

/// What goes in, and who is buying.
export function DeskLeft({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-col bg-soft",
        "md:w-[42%] md:border-r md:border-hairline",
        className,
      )}
      {...props}
    />
  )
}

/// What it comes to, and the one action.
export function DeskRight({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex min-h-0 min-w-0 flex-1 flex-col bg-canvas",
        className,
      )}
      {...props}
    />
  )
}

/// The part of a column that scrolls. Everything else in a column is pinned.
export function DeskBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", className)}
      {...props}
    />
  )
}

/// The function board: three columns of equal keys, pinned to the foot of the
/// left column.
///
/// Three rather than two or four because that is what puts six keys within a
/// glance without any of them being narrower than a hand. Every key is the same
/// size on purpose — a board where one key is bigger teaches that the others
/// are less important, and at a counter they are all the same importance: the
/// one you need is the one you need.
export function FunctionBoard({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "grid shrink-0 grid-cols-3 gap-2 border-t border-hairline bg-canvas p-3",
        className,
      )}
      {...props}
    />
  )
}

/// One key on the board.
///
/// A count is written as a NUMBER inside the key, not as a badge in its corner.
/// A badge is 14px of type at the edge of a control somebody is reaching for
/// with a customer in front of them; the number belongs where the eye already
/// is.
export function FunctionKey({
  label,
  shortcut,
  count,
  tone = "normal",
  onClick,
  disabled,
}: {
  label: string
  /// The F-key that does the same thing. Drawn because a till is used by
  /// somebody who stops looking at the screen within a week.
  shortcut?: string
  count?: number
  tone?: "normal" | "attention"
  onClick?: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-[3.75rem] flex-col items-center justify-center gap-0.5 rounded-inner",
        "border text-center transition-colors select-none",
        "active:bg-soft-2 disabled:pointer-events-none disabled:opacity-45",
        tone === "attention"
          ? "border-warn-bg bg-warn-bg text-warn-fg"
          : "border-hairline-2 bg-canvas text-text",
      )}
    >
      <span className="flex items-baseline gap-1.5 text-control font-medium">
        {label}
        {count !== undefined && count > 0 && (
          <span className="text-metric font-semibold tabular-nums">
            {count}
          </span>
        )}
      </span>
      {shortcut !== undefined && <Kbd>{shortcut}</Kbd>}
    </button>
  )
}

/// A key cap. Mono, because it names a physical key and the whole point is that
/// it reads as one.
export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-[0.3rem] bg-soft-2 px-1.5 py-px font-mono text-[0.6875rem] leading-4 font-normal text-mute">
      {children}
    </kbd>
  )
}

/// A strip across the top of the desk that says something is wrong, or unusual,
/// and stays there.
///
/// Not a toast. A toast for "this drawer has no shift open" is a fact that
/// disappears while the cashier is looking at the customer.
export function DeskBanner({
  tone = "info",
  children,
  action,
}: {
  tone?: "info" | "warn" | "bad"
  children: React.ReactNode
  action?: React.ReactNode
}) {
  const skin = {
    info: "bg-info-bg text-info-fg",
    warn: "bg-warn-bg text-warn-fg",
    bad: "bg-bad-bg text-bad-fg",
  }[tone]
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5 text-meta",
        skin,
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}
