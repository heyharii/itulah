import { Banner } from "@/components/ui/states"
import { describeCentre, isRefusal } from "@/screens/hr/centre"

/// One read out of many refused — the per-person reads a list fans out to.
///
/// The rest of the list still stands, so this is a line over it rather than
/// the whole screen swapped for a sentence: one person's advances refused is
/// not a reason to hide everybody else's.
export function RefusedBanner({
  error,
  what,
  className,
}: {
  error: unknown
  what: string
  className?: string
}) {
  return (
    <Banner
      tone={isRefusal(error) ? "warn" : "bad"}
      className={className ?? "mb-4"}
    >
      Some of it could not be read. {describeCentre(error, what)}
    </Banner>
  )
}
