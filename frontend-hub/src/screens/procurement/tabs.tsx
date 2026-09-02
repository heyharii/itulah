import { useNavigate } from "@tanstack/react-router"

import { SubTabs } from "@/components/ui/sub-tabs"

/// The three surfaces of Procurement, in the order the work happens.
///
/// **Sourcing → Purchase orders → Suppliers.** You find the goods, you order
/// them, and behind both sits the list of firms you are allowed to order from.
/// A buyer's day is those three things; everything else purchasing does is a
/// detail of one of them.
///
/// The module used to carry eight rows in a sidebar — the four above plus
/// Outstanding, Price amendments, Catalogue and Destinations, filed under a
/// "Master data" heading. Eight rows is not navigation, it is a table of
/// contents, and it made the module look like eight jobs when it is one.
///
/// The other paths are still declared in `nav.ts` and still routed, so links
/// into them keep working and ⌘K still finds them — they are simply not on the
/// strip. That is deliberate rather than lazy: three of them own writes nothing
/// else in the app can perform, so removing the route would remove the
/// capability, which is a bigger decision than tidying a sidebar.
const TABS = [
  { value: "/procurement", label: "Sourcing" },
  { value: "/procurement/orders", label: "Purchase orders" },
  { value: "/procurement/suppliers", label: "Suppliers" },
] as const

/// Tabs that navigate, rather than tabs that switch a variable.
///
/// Each surface keeps its own route, so a link to an order still opens on that
/// order, the back button still means what it says, and a sheet parameter
/// belongs unambiguously to one screen. Only the sidebar went away.
export function ProcurementTabs({ current }: { current: string }) {
  const navigate = useNavigate()

  return (
    <SubTabs
      // Three always fit, so the shared component's horizontal scroller only
      // ever drew its own bar — a grey stub at the right-hand end.
      className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      tabs={TABS}
      value={current}
      onChange={(path) => {
        if (path === current) return
        // The search string is dropped on purpose. Every key in it names a
        // record on the screen being left — an open sheet, a typed filter — and
        // carrying `?item=…` onto Suppliers would open nothing while looking
        // like it should.
        void navigate({ to: path, search: {} })
      }}
    />
  )
}
