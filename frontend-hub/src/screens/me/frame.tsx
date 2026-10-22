import type { ReactNode } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { PageHeader } from "@/components/ui/page-header"
import { meNav } from "@/screens/me/nav"

/// A Profile screen in the frame every other hub screen stands in: the page's
/// gutters and its title. These screens came from the employee app, which
/// drew its own; in the hub they sat flush against the page's edges with no
/// name over them. On a phone the top bar names the screen, and `PageHeader`
/// drops the echo there.
export function framed(Screen: () => ReactNode, path: string): () => ReactNode {
  const title =
    meNav.sections
      .flatMap((section) => section.items)
      .find((item) => item.path === path)?.label ?? ""
  const Framed = () => (
    <PageContent>
      <PageHeader title={title} />
      <Screen />
    </PageContent>
  )
  Framed.displayName = `Framed(${path})`
  return Framed
}
