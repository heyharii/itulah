import { useNavigate } from "@tanstack/react-router"

import { allNavItems } from "@/lib/navigation"
import type { Search } from "@/lib/params"

/// Navigate to a path declared in `lib/navigation.ts`.
///
/// The same trade `<AppLink>` makes, for the times a screen has to move without
/// a link — after a payment completes, after a movement is recorded. Router
/// cannot type a route tree it did not see declared, so the path is checked
/// against the registry instead and the cast happens after the check.
export function useGo() {
  const navigate = useNavigate()
  return (to: string, search?: Search, options?: { replace?: boolean }) => {
    if (import.meta.env.DEV && !allNavItems.some((item) => item.path === to)) {
      throw new Error(
        `go("${to}") — no nav entry declares that path. Add it to lib/navigation.ts, or fix the typo.`,
      )
    }
    void navigate({
      to: to as never,
      search: (search ?? {}) as never,
      // `replace` for a screen that has finished with the one it came from — a
      // completed sale must not leave the payment screen behind the back arrow,
      // because pressing back would land on a basket that no longer exists.
      replace: options?.replace ?? false,
    })
  }
}
