import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/// The actions a record offers, inside the card that owns them.
///
/// Two rules are enforced here rather than left to the caller, because both
/// are broken the moment they are optional.
///
/// The first is that only the leading action is black. The black is not an
/// accent in this system — it is the single "do this" mark on a surface, and
/// a panel with four black pills has said nothing about which one matters. A
/// PO draft currently carries four inverted surfaces on one screen; passing
/// the actions as data is what makes the second one impossible to write.
///
/// The second is that the row lives *in* the card. A footer bar with a bare
/// `border-t` floating on the well is a rule across the whole page belonging
/// to no object, which is exactly what "whitespace separates, one hairline
/// divides" forbids.
export type RowAction = {
  id: string
  label: React.ReactNode
  icon?: React.ReactNode
  onClick?: () => void
  disabled?: boolean
}

export function ActionRow({
  actions,
  primary = true,
  className,
}: {
  actions: readonly (RowAction | false | null | undefined)[]
  /// Pass `false` when the screen has already spent its one black CTA in the
  /// header — a read-only screen, or a panel whose primary act is elsewhere.
  /// Every action then renders ghost, which is honest: none of them is the
  /// one thing to do here.
  primary?: boolean
  className?: string
}) {
  const items = actions.filter((action): action is RowAction => Boolean(action))
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {items.map((action, index) => (
        <Button
          key={action.id}
          variant={index === 0 && primary ? "default" : "ghost"}
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.icon}
          {action.label}
        </Button>
      ))}
    </div>
  )
}
