import {
  Building2,
  FolderTree,
  Library,
  Palette,
  Ruler,
  Shirt,
  Tag,
} from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// This module's row in the sidebar and the sub-items under it.
/// Owned by the module, composed by `lib/navigation.ts` — so adding a screen
/// here never touches another module's file.
///
/// # Master data, and why it is one module rather than six
///
/// Requested by the owner 2026-09-03: Articles, Suppliers, Divisions, Colours,
/// Sizes and Tags in one place. Before this they were scattered by *who used
/// them* — Articles was its own module, Suppliers sat in Procurement, Colours
/// hid under Articles, and Divisions, Sizes and Tags existed only as tables
/// nothing could edit. Grouping them by *what they are* is what makes the last
/// three findable at all.
///
/// **The chart of accounts is deliberately not here.** It is master data by
/// every definition — 7,528 code-and-label rows — but nobody looks for an
/// account outside Finance, and the posting rules that consume it are three
/// rows from it in that module's sidebar. A master-data drawer that pulls a
/// screen away from the only place it is asked for is filing, not navigation.
///
/// # What this reverses, on purpose
///
/// Articles was made a module of its own on 2026-09-02, on the argument that
/// the master product is read by everyone and filing it under one department
/// would make it read as that department's property. That argument still
/// holds — and this module is the version of it that costs nothing, because
/// "Master data" is not a department. Nobody owns it, which is exactly why
/// Procurement, Commercial and Inventory can all reach into it without one of
/// them appearing to lend it out.
///
/// The risk being taken is the other one this repo has already been bitten by:
/// Procurement once filed four screens under a "Master data" heading and they
/// went unread for a month while taking up half the panel (see
/// `procurement/nav.ts`). The difference is that these six are the *subject*
/// of the module rather than an annex to a busier one, and two of them —
/// Articles and Suppliers — are daily screens that keep the row warm.
export const masterNav: AppModule = {
  id: "master",
  label: "Master data",
  icon: Library,
  home: "/master",
  sections: [
    {
      /// The two records. What we sell, and who we buy it from.
      items: [
        { path: "/master", label: "Articles", icon: Shirt },
        { path: "/master/suppliers", label: "Suppliers", icon: Building2 },
      ],
    },
    {
      /// The words those records are described with. Four lists of the same
      /// shape — code, label, order, active — which is why one screen serves
      /// three of them and Colours keeps its own: a colour also carries a hex
      /// value and a preview, and nothing else here has a picture.
      label: "Vocabulary",
      items: [
        { path: "/master/divisions", label: "Divisions", icon: FolderTree },
        { path: "/master/colours", label: "Colours", icon: Palette },
        { path: "/master/sizes", label: "Sizes", icon: Ruler },
        { path: "/master/tags", label: "Tags", icon: Tag },
      ],
    },
  ],
}
