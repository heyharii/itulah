import {
  Building2,
  CalendarClock,
  FolderTree,
  PackagePlus,
  Palette,
  Ruler,
  Scale,
  Shirt,
  Tag,
  TextCursorInput,
  Warehouse,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"
import { useAwaitingIdentity } from "@/screens/procurement/queue"

/// Delivery lines waiting to be named: the count on New articles, and on the
/// Master row while it is folded.
export const useNewArticlesCount = () =>
  useAwaitingIdentity().data?.length ?? null

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// # Articles, and the four lists it is described with
///
/// The module is named after the record rather than after the filing cabinet.
/// It was "Master data" until 2026-09-12, and the owner's objection was the
/// right one: "master data" is a data-modelling word, not a thing anybody in
/// the business does. Nobody opens the app to visit master data — they open it
/// to look at an article. The four lists under it are how an article is
/// described, so they sit beneath it rather than beside it under a heading
/// that names a category of table.
///
/// The heading they used to sit under — "Vocabulary" — went with it. The old
/// sidebar drew a hairline for a section with no label; the charcoal column
/// (`components/shell/nav-column.tsx`, 2026-09-28) draws a department's own
/// rows flat, in the owner's order, so the grouping is now the order alone.
///
/// **The chart of accounts is deliberately not here.** It is master data by
/// every definition — 7,528 code-and-label rows — but nobody looks for an
/// account outside Finance, and the posting rules that consume it are three
/// rows from it in that module's sidebar.
///
/// **Suppliers came back** on 2026-10-04, when the owner gathered the master
/// tables into one Master department and named this module's home among them
/// ("master supplier, master articles, dan semua master"). It is the row's
/// third filing — here until 2026-09-12, Procurement since, now its own
/// section between the record and the words, because a supplier is still not
/// a word an article is described with. Suppliers is not here: the owner
/// (2026-10-05) keeps it in Procurement only, and `/master/suppliers` redirects
/// there. Divisions, Tags, Sizes and Colours stay in this menu only.
export const masterNav: AppModule = {
  id: "master",
  label: "Articles",
  icon: Shirt,
  home: "/master",
  sections: [
    {
      /// The record itself.
      items: [
        { path: "/master", label: "Articles", icon: Shirt },
        {
          path: "/master/new-articles",
          label: "New Articles",
          icon: PackagePlus,
          useCount: useNewArticlesCount,
          badge: "warn",
        },
      ],
    },
    {
      /// The company itself: head office, the Gudang and every store, the
      /// premises each owns and who is answerable for each (0600-0602) — the
      /// screen has been called Organisation in the code all along. From
      /// System since 2026-10-04 (owner): a register of the company is
      /// master data, and System never showed in the sidebar to offer it.
      /// Its CONSOLE half stays in Sales as Stores — same table, different
      /// job: this registers a unit, Stores watches the shops trade.
      items: [
        {
          path: "/master/organisation",
          label: "Units",
          icon: Building2,
          moved: ["/system/units"],
          // Hidden from the menu (owner, 2026-10-05); the screen and its path
          // still work.
          hidden: true,
        },
      ],
    },
    {
      /// The four lists an article is described with. Owner's menu of
      /// 2026-09-28 reordered the primary row to Divisions, Tags, Sizes,
      /// Colours — the array order below, since primary rows draw flat in
      /// declaration order — superseding the 2026-09-12 order (Divisions,
      /// Colours, Sizes, Tags). Unlabelled on purpose — the rule the sidebar
      /// draws above them is the whole heading they need.
      ///
      /// One screen serves three of them — code, label, order, active is one
      /// shape — and Colours keeps its own, because a colour also carries a
      /// hex value and a preview and nothing else here has a picture.
      items: [
        { path: "/master/divisions", label: "Divisions", icon: FolderTree },
        { path: "/master/tags", label: "Tags", icon: Tag },
        { path: "/master/sizes", label: "Sizes", icon: Ruler },
        { path: "/master/colours", label: "Colors", icon: Palette },
        {
          path: "/master/name-suggestions",
          label: "Name Suggestions",
          icon: TextCursorInput,
        },
      ],
    },
    {
      /// Satuan & conversions — the units an order may be typed in, and how
      /// many pieces each is. Master data rather than a reading, as its own
      /// comment under Inventory always said; in the Master menu since
      /// 2026-10-04, still sought by name — a buyer setting up KODI goes
      /// looking for it. `moved` keeps the inventory path opening the screen.
      items: [
        {
          path: "/master/units",
          label: "Satuan & Conversions",
          icon: Scale,
          moved: ["/inventory/units"],
          hidden: true,
        },
      ],
    },
    {
      /// Destinations — where a delivery may land. Parked hidden under
      /// Procurement "until it has a better home"; this is the home it was
      /// waiting for, so the row shows (owner, 2026-10-04). `moved` keeps
      /// the procurement path opening the screen.
      items: [
        {
          path: "/master/destinations",
          label: "Destinations",
          icon: Warehouse,
          moved: ["/procurement/destinations"],
          hidden: true,
        },
      ],
    },
    {
      /// Payment templates, since the owner moved them here: terms are no
      /// longer chosen on the supplier form or the order composer — Finance
      /// handles payment — so the arrangements are kept as master data. Not an
      /// article's vocabulary, which is why it is a section of its own under
      /// its own rule rather than a fifth item in the list above.
      ///
      /// `more` since the owner's menu of 2026-09-28: sought rarely enough
      /// that it moved under Merchandise's More fold rather than staying a
      /// primary row. Hidden on 2026-09-29 when that fold went; shown again
      /// here on 2026-10-04 — the Master menu is where a master table
      /// belongs, and a row nobody can see is a table nobody keeps.
      items: [
        {
          path: "/master/payment-templates",
          label: "Payment Templates",
          icon: CalendarClock,
          hidden: true,
        },
      ],
    },
  ],
}
