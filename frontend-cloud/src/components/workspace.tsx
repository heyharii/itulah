import { OrderDetail } from "@/components/po/order-detail"
import { PoDraft } from "@/components/po/po-draft"
import { PurchaseOrdersView } from "@/components/po/purchase-orders-view"
import { BasketView } from "@/components/sourcing/basket-view"
import { SourcingView } from "@/components/sourcing/sourcing-view"
import { useBasket } from "@/lib/basket"
import { cn } from "@/lib/utils"
import { ClipboardList, Shirt, ShoppingBasket } from "lucide-react"
import { useState } from "react"

/// Where the buyer is.
///
/// Held in React state rather than the URL, and that is a real limitation worth
/// naming: a draft cannot be linked to or reloaded into, and the back button
/// leaves the app. It is state a router would own, and this shape — one
/// discriminated union, changed only through `setView` — is what a router's
/// routes would be derived from when one is added.
type View =
  | { name: "sourcing" }
  | { name: "basket" }
  | { name: "orders" }
  | { name: "order"; id: string }
  | { name: "draft"; supplierId: string; quantities: Record<string, number> }

export function Workspace() {
  const [view, setView] = useState<View>({ name: "sourcing" })
  const basket = useBasket()
  const pieces = (basket.data ?? []).reduce((sum, line) => sum + line.quantity, 0)

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
        icon={
          <ShoppingBasket className={cn("size-4", pieces > 0 && "text-emerald-600")} />
        }
        active={view.name === "basket"}
        // Pieces, not lines: a basket holding three of one thing is not the
        // same errand as one of three things, and the piece count is what turns
        // into ordered quantity.
        count={pieces}
        onClick={() => setView({ name: "basket" })}
      >
        Basket
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

  switch (view.name) {
    case "sourcing":
      return <SourcingView nav={nav} onOpenBasket={() => setView({ name: "basket" })} />
    case "basket":
      return (
        <BasketView
          nav={nav}
          onDraft={(supplierId, quantities) =>
            setView({ name: "draft", supplierId, quantities })
          }
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
          seedQuantities={view.quantities}
          onCancel={() => setView({ name: "basket" })}
          onCreated={(id) => {
            // The order's own screen is the confirmation: it shows the number,
            // the lines, and that nothing has arrived against it yet. The
            // basket lines that became the order are cleared by the draft
            // itself, which knows which ones actually went on it.
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
