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
import type { PriceBook, PublishReceipt } from "@/lib/commercial"
import { listPriceBooks, priceBooksKey, publishPriceBook } from "@/lib/commercial"
import { useIdentity } from "@/lib/identity"
import { units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, CheckCircle2, Send, Tag } from "lucide-react"
import { useRef, useState } from "react"

/// Every price book the centre has written, and which of them the shops have.
///
/// A book is a list of changes, not a full replacement: anything it does not
/// mention keeps the price the last published book gave it, and the newest book
/// that names a product wins. That is why `offer_count` here is the size of the
/// change and never the size of the range — a book of twenty prices is a normal
/// book, and a book of five thousand is somebody restating what had not changed.
///
/// Publishing is the act this screen exists for. It is not a status change: the
/// server queues the book to every shop inside the same transaction that
/// publishes it, so either the book is published and on its way to the whole
/// fleet or neither happened. Before that dispatch existed, a price approved at
/// the centre stayed at the centre and the fleet went on selling at whatever it
/// had been selling at — with nothing on any screen to say so.
export function PriceBooksView() {
  const queryClient = useQueryClient()
  const identity = useIdentity()
  const books = useQuery({ queryKey: priceBooksKey(), queryFn: ({ signal }) => listPriceBooks(signal) })

  const [receipt, setReceipt] = useState<PublishReceipt | null>(null)
  // One key per attempt, replaced only once the server has answered. A
  // double-clicked Publish publishes once and gets the same receipt twice.
  const key = useRef(crypto.randomUUID())

  const publish = useMutation({
    mutationFn: (id: string) =>
      publishPriceBook(id, identity.data?.username ?? "", key.current),
    onSuccess: (result) => {
      key.current = crypto.randomUUID()
      setReceipt(result)
      void queryClient.invalidateQueries({ queryKey: priceBooksKey() })
      // Every price on every shop screen may have just changed.
      void queryClient.invalidateQueries({ queryKey: ["commercial", "offers"] })
    },
  })

  const rows = books.data ?? []
  const drafts = rows.filter((row) => row.status === "DRAFT").length
  const canPublish = identity.data?.role === "SUPERVISOR" || identity.data?.role === "ADMIN"

  return (
    <AppShell nav={<Nav />}>
      <ScreenHeader
        title="Price books"
        subtitle={
          books.isPending
            ? "loading…"
            : `${units(rows.length)} book${rows.length === 1 ? "" : "s"}` +
              (drafts > 0 ? ` · ${units(drafts)} waiting to go out` : "")
        }
      >
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/commercial" />}
        >
          <Tag className="size-3.5" />
          Prices
        </Button>
      </ScreenHeader>

      {receipt !== null && <Delivery receipt={receipt} onDismiss={() => setReceipt(null)} />}

      {publish.isError && (
        <div className="text-destructive border-b px-3.5 py-2 text-[11.5px]">
          {publish.error instanceof ApiError
            ? publish.error.message
            : "The book could not be published."}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {books.isPending ? (
          <ScreenState>Loading the books…</ScreenState>
        ) : books.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button size="sm" variant="outline" onClick={() => void books.refetch()}>
                Try again
              </Button>
            }
          >
            {books.error instanceof ApiError
              ? books.error.message
              : "The books could not be loaded."}
          </ScreenState>
        ) : rows.length === 0 ? (
          <ScreenState>
            No price book has been written. Setting up an article publishes its first one.
          </ScreenState>
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="hover:bg-transparent">
                <TableHead>Book</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Prices</TableHead>
                <TableHead>In force</TableHead>
                <TableHead>Written by</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((book) => (
                <BookRow
                  key={book.id}
                  book={book}
                  canPublish={canPublish}
                  busy={publish.isPending && publish.variables === book.id}
                  onPublish={() => publish.mutate(book.id)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </AppShell>
  )
}

function BookRow({
  book,
  canPublish,
  busy,
  onPublish,
}: {
  book: PriceBook
  canPublish: boolean
  busy: boolean
  onPublish: () => void
}) {
  const draft = book.status === "DRAFT"
  return (
    <TableRow className={cn(draft && "bg-amber-50/40 dark:bg-amber-950/10")}>
      <TableCell className="font-mono text-xs font-medium">v{book.version}</TableCell>
      <TableCell className="max-w-64 truncate text-xs">{book.name}</TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap">
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full",
              draft ? "bg-amber-500" : "bg-emerald-500",
            )}
          />
          {draft ? "Draft" : "Published"}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-xs tabular-nums">
        {units(book.offer_count)}
      </TableCell>
      <TableCell className="text-muted-foreground font-mono text-[11px] whitespace-nowrap">
        {new Date(book.effective_from).toLocaleDateString("id-ID")}
        {book.effective_to === null
          ? " →"
          : ` → ${new Date(book.effective_to).toLocaleDateString("id-ID")}`}
      </TableCell>
      <TableCell className="text-muted-foreground text-[11px]">
        <div className="flex flex-col">
          <span>{book.created_by}</span>
          {book.published_by !== null && book.published_by !== book.created_by && (
            <span className="text-[10.5px]">published by {book.published_by}</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        {draft && (
          <Button size="sm" disabled={!canPublish || busy} onClick={onPublish}>
            <Send className="size-3.5" />
            {busy ? "Sending…" : "Publish"}
          </Button>
        )}
      </TableCell>
    </TableRow>
  )
}

/// Who the book actually reached.
///
/// The count is the point, and so is a count of nought. A book published to no
/// shops is published — the status says so, the immutability trigger enforces
/// it — and no till will ever charge from it, which is a thing you want to
/// learn on this screen rather than from a customer.
function Delivery({
  receipt,
  onDismiss,
}: {
  receipt: PublishReceipt
  onDismiss: () => void
}) {
  const reached = receipt.delivered_to.length
  const nobody = reached === 0
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-b px-3.5 py-2 text-[11.5px]",
        nobody
          ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-400"
          : "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400",
      )}
      role="status"
    >
      {nobody ? (
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
      ) : (
        <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" />
      )}
      <div className="min-w-0">
        <p>
          Book v{receipt.version} published with {units(receipt.offer_rule_count)} price
          {receipt.offer_rule_count === 1 ? "" : "s"}
          {nobody
            ? " — and queued for no shop at all. Nothing will charge from it until a STORE node is registered."
            : ` and queued for ${units(reached)} shop${reached === 1 ? "" : "s"}.`}
        </p>
        {!nobody && (
          <p className="mt-0.5 font-mono text-[10.5px] opacity-80">
            {receipt.delivered_to.join(" · ")}
          </p>
        )}
        {!nobody && (
          <p className="mt-0.5 opacity-80">
            Queued, not yet in force: a shop applies a book when it next syncs, and charges
            the previous one until it does.
          </p>
        )}
      </div>
      <button type="button" onClick={onDismiss} className="ml-auto shrink-0 underline">
        Dismiss
      </button>
    </div>
  )
}
