import { AppShell, ScreenHeader, ScreenState } from "@/components/app-shell"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/custom/table"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import type { PriceBookDetail } from "@/lib/commercial"
import { priceBookDetail, priceBookKey } from "@/lib/commercial"
import { money, units } from "@/lib/money"
import { priceBookRoute } from "@/router"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { BookOpen } from "lucide-react"

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
export function BookDetailView() {
  const { publicationId } = priceBookRoute.useParams()
  const book = useQuery({
    queryKey: priceBookKey(publicationId),
    queryFn: ({ signal }) => priceBookDetail(publicationId, signal),
  })

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title={book.data === undefined ? "Price book" : `Book v${book.data.version}`}
        subtitle={book.data?.name}
      >
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/commercial/books" />}
        >
          <BookOpen className="size-3.5" />
          All books
        </Button>
      </ScreenHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        {book.isPending ? (
          <ScreenState>Opening the book…</ScreenState>
        ) : book.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void book.refetch()}>
                Try again
              </Button>
            }
          >
            {book.error instanceof ApiError
              ? book.error.message
              : "The book could not be read."}
          </ScreenState>
        ) : (
          <Contents book={book.data} />
        )}
      </div>
    </AppShell>
  )
}

function Contents({ book }: { book: PriceBookDetail }) {
  const draft = book.status === "DRAFT"
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b px-3.5 py-2.5 text-[11.5px]">
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              draft ? "bg-amber-500" : "bg-emerald-500",
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
            <TableHeader className="bg-muted/50">
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
                  <TableCell className="font-mono text-[11px]">
                    {row.site_id ?? row.origin_id}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {units(row.price_rule_count)}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-[10.5px]">
                    {new Date(row.activated_at).toLocaleString("id-ID")}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-[10.5px]">
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
        {book.price_rules.length > 0 && (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>SKU</TableHead>
                <TableHead>Product</TableHead>
                <TableHead>Applies to</TableHead>
                <TableHead>Channel</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead>Tax class</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {book.price_rules.map((rule) => (
                <TableRow key={`${rule.sku_code}:${rule.channel}:${rule.site_id ?? "*"}`}>
                  <TableCell className="font-mono text-[11px]">{rule.sku_code}</TableCell>
                  <TableCell className="max-w-48 truncate text-xs">
                    {rule.article_name}
                  </TableCell>
                  <TableCell className="text-[11px]">{scope(rule)}</TableCell>
                  <TableCell className="text-muted-foreground text-[10.5px]">
                    {rule.channel}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums">
                    {money(rule.unit_price_minor, rule.currency)}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-[10.5px]">
                    {rule.tax_category}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      {book.markdowns.length > 0 && (
        <Section
          title={`Markdowns · ${units(book.markdowns.length)}`}
          note="A markdown replaces the base price — turun harga, not a discount. Booked as a discount it would inflate both revenue and discount in every report that reads them."
        >
          <Table>
            <TableHeader className="bg-muted/50">
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
                  <TableCell className="font-mono text-[11px]">{row.markdown_id}</TableCell>
                  <TableCell className="text-[11px]">
                    {row.sku_code !== null ? (
                      <span className="font-mono">{row.sku_code}</span>
                    ) : row.article_code !== null ? (
                      <span>
                        <span className="font-mono">{row.article_code}</span>
                        <span className="text-muted-foreground"> · whole style</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-[11px]">{scope(row)}</TableCell>
                  <TableCell className="text-right font-mono text-xs tabular-nums text-amber-700 dark:text-amber-500">
                    {money(row.replacement_unit_price_minor)}
                  </TableCell>
                  <TableCell className="text-muted-foreground font-mono text-[10.5px] whitespace-nowrap">
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
              <li key={campaign.campaign_id} className="flex flex-col gap-0.5 px-3.5 py-2">
                <span className="text-xs">
                  {campaign.name}{" "}
                  <span className="text-muted-foreground font-mono text-[10.5px]">
                    {campaign.campaign_id} · {campaign.status}
                  </span>
                </span>
                <span className="text-muted-foreground text-[11px]">
                  {campaign.budget_minor === null
                    ? "No budget"
                    : `Budget ${money(campaign.budget_minor)}`}
                  {campaign.max_uses !== null && ` · at most ${units(campaign.max_uses)} uses`}
                  {campaign.max_uses_per_customer !== null &&
                    ` · ${units(campaign.max_uses_per_customer)} per shopper`}
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
              <li key={rule.rule_id} className="flex flex-col gap-1 px-3.5 py-2">
                <span className="text-xs">
                  {rule.name}{" "}
                  <span className="text-muted-foreground font-mono text-[10.5px]">
                    {rule.rule_id} · {rule.status}
                  </span>
                </span>
                <pre className="bg-muted/50 overflow-x-auto rounded p-2 font-mono text-[10.5px] leading-relaxed">
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
                <span className="font-mono text-[11px]">{coupon.code}</span>
                <span className="text-muted-foreground text-[11px]">
                  unlocks {coupon.rule_id}
                  {coupon.customer_id === null ? " · bearer" : ` · ${coupon.customer_id}`}
                  {coupon.max_uses !== null && ` · ${units(coupon.max_uses)} uses`}
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

/// Which shops or shoppers a row applies to.
///
/// One level only — a row claiming to be both a shop price and a tier price has
/// no single right reading, and the database refuses it.
function scope(row: {
  readonly site_id: string | null
  readonly site_ids: readonly string[] | null
  readonly tier: string | null
}): string {
  if (row.site_id !== null) return row.site_id
  if (row.site_ids !== null && row.site_ids.length > 0)
    return `${row.site_ids.length} shops`
  if (row.tier !== null) return `tier ${row.tier}`
  return "every shop"
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
          <p className="text-muted-foreground text-[11px]">{note}</p>
        )}
      </div>
      {children}
    </div>
  )
}
