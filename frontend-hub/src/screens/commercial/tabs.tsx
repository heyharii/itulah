import { useNavigate } from "@tanstack/react-router"

import { SubTabs } from "@/components/ui/sub-tabs"

/// The four surfaces of Commercial, in the order the work happens.
///
/// **Pricelist → Promotions → Campaign → Vouchers.** A price exists before
/// anything can come off it, a promotion is the thing that comes off, a campaign
/// is the envelope several promotions are run and budgeted as one thing inside,
/// and a voucher is not pricing at all — see below.
///
/// A coupon is deliberately absent. It is a *gate* on a promotion, not a thing
/// of its own: a rule carrying a code is shut until somebody presents that code,
/// which is a column on the Promotions list and a field on its form. Giving it a
/// tab would imply a coupon can exist without a promotion to unlock, and one
/// cannot.
///
/// A voucher, by contrast, earns its own tab precisely because it is *not* one
/// of the other three. It carries money — it is tender, sitting beside cash and
/// a card at the counter — where the first three all describe what something
/// costs. Filing it under pricing is the mistake the system this replaces made,
/// and it is why a clearance there was booked as a discount.
const TABS = [
  { value: "/commercial", label: "Pricelist" },
  { value: "/commercial/promotions", label: "Promotions" },
  { value: "/commercial/campaigns", label: "Campaign" },
  { value: "/commercial/vouchers", label: "Vouchers" },
] as const

/// Tabs that navigate, rather than tabs that switch a variable.
///
/// Each surface keeps its own route, so a link to a promotion still opens on
/// the promotion, the browser's back button still means what it says, and a
/// sheet parameter belongs unambiguously to one screen. Only the sidebar row
/// went away.
export function CommercialTabs({ current }: { current: string }) {
  const navigate = useNavigate()

  return (
    <SubTabs
      // `<SubTabs>` scrolls horizontally for modules with more tabs than fit.
      // Four always fit, so the scroller only ever drew its own bar — a stray
      // grey stub at the right-hand end of the strip. Hidden rather than the
      // overflow removed, because the overflow is the shared component's and
      // belongs to the modules that do need it.
      className="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      tabs={TABS}
      value={current}
      onChange={(path) => {
        if (path === current) return
        // The search string is dropped on purpose. Every key in it — an open
        // sheet, a typed filter — names a record on the screen being left, and
        // carrying `?price=ART-CAP@store-01` onto Promotions would open nothing
        // while looking like it should.
        void navigate({ to: path, search: {} })
      }}
    />
  )
}
