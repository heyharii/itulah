import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { bookPriceColumns, scope } from "@/components/commercial/columns"
import {
  CommercialTable,
  useCommercialTable,
} from "@/components/commercial/data-table"
import type { BookPriceRule, PriceBookDetail } from "@/lib/commercial"
import { money, units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { useMemo } from "react"

/// Everything one price book says.
///
/// The list gave a name, a version and a count, which is enough to know a book
/// exists and nothing about what it does. There was no way to read back a
/// markdown, a promotion or a coupon once authored — so the only record of what
/// a published book contained was the JSON somebody had posted, if they kept
/// it, and the book itself is immutable.
///
/// This is deliberately the same data a shop is sent, minus the per-shop
/// filtering: what you read here is what a till received, rather than a second
/// rendering that could describe it differently.
export function BookPanel({ book }: { book: PriceBookDetail }) {
  const draft = book.status === "DRAFT"
  // The only list in a book that can run to thousands, and the only one worth
  // sorting: checking a book before it goes out means looking for the price
  // that is wrong, which is a sort by price and not a scroll.
  const prices = useCommercialTable({
    data: useMemo(() => [...book.price_rules], [book.price_rules]),
    columns: bookPriceColumns,
    getRowId: priceRuleId,
  })
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-3.5 py-2.5 text-[0.71875rem]">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              draft ? "bg-[var(--os-warn,#c9892e)]" : "bg-[var(--os-ok,#36b827)]"
            )}
          />
          {draft ? "Draft" : "Published"}
        </span>
        <span className="text-muted-foreground">
          In force {new Date(book.effective_from).toLocaleDateString("id-ID")}
          {book.effective_to === null
            ? " onward"
            : ` → ${new Date(book.effective_to).toLocaleDateString("id-ID")}`}
        </span>
        <span className="text-muted-foreground">
          Written by {book.created_by}
          {book.published_by !== null && ` · published by ${book.published_by}`}
        </span>
      </div>

      {/* Published and in force are different things, and this is the
          difference. A book with nobody here has been approved and is charging
          nowhere. */}
      <Section
        title="In service at"
        note={
          book.activated_by.length === 0
            ? draft
              ? "Nothing charges from a draft."
              : "No shop has reported putting this book into service. It is published and charging nowhere."
            : undefined
        }
      >
        {book.activated_by.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Shop</TableHead>
                <TableHead className="text-right">Prices received</TableHead>
                <TableHead>Since</TableHead>
                <TableHead>Centre heard</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {book.activated_by.map((row) => (
                <TableRow key={row.origin_id}>
                  <TableCell className="font-mono text-[0.6875rem]">
                    {row.site_id ?? row.origin_id}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {units(row.price_rule_count)}
                  </TableCell>
                  <TableCell className="font-mono text-[0.65625rem] text-muted-foreground">
                    {new Date(row.activated_at).toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell className="font-mono text-[0.65625rem] text-muted-foreground">
                    {new Date(row.reported_at).toLocaleString("id-ID")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <Section
        title={`Prices · ${units(book.price_rules.length)}`}
        note={
          book.price_rules.length === 0
            ? "This book changes no price."
            : "A book is a list of changes. Anything it does not name keeps the price the last book gave it."
        }
      >
        {book.price_rules.length > 0 && <CommercialTable table={prices} />}
      </Section>

      {book.markdowns.length > 0 && (
        <Section
          title={`Markdowns · ${units(book.markdowns.length)}`}
          note="A markdown replaces the base price — turun harga, not a discount. Booked as a discount it would inflate both revenue and discount in every report that reads them."
        >
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Markdown</TableHead>
                <TableHead>On</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead className="text-right">New price</TableHead>
                <TableHead>Window</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {book.markdowns.map((row) => (
                <TableRow key={row.markdown_id}>
                  <TableCell className="font-mono text-[0.6875rem]">
                    {row.markdown_id}
                  </TableCell>
                  <TableCell className="text-[0.6875rem]">
                    {row.sku_code !== null ? (
                      <span className="font-mono">{row.sku_code}</span>
                    ) : row.article_code !== null ? (
                      <span>
                        <span className="font-mono">{row.article_code}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          · whole style
                        </span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-[0.6875rem]">{scope(row)}</TableCell>
                  <TableCell className="text-right font-mono text-xs text-[var(--os-warn,#c9892e)] tabular-nums">
                    {money(row.replacement_unit_price_minor)}
                  </TableCell>
                  <TableCell className="font-mono text-[0.65625rem] whitespace-nowrap text-muted-foreground">
                    {new Date(row.effective_from).toLocaleDateString("id-ID")}
                    {row.effective_to === null
                      ? " →"
                      : ` → ${new Date(row.effective_to).toLocaleDateString("id-ID")}`}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {book.campaigns.length > 0 && (
        <Section
          title={`Campaigns · ${units(book.campaigns.length)}`}
          note="The envelope a set of promotions shares: one window, one budget, one switch. A promotion naming a campaign a shop does not hold refuses to apply."
        >
          <ul className="divide-y">
            {book.campaigns.map((campaign) => (
              <li
                key={campaign.campaign_id}
                className="flex flex-col gap-0.5 px-3.5 py-2"
              >
                <span className="text-xs">
                  {campaign.name}{" "}
                  <span className="font-mono text-[0.65625rem] text-muted-foreground">
                    {campaign.campaign_id} · {campaign.status}
                  </span>
                </span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  {campaign.budget_minor === null
                    ? "No budget"
                    : `Budget ${money(campaign.budget_minor)}`}
                  {campaign.max_uses !== null &&
                    ` · at most ${units(campaign.max_uses)} uses`}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {book.rules.length > 0 && (
        <Section
          title={`Promotions · ${units(book.rules.length)}`}
          note="Stored as the pricing engine's own document. Shown as it was authored rather than field by field: the shape belongs to that engine, and a second reading of it here would be a second opinion about what a promotion does."
        >
          <ul className="divide-y">
            {book.rules.map((rule) => (
              <li
                key={rule.rule_id}
                className="flex flex-col gap-1 px-3.5 py-2"
              >
                <span className="text-xs">
                  {rule.name}{" "}
                  <span className="font-mono text-[0.65625rem] text-muted-foreground">
                    {rule.rule_id} · {rule.status}
                  </span>
                </span>
                <pre className="overflow-x-auto rounded bg-muted/50 p-2 font-mono text-[0.65625rem] leading-relaxed">
                  {JSON.stringify(rule.definition, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {book.coupons.length > 0 && (
        <Section
          title={`Coupons · ${units(book.coupons.length)}`}
          note="A code is a gate and never a discount of its own: one place calculates a benefit, so a code cannot disagree with the promotion it unlocks."
        >
          <ul className="divide-y">
            {book.coupons.map((coupon) => (
              <li
                key={coupon.code}
                className="flex items-baseline justify-between gap-3 px-3.5 py-1.5"
              >
                <span className="font-mono text-[0.6875rem]">{coupon.code}</span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  unlocks {coupon.rule_id}
                  {coupon.customer_id === null
                    ? " · bearer"
                    : ` · ${coupon.customer_id}`}
                  {coupon.max_uses !== null &&
                    ` · ${units(coupon.max_uses)} uses`}
                  {!coupon.active && " · inactive"}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}

/// A book names a price once per product, per channel, per scope — which is
/// the composite the server writes and the one thing here that is unique.
function priceRuleId(rule: BookPriceRule): string {
  return `${rule.sku_code}:${rule.channel}:${rule.site_id ?? "*"}`
}

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children?: React.ReactNode
}) {
  return (
    <div className="border-t">
      <div className="px-3.5 pt-2 pb-1">
        <h2 className="text-xs font-semibold">{title}</h2>
        {note !== undefined && (
          <p className="text-[0.6875rem] text-muted-foreground">{note}</p>
        )}
      </div>
      {children}
    </div>
  )
}
