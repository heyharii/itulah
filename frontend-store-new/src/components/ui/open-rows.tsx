import { cn } from "@/lib/utils"

/// Rows of a `ListTable` that open a record sheet rather than unfolding in
/// place — without a second table component.
///
/// `ListTable` unfolds a row under itself, which is right for a list whose rows
/// are compared with each other. A receipt or a petty-cash expense is a record
/// with more in it than a row can hold — its lines, its signatures, its note —
/// and the hub opens those in a sheet. So this wraps the table rather than
/// re-drawing it:
///
///  - one cell in each row carries an `<OpenButton>`: the keyboard's way in,
///    and the row's name for a screen reader;
///  - a press anywhere else on the row, or on the phone's card row, is handed
///    to that button's record.
///
/// Rows without a button (a totals row) are left alone and do not take the
/// pointer cursor. A real control inside a row keeps its own press.
export function OpenRows({
  onOpen,
  className,
  children,
}: {
  onOpen: (key: string) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "[&_li:has([data-open])]:cursor-pointer [&_li:has([data-open]):active]:bg-soft [&_tbody_tr:has([data-open])]:cursor-pointer",
        className,
      )}
      onClick={(event) => {
        const target = event.target as HTMLElement
        const own = target.closest<HTMLElement>("[data-open]")
        if (own === null && target.closest("a, button, input") !== null) return
        const key = (
          own ??
          target.closest("tr, li")?.querySelector<HTMLElement>("[data-open]")
        )?.dataset.open
        if (key !== undefined) onOpen(key)
      }}
    >
      {children}
    </div>
  )
}

/// The row's own button — its name, pressable. Drawn as the text it holds; the
/// row's hover tint is the affordance, the focus ring is the keyboard's.
export function OpenButton({
  id,
  label,
  className,
  children,
}: {
  /// The key `OpenRows` hands back when this row is pressed.
  id: string
  /// What a screen reader hears, when the visible text is only a figure.
  label?: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      data-open={id}
      aria-label={label}
      className={cn(
        "block max-w-full min-w-0 rounded-[0.25rem] text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
        className,
      )}
    >
      {children}
    </button>
  )
}
