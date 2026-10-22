import { Check, Minus, Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, sku as skuNumber } from "@/lib/format"
import { divisionName, useCatalogueIdentity } from "@/lib/operations/catalogue"
import { ArticleSheet } from "@/screens/master/detail"
import type { PicklistLine } from "@itulah/contract"

/// A code without its leading zeros: 00000004104 reads 4104 (owner, 18 Oct
/// 2026, "ga usah ada 0000 nya").

/// **What a picker reads at the rack: the article, then its colours and
/// sizes with how many of each.**
///
/// Pick per SKU, whole (owner, 21 Oct 2026: "di sebelah quantity ganti ke
/// pick pick pick, yg sudah pick ganti ke picked"): a row's Pick takes its
/// full quantity and turns into Picked (pressed again, it is undone). Nothing
/// is typed. Done sends what is Picked on to Picked.
export function PickLines({
  lines,
  pickedOf,
  onPicked,
  locked = false,
}: {
  lines: readonly PicklistLine[]
  pickedOf: (line: PicklistLine) => number
  onPicked: (sku: string, next: number) => void
  locked?: boolean
}) {
  const catalogue = useCatalogueIdentity()
  const fill = useColourwayFill()
  /// The article master sheet, without stock (owner, 16 Oct 2026).
  const [opened, setOpened] = useState<string | null>(null)

  const first = catalogue.get(lines[0]?.sku_code ?? "")
  const code = first?.article_code ?? lines[0]?.sku_code ?? ""
  const want = lines.reduce((sum, line) => sum + line.outstanding, 0)

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={`Open ${first?.article_name ?? code}`}
          onClick={() => setOpened(first?.article_code ?? code)}
          className="shrink-0"
        >
          <Thumbnail
            url={first?.image_url ?? null}
            name={first?.article_name ?? ""}
            division={first?.division_code}
            colours={fill(first?.colour ?? null)}
            className="size-[2.875rem] rounded-[9px]"
          />
        </button>
        <div className="flex min-w-0 flex-1 flex-col">
          <button
            type="button"
            onClick={() => setOpened(first?.article_code ?? code)}
            className="w-fit max-w-full text-left font-semibold text-ink hover:underline"
          >
            {first?.article_name ?? code}
          </button>
          <div className="text-body">
            {code}
            {first?.division_code && (
              <> · {divisionName(first.division_code)}</>
            )}
          </div>
        </div>
        <div className="shrink-0 text-[1.5rem] leading-[1.4] font-bold text-ink tabular-nums">
          {count(want)}
          <span className="text-[1.0625rem] font-medium text-body">
            {" "}
            {want === 1 ? "pc" : "pcs"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-col">
        {lines.map((line) => {
          const one = catalogue.get(line.sku_code)
          const name =
            [one?.colour, one?.size].filter(Boolean).join(" · ") ||
            skuNumber(line.sku_code)
          return (
            <div
              key={line.sku_code}
              className="border-row-line flex min-h-16 items-center gap-3 border-t"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{name}</span>
                <span className="block text-body tabular-nums">
                  {skuNumber(line.sku_code)}
                </span>
              </span>
              <span className="shrink-0 text-[1.0625rem] font-semibold text-ink tabular-nums">
                {count(line.outstanding)}
              </span>
              {pickedOf(line) >= line.outstanding ? (
                // Picked in green with a red Unpick beside it (owner, 21 Oct
                // 2026), as Pack's Packed · Unpack.
                <span className="flex w-[9.5rem] items-center justify-end gap-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 font-semibold text-ok-fg">
                    <Check className="size-4" aria-hidden />
                    Picked
                  </span>
                  <button
                    type="button"
                    disabled={locked}
                    onClick={() => onPicked(line.sku_code, 0)}
                    className="font-semibold text-bad-fg hover:underline disabled:opacity-50"
                  >
                    Unpick
                  </button>
                </span>
              ) : (
                <span className="flex w-[9.5rem] justify-end">
                  <Button
                    variant="primary"
                    size="card"
                    disabled={locked}
                    onClick={() => onPicked(line.sku_code, line.outstanding)}
                  >
                    Pick
                  </Button>
                </span>
              )}
            </div>
          )
        })}
      </div>

      <ArticleSheet
        articleCode={opened}
        open={opened !== null}
        onClose={() => setOpened(null)}
        stock={false}
        readOnly
      />
    </div>
  )
}

/// What the picker found for one size: minus, the figure, plus. Never above
/// what was wanted, never below nothing; red once it is under. The Pack
/// sheet uses the same one (owner, 16 Oct 2026: "konsisten uinya").
export function Stepper({
  label,
  value,
  max,
  onChange,
  name = "Picked",
  warnUnder = true,
}: {
  label: string
  value: number
  max: number
  onChange: (next: number) => void
  /// What the figure is, for a screen reader: "Picked", "In koli".
  name?: string
  /// Red while under `max`: a pick that is short. A koli is not.
  warnUnder?: boolean
}) {
  const set = (next: number) => onChange(Math.max(0, Math.min(max, next)))
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant="ghost"
        aria-label="One less"
        disabled={value <= 0}
        onClick={() => set(value - 1)}
      >
        <Minus />
      </Button>
      <Input
        aria-label={name}
        inputMode="numeric"
        padLabel={label}
        value={String(value)}
        onChange={(event) => set(Number(event.target.value.replace(/\D/g, "")))}
        onFocus={(event) => event.target.select()}
        className={`w-14 text-center tabular-nums ${warnUnder && value < max ? "text-bad-fg" : ""}`}
      />
      <Button
        variant="ghost"
        aria-label="One more"
        disabled={value >= max}
        onClick={() => set(value + 1)}
      >
        <Plus />
      </Button>
    </span>
  )
}
