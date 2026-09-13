import { Megaphone, Percent, Tags, Ticket } from "lucide-react"
import { lazy } from "react"

import type { Module } from "@/lib/nav"
import { list, oneOf, str } from "@/lib/search-schema"

/// Commercial — what a thing costs, what comes off it, and what a shopper can
/// pay with.
///
/// **Pricelist → Promotions → Campaign → Vouchers**, in the order the work
/// happens. A price exists before anything can come off it; a promotion is the
/// thing that comes off; a campaign is the envelope several promotions are run
/// and budgeted as one thing inside.
///
/// ## Why a coupon is not a fifth row
///
/// It is a **gate** on a promotion, not a thing of its own: a rule carrying a
/// code is shut until somebody presents that code. Giving it a row would imply
/// a coupon can exist without a promotion to unlock, and one cannot — so it is
/// a column on Promotions, and the column says which of three states the gate
/// is in, including the one that matters: a rule naming a code no published
/// book declares, which can never fire.
///
/// ## Why a voucher IS a fourth row
///
/// Precisely because it is not one of the other three. It carries money — it is
/// tender, beside cash and a card at the counter — where the first three all
/// describe what something costs. Filing it under pricing is the mistake the
/// system this replaces made, and it is why a clearance there was booked as a
/// discount and the shop's margin got worse every time somebody spent money the
/// shop was already holding.
///
/// ## No sections
///
/// Four rows do not need three headings. The module's own grouping earns its
/// keep in Finance and People, which have eleven and twenty; here it would name
/// the module twice and then split four items into pairs nobody asked for.
///
/// ## What is not here, and where it went
///
/// **Margin.** It arrived in this module in the app this is ported from, when
/// the Analytics module was dissolved, and it reads
/// `GET /commercial/performance/pricelist` — one style at a time, with a cost
/// basis of `ARTICLE_LATEST_PO`. It is not ported here because it is a
/// different kind of screen: the other four read what the books SAY, and the
/// three performance routes read what the tills DID, over a window, with a
/// `BASKET` attribution that overstates and has to be labelled as overstating
/// on every figure. That is a screen with its own scope line and its own
/// caveats, and folding it in beside four catalogue reads would have put two
/// kinds of truth under one heading.
///
/// **Every write.** Writing a price book, publishing it to the fleet, pausing a
/// rule, switching a campaign, issuing and redeeming a voucher. Each carries an
/// idempotency key for a reason worth reading rather than inheriting — a
/// retried publish is a second book, a retried issue is a gift card the shop
/// never sold. This module is the port of the reads.

const PricelistScreen = lazy(() =>
  import("@/modules/commercial/pricelist").then((m) => ({
    default: m.PricelistScreen,
  })),
)
const PromotionsScreen = lazy(() =>
  import("@/modules/commercial/promotions").then((m) => ({
    default: m.PromotionsScreen,
  })),
)
const CampaignsScreen = lazy(() =>
  import("@/modules/commercial/campaigns").then((m) => ({
    default: m.CampaignsScreen,
  })),
)
const VouchersScreen = lazy(() =>
  import("@/modules/commercial/vouchers").then((m) => ({
    default: m.VouchersScreen,
  })),
)

export const commercialNav: Module = {
  id: "commercial",
  label: "Commercial",
  icon: Tags,
  base: "/commercial",
  sections: [
    {
      items: [
        {
          path: "/commercial",
          label: "Pricelist",
          icon: Tags,
          screen: PricelistScreen,
          /// Every one of these is a parameter `GET /commercial/article-prices`
          /// actually takes. `sort` and `dir` are deliberately absent — the
          /// endpoint has no sort key at all, and a screen that accepted them
          /// in its URL would be promising an ordering it cannot perform.
          ///
          /// `min` and `max` are `str()` rather than `int()` because there is
          /// no integer that means "no bound": `int(0)` would put a floor of
          /// zero on every request nobody had narrowed.
          search: {
            q: str(),
            division: list(),
            tag: list(),
            min: str(),
            max: str(),
            panel: str(),
            article: str(),
          },
        },
        {
          path: "/commercial/promotions",
          label: "Promotions",
          icon: Percent,
          screen: PromotionsScreen,
          /// `status` is the tab and `rule` is which record is open. No `q`,
          /// no `sort`: `GET /commercial/rules` takes no parameters at all,
          /// and the tab narrows a list the endpoint returns whole — see the
          /// screen's header for why that one narrowing is honest and a search
          /// box would not be.
          search: {
            status: oneOf(
              ["", "ACTIVE", "PAUSED", "DRAFT", "EXPIRED"] as const,
              "",
            ),
            rule: str(),
          },
        },
        {
          path: "/commercial/campaigns",
          label: "Campaign",
          icon: Megaphone,
          screen: CampaignsScreen,
          search: {
            status: oneOf(
              [
                "",
                "ACTIVE",
                "SCHEDULED",
                "PAUSED",
                "DRAFT",
                "EXPIRED",
                "CANCELLED",
              ] as const,
              "",
            ),
            campaign: str(),
          },
        },
        {
          path: "/commercial/vouchers",
          label: "Vouchers",
          icon: Ticket,
          screen: VouchersScreen,
          /// All three narrowings are the SERVER's here, which is why `q` is
          /// declared on this screen and on no other in the module. An
          /// unrecognised `status` or `kind` is a 400 rather than a silent
          /// ignore, so both are `oneOf` — a stale bookmark must not be able to
          /// turn a list into an error page.
          search: {
            q: str(),
            status: oneOf(["", "ACTIVE", "SPENT", "VOIDED"] as const, ""),
            kind: oneOf(["", "GIFT_CARD", "REFUND", "GOODWILL"] as const, ""),
            voucher: str(),
          },
        },
      ],
    },
  ],
}
