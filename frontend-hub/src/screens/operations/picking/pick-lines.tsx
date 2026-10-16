import { Minus, Plus } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/field"
import { Thumbnail } from "@/components/ui/thumbnail"
import { useColourwayFill } from "@/lib/colourway-fill"
import { count, quantity } from "@/lib/format"
import type { Identity } from "@/lib/operations/catalogue"
import { photoPerColour } from "@/lib/operations/photo-key"
import { divisionName, useCatalogueIdentity } from "@/lib/operations/catalogue"
import { ArticleSheet } from "@/screens/master/detail"
import type { PicklistLine } from "@itulah/contract"

/// **What a picker reads at the rack: the article, then each colourway.**
///
/// Owner, 12 Oct 2026: "detail picklistnya kurang… harusnya ada foto product
/// nama product". A picker finds goods by look, so the sheet names the article
/// on top (code · division, supplier) and then draws one block per colourway
/// with its picture — the photograph, or the Garment placeholder painted from
/// the colour master — its sizes and pieces, and rows Size | To pick | Picked.
export function PickLines({
  lines,
  was,
  supplier,
  pickedOf,
  onPicked,
}: {
  lines: readonly PicklistLine[]
  /// What MD's change had before, by SKU: drawn struck through beside To pick.
  was?: ReadonlyMap<string, number>
  supplier: string | null
  pickedOf: (line: PicklistLine) => number
  onPicked: (sku: string, next: number) => void
}) {
  const catalogue = useCatalogueIdentity()
  const fill = useColourwayFill()
  /// The article master sheet, without stock (owner, 16 Oct 2026).
  const [opened, setOpened] = useState<string | null>(null)

  // Article → colourway → its lines, in the order the picklist names them.
  const articles = new Map<
    string,
    { identity: Identity | undefined; colours: Map<string, PicklistLine[]> }
  >()
  for (const line of lines) {
    const identity = catalogue.get(line.sku_code)
    const code = identity?.article_code ?? line.sku_code
    const article = articles.get(code) ?? { identity, colours: new Map() }
    const colour = identity?.colour ?? "—"
    article.colours.set(colour, [...(article.colours.get(colour) ?? []), line])
    articles.set(code, article)
  }

  const perColour = (colours: Map<string, PicklistLine[]>) =>
    photoPerColour(
      [...colours.values()].flat().map((line) => line.sku_code),
      catalogue
    )

  return (
    <div className="flex flex-col gap-6">
      {[...articles].map(([code, { identity, colours }]) => (
        <div key={code} className="flex flex-col gap-4">
          {/* One photo per article beside its name, or one per colour below
          when the colours have photographs of their own (owner, 16 Oct). */}
          <div className="flex items-center gap-3.5">
            <button
              type="button"
              aria-label={`Open ${identity?.article_name ?? code}`}
              onClick={() => setOpened(identity?.article_code ?? code)}
              className="shrink-0"
            >
              <Thumbnail
                url={identity?.image_url ?? null}
                name={identity?.article_name ?? ""}
                division={identity?.division_code}
                colours={fill(identity?.colour ?? null)}
                className="size-16 rounded-inner"
              />
            </button>
            <div className="flex min-w-0 flex-col gap-0.5">
              <button
                type="button"
                onClick={() => setOpened(identity?.article_code ?? code)}
                className="w-fit max-w-full text-left text-[1.25rem] leading-[1.625rem] font-semibold tracking-[-0.01em] text-ink hover:underline"
              >
                {identity?.article_name ?? code}
              </button>
              <div className="text-[0.9375rem] text-body">
                <span className="font-mono">{code}</span>
                {identity?.division_code && (
                  <> · {divisionName(identity.division_code)}</>
                )}
              </div>
              {supplier && (
                <div className="text-[0.9375rem] text-body">{supplier}</div>
              )}
            </div>
          </div>

          {[...colours].map(([colour, list]) => {
            const pieces = list.reduce((sum, line) => sum + line.outstanding, 0)
            return (
              <div
                key={colour}
                className="flex flex-col gap-1.5 border-t border-hairline pt-4"
              >
                <div className="mb-1 flex items-center gap-3.5">
                  {perColour(colours) ? (
                    <Thumbnail
                      url={catalogue.get(list[0]!.sku_code)?.image_url ?? null}
                      name={identity?.article_name ?? ""}
                      division={identity?.division_code}
                      colours={fill(colour === "—" ? null : colour)}
                      className="size-16 shrink-0 rounded-inner"
                    />
                  ) : (
                    <span
                      aria-hidden
                      className="size-3 shrink-0 rounded-full border border-hairline"
                      style={{
                        background: fill(colour === "—" ? null : colour)[0],
                      }}
                    />
                  )}
                  <div className="min-w-0">
                    <div className="text-[1.0625rem] leading-[1.375rem] font-semibold text-ink">
                      {colour}
                    </div>
                    <div className="text-[0.9375rem] text-body">
                      {list.length === 1
                        ? "1 size"
                        : `${count(list.length)} sizes`}{" "}
                      · {quantity(pieces)}
                    </div>
                  </div>
                </div>
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="text-left text-[0.9375rem] text-body">
                      <th className="h-9 pr-2 font-normal">Size</th>
                      <th className="h-9 px-2 text-right font-normal">
                        To pick
                      </th>
                      <th className="h-9 pl-2 text-right font-normal">
                        Picked
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((line) => {
                      const one = catalogue.get(line.sku_code)
                      const value = pickedOf(line)
                      return (
                        <tr
                          key={line.sku_code}
                          className="border-t border-hairline"
                        >
                          <td className="py-2.5 pr-2">
                            <div className="text-[0.9375rem] font-medium text-ink">
                              {one?.size ?? "—"}
                            </div>
                            <div className="font-mono text-[0.9375rem] break-all text-mute">
                              {line.sku_code}
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-right text-[0.9375rem] text-ink tabular-nums">
                            {was?.has(line.sku_code) && (
                              <s className="mr-1.5 text-mute">
                                {count(was.get(line.sku_code))}
                              </s>
                            )}
                            {count(line.outstanding)}
                          </td>
                          <td className="py-2.5 pl-2 text-right">
                            <Stepper
                              label={`${one?.article_name ?? line.sku_code} · ${colour} · ${one?.size ?? ""}`}
                              value={value}
                              max={line.outstanding}
                              onChange={(next) => onPicked(line.sku_code, next)}
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      ))}
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
