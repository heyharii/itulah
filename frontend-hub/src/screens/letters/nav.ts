import { FileSignature } from "lucide-react"

import type { AppModule } from "@/lib/navigation"

/// Letters — the paperwork somebody signs.
///
/// Asked for by the owner on 2026-09-13: "kita ga ada menu surat ya, kita mau
/// ada menu surat, misal surat terima barang, dan surat2 yg lain".
///
/// # Why one module and not a Print button on two other screens
///
/// Both letters could have been a button — one on the receiving screen, one on
/// the allotment. That is how most systems grow them, and it is why most
/// systems cannot answer "which letters went out last month", "was STB
/// 2609/0004 ever issued", or "who signed for that delivery". A letter has a
/// number, a series and a register; a button has none of those, and the
/// register is the thing an auditor actually asks for.
///
/// # Why it stands beside Discussions and the Library rather than in Buying
///
/// Because the two kinds would otherwise be split across two departments — a
/// goods receipt note is Buying's, a delivery note is Merchandise's — and the
/// person who files them is the same person either way. What they have in
/// common is that they are DOCUMENTS, which is what this corner of the app is
/// already for.
export const lettersNav: AppModule = {
  id: "letters",
  label: "Letters",
  icon: FileSignature,
  home: "/letters",
  // The documents close the GA list, below the registers (owner, 2026-09-27).
  divider: true,
  sections: [
    {
      items: [{ path: "/letters", label: "Letters", icon: FileSignature }],
    },
  ],
}
