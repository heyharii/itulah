import {
  CalendarClock,
  FolderTree,
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
/// The heading they used to sit under — "Vocabulary" — went with it, and what
/// replaces it is a rule rather than a word. A section with no label after the
/// first draws a hairline (see `ModuleScreens` in `components/shell/sidebar`),
/// which says "these belong to the row above" without naming a concept the
/// business does not have.
///
/// **The chart of accounts is deliberately not here.** It is master data by
/// every definition — 7,528 code-and-label rows — but nobody looks for an
/// account outside Finance, and the posting rules that consume it are three
/// rows from it in that module's sidebar.
///
/// **Suppliers left for Procurement** on 2026-09-12, reversing the move that
/// brought it here on 2026-09-03. A supplier is a party the company transacts
/// with, not a word an article is described with, and this module is now the
/// second of those. Its old path redirects — see `moved` on the Procurement
/// item.
export const masterNav: AppModule = {
  id: "master",
  label: "Articles",
  icon: Shirt,
  home: "/master",
  sections: [
    {
      /// The record itself.
      items: [{ path: "/master", label: "Articles", icon: Shirt }],
    },
    {
      /// The four lists an article is described with, in the order the owner
      /// fixed on 2026-09-12: Divisions, Colours, Sizes, Tags. Unlabelled on
      /// purpose — the rule the sidebar draws above them is the whole heading
      /// they need.
      ///
      /// Tags last because it is the loose one: the other three are closed
      /// sets an article has exactly one of (division) or picks from a fixed
      /// vocabulary (colour, size), and a tag is the flexible secondary
      /// classification an article may carry none or several of.
      ///
      /// One screen serves three of them — code, label, order, active is one
      /// shape — and Colours keeps its own, because a colour also carries a
      /// hex value and a preview and nothing else here has a picture.
      items: [
        { path: "/master/divisions", label: "Divisions", icon: FolderTree },
        { path: "/master/colours", label: "Colours", icon: Palette },
        { path: "/master/sizes", label: "Sizes", icon: Ruler },
        { path: "/master/tags", label: "Tags", icon: Tag },
      ],
    },
    {
      /// Payment templates, since the owner moved them here: terms are no
      /// longer chosen on the supplier form or the order composer — Finance
      /// handles payment — so the arrangements are kept as master data. Not an
      /// article's vocabulary, which is why it is a section of its own under
      /// its own rule rather than a fifth item in the list above.
      items: [
        {
          path: "/master/payment-templates",
          label: "Payment templates",
          icon: CalendarClock,
        },
      ],
    },
  ],
}
