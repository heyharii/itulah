import { count } from "@/lib/format"
import type { Found } from "@/components/ui/find"

/// The prose the composer's controls are built out of, and none of the
/// controls themselves.
///
/// Its own module because a file that exports a component AND a plain function
/// loses fast refresh for the whole file — the same reason `button-style.ts`
/// stands apart from `button.tsx`. `controls.tsx` is components; this is what
/// they and the two forms say.
///
/// The calendar arithmetic that used to sit here is now `@/lib/calendar`: it
/// stopped being the composer's when `<Day>` became the whole app's.

/// What a picker's hint says about what has been picked.
export function named(chosen: readonly Found[], noun: string): string {
  if (chosen.length === 0) return `No ${noun} named yet.`
  return `${count(chosen.length)} ${noun}${chosen.length === 1 ? "" : "s"}: ${chosen
    .map((one) => one.label)
    .join(", ")}`
}

/// A list of names as a sentence, capped so a term does not become a paragraph.
///
/// "Menswear and Kids", "Kemeja Katun, Kemeja Flanel and 3 more". The cap is
/// what keeps a rule scoped to forty styles readable as one clause; the exact
/// forty are already on the picker two inches above it.
export function oxford(names: readonly string[], most = 3): string {
  if (names.length === 0) return ""
  if (names.length === 1) return names[0]
  if (names.length <= most) {
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
  }
  return `${names.slice(0, most).join(", ")} and ${count(names.length - most)} more`
}
