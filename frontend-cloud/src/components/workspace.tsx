import { OrderDetail } from "@/components/po/order-detail"
import { PoDraft } from "@/components/po/po-draft"
import { PurchaseOrdersView } from "@/components/po/purchase-orders-view"
import { SourcingView } from "@/components/sourcing/sourcing-view"
import { useShortlist } from "@/lib/shortlist"
import { cn } from "@/lib/utils"
import { ClipboardList, Shirt, Star } from "lucide-react"
import { useState } from "react"

/// Where the buyer is.
///
/// Held in React state rather than the URL, and that is a real limitation
/// worth naming: a draft cannot be linked to or reloaded into, and the back
/// button leaves the app. It is state a router would own, and this shape — one
/// discriminated union, changed only through `go` — is what a router's routes
/// would be derived from when one is added.
type View =
  | { name: "sourcing" }
  | { name: "shortlist" }
  | { name: "orders" }
  | { name: "order"; id: string }
  | { name: "draft"; supplierId: string; itemIds: string[] }

export function Workspace() {
  const [view, setView] = useState<View>({ name: "sourcing" })
  const shortlist = useShortlist()

  const nav = (
    <nav className="flex flex-col gap-0.5" aria-label="Buying">
      <NavItem
        icon={<Shirt className="size-4" />}
        active={view.name === "sourcing"}
        onClick={() => setView({ name: "sourcing" })}
      >
        Sourcing
      </NavItem>
      <NavItem
        icon={<Star className={cn("size-4", shortlist.count > 0 && "text-amber-500")} />}
        active={view.name === "shortlist"}
        count={shortlist.count}
        onClick={() => setView({ name: "shortlist" })}
      >
        Shortlist
      </NavItem>
      <NavItem
        icon={<ClipboardList className="size-4" />}
        active={view.name === "orders" || view.name === "order" || view.name === "draft"}
        onClick={() => setView({ name: "orders" })}
      >
        Purchase orders
      </NavItem>
    </nav>
  )

  const draft = (supplierId: string, itemIds: string[]) =>
    setView({ name: "draft", supplierId, itemIds })

  switch (view.name) {
    case "sourcing":
    case "shortlist":
      return (
        <SourcingView
          // Remounting on the scope change is deliberate: the two scopes have
          // their own filter store, and carrying one's facets into the other
          // shows a shortlist narrowed by a supplier that isn't in it.
          key={view.name}
          nav={nav}
          staged={view.name === "shortlist"}
          onDraft={draft}
        />
      )
    case "orders":
      return (
        <PurchaseOrdersView
          nav={nav}
          onOpen={(id) => setView({ name: "order", id })}
          onNew={() => setView({ name: "sourcing" })}
        />
      )
    case "order":
      return (
        <OrderDetail
          nav={nav}
          purchaseOrderId={view.id}
          onBack={() => setView({ name: "orders" })}
        />
      )
    case "draft":
      return (
        <PoDraft
          nav={nav}
          supplierId={view.supplierId}
          seedItemIds={view.itemIds}
          onCancel={() => setView({ name: "shortlist" })}
          onCreated={(id) => {
            // The lines that became an order are no longer staged. Leaving them
            // there is how the same goods get ordered twice.
            shortlist.remove(view.itemIds)
            // The order's own screen is the confirmation: it shows the number,
            // the lines, and that nothing has arrived against it yet.
            setView({ name: "order", id })
          }}
        />
      )
  }
}

function NavItem({
  icon,
  active,
  count,
  onClick,
  children,
}: {
  icon: React.ReactNode
  active: boolean
  count?: number
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] transition-colors",
        active
          ? "bg-muted text-foreground font-semibold"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
      {count !== undefined && count > 0 && (
        <span className="text-muted-foreground ml-auto font-mono text-[10.5px]">{count}</span>
      )}
    </button>
  )
}
