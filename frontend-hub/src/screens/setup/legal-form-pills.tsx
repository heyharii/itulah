import type { LegalForm } from "@/lib/queries/setup"
import { cn } from "@/lib/utils"
import { LEGAL_FORMS } from "@/screens/setup/names"

/// PT · CV · UD · Perorangan, as pills — four short answers that read at a
/// glance, where a dropdown would hide three of them.
export function LegalFormPills({
  value,
  onChange,
}: {
  value: LegalForm | null
  onChange: (value: LegalForm) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Legal form"
      className="flex flex-wrap gap-1.5"
    >
      {LEGAL_FORMS.map((form) => (
        <button
          key={form.value}
          type="button"
          role="radio"
          aria-checked={value === form.value}
          onClick={() => onChange(form.value)}
          className={cn(
            "h-9 rounded-full border px-3.5 text-cell transition-[background-color,border-color,color,scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]",
            value === form.value
              ? "border-ink bg-ink text-cta-fg"
              : "border-hairline-2 bg-canvas text-text hover:border-hairline-strong"
          )}
        >
          {form.label}
        </button>
      ))}
    </div>
  )
}
