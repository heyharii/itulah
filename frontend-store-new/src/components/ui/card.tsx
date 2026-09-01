import { cn } from "@/lib/utils"

/// White card, one hairline, 16px corners, whisper shadow.
///
/// Cards are lifted by their border, not by shadow — the shadow token exists to
/// stop the white-on-white edge disappearing, not to float anything.
export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-card border border-hairline bg-canvas shadow-soft",
        className,
      )}
      {...props}
    />
  )
}

/// The `{soft}` band a data card opens with: full-bleed, rounded top, carrying
/// a title or a record id, with the body staying white below it.
export function CardStrip({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-2.5 bg-soft px-3 py-2.5", className)}
      {...props}
    />
  )
}

/// The record card — the reference's list unit.
///
/// **A list here is a stack of cards, never a table.** That is not a
/// simplification made for a small screen: a till is thumbs and glances, and a
/// row of six columns is neither. DESIGN.md's record card is a `{soft}` header
/// strip carrying a white icon tile, an identifier and a status pill, over a
/// white body — and every list in this app is made of it.
///
/// `onPress` makes the whole card the target. 44px is a floor, not a ceiling,
/// and a card that opens something should be tappable anywhere on it.
export function RecordCard({
  icon,
  id,
  status,
  onPress,
  children,
  className,
}: {
  icon?: React.ReactNode
  id: React.ReactNode
  status?: React.ReactNode
  onPress?: () => void
  children?: React.ReactNode
  className?: string
}) {
  const inside = (
    <>
      <CardStrip>
        {icon !== undefined && (
          <span className="grid size-[1.6875rem] shrink-0 place-items-center rounded-[0.5rem] border border-hairline bg-canvas text-line-ico [&_svg]:size-[0.9375rem]">
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left text-card-title font-semibold text-ink">
          {id}
        </span>
        {status}
      </CardStrip>
      {children}
    </>
  )

  const shell =
    "block w-full overflow-hidden rounded-card border border-hairline bg-canvas text-left shadow-soft"

  return onPress === undefined ? (
    <div className={cn(shell, className)}>{inside}</div>
  ) : (
    <button
      type="button"
      onClick={onPress}
      className={cn(shell, "pressable", className)}
    >
      {inside}
    </button>
  )
}
