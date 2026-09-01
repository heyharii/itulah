import { useNavigate, type LinkProps } from "@tanstack/react-router"

import { allNavItems } from "@/lib/navigation"
import type { SheetKey } from "@/lib/sheets"

/// Navigate in code, checked against the registry.
///
/// The programmatic twin of `<AppLink>`, and it exists for the same reason:
/// Router infers `to` from a static route tree and ours is generated, so
/// `navigate({ to: "/procurement" })` does not typecheck. Prefer `<AppLink>` —
/// a link the browser understands beats a click handler — and reach for this
/// only where the destination is decided after something else happens.
export function useAppNavigate() {
  const navigate = useNavigate()
  return (to: string, sheet?: { key: SheetKey; value: string }) => {
    if (import.meta.env.DEV && !allNavItems.some((item) => item.path === to)) {
      throw new Error(
        `navigate("${to}") — no nav entry declares that path. Add it to the module's nav.ts, or fix the typo.`
      )
    }
    return navigate({
      to: to as LinkProps["to"],
      search: sheet ? ({ [sheet.key]: sheet.value } as never) : undefined,
    })
  }
}
