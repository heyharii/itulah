import { AppShell, ScreenBody, ScreenHeader, ScreenState } from "@/components/app-shell"
import { priceBookColumns } from "@/components/commercial/columns"
import { BookSheet } from "@/components/sheets/commercial/book-sheet"
import { useBookSheet } from "@/lib/sheets/commercial"
import {
  CommercialTable,
  useCommercialTable,
} from "@/components/commercial/data-table"
import { Nav } from "@/components/nav"
import { Button } from "@/components/ui/button"
import type { PriceBook, PublishReceipt } from "@/lib/commercial"
import {
  listPriceBooks,
  priceBooksKey,
  publishPriceBook,
} from "@/lib/commercial"
import { useIdentity } from "@/lib/identity"
import { units } from "@/lib/money"
import { cn } from "@/lib/utils"
import { ApiError } from "@itulah/contract/client"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { AlertTriangle, CheckCircle2, Plus, Radio, Tag } from "lucide-react"
import { useMemo, useRef, useState } from "react"

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
  const books = useQuery({
    queryKey: priceBooksKey(),
    queryFn: ({ signal }) => listPriceBooks(signal),
  })

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

  const rows = useMemo(() => [...(books.data ?? [])], [books.data])
  // Opening a book writes a query parameter rather than changing route, so the
  // shelf stays behind it and ↑/↓ compare a book with the one it replaces.
  const sheet = useBookSheet()
  const drafts = rows.filter((row) => row.status === "DRAFT").length
  const canPublish =
    identity.data?.role === "SUPERVISOR" || identity.data?.role === "ADMIN"

  // Which book is currently going out, so only its own button says "Sending…".
  const publishing = publish.isPending ? (publish.variables ?? null) : null
  const send = publish.mutate
  const columns = useMemo(
    () => priceBookColumns({ canPublish, publishing, onPublish: send }),
    [canPublish, publishing, send]
  )
  // Newest first, which is the order the centre thinks in: the book somebody
  // has just written and not yet sent is the one they came here for.
  const table = useCommercialTable({
    data: rows,
    columns,
    getRowId: bookId,
    sorting: [{ id: "version", desc: true }],
  })

  /// The shelf as ids, in the order it is sorted, so the sheet's ↑/↓ compare a
  /// book with the one next to it. Read straight off the row model rather than
  /// memoised on the table: sorting the shelf produces a new order, and a list
  /// cached against the instance would keep walking the old one.
  const bookIds = table.getRowModel().rows.map((row) => row.original.id)

  return (
    <AppShell data-cloudhub nav={<Nav />}>
      <ScreenHeader
        eyebrow="Commercial"
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
          nativeButton={false}
          render={<Link to="/commercial/books/new" />}
        >
          <Plus className="size-3.5" />
          Write a book
        </Button>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          render={<Link to="/commercial/fleet" />}
        >
          <Radio className="size-3.5" />
          Fleet
        </Button>
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

      {receipt !== null && (
        <Delivery receipt={receipt} onDismiss={() => setReceipt(null)} />
      )}

      {publish.isError && (
        <div className="border-b px-3.5 py-2 text-[0.71875rem] text-destructive">
          {publish.error instanceof ApiError
            ? publish.error.message
            : "The book could not be published."}
        </div>
      )}

      <ScreenBody>
        {books.isPending ? (
          <ScreenState>Loading the books…</ScreenState>
        ) : books.isError ? (
          <ScreenState
            tone="problem"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => void books.refetch()}
              >
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
            No price book has been written. Setting up an article publishes its
            first one.
          </ScreenState>
        ) : (
          <CommercialTable
            table={table}
            onRowClick={(row) => sheet.open(row.original.id)}
            rowClassName={(row) =>
              row.original.status === "DRAFT"
                ? "bg-[var(--os-warn-bg,#faeacd)]/40"
                : undefined
            }
          />
        )}
      </ScreenBody>
      <BookSheet rows={bookIds} />
    </AppShell>
  )
}

/// A book is identified by its id and not its version: two drafts can be
/// written before either is published, and until one of them goes out the
/// version is not yet the thing that tells them apart.
function bookId(book: PriceBook): string {
  return book.id
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
        "flex items-start gap-2 border-b px-3.5 py-2 text-[0.71875rem]",
        nobody
          ? "bg-[var(--os-warn-bg,#faeacd)] text-[var(--os-warn,#c9892e)]"
          : "bg-[var(--os-ok-bg,#d9f4d2)] text-[var(--os-ok,#36b827)]"
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
          Book v{receipt.version} published with{" "}
          {units(receipt.offer_rule_count)} price
          {receipt.offer_rule_count === 1 ? "" : "s"}
          {nobody
            ? " — and queued for no shop at all. Nothing will charge from it until a STORE node is registered."
            : ` and queued for ${units(reached)} shop${reached === 1 ? "" : "s"}.`}
        </p>
        {!nobody && (
          <p className="mt-0.5 font-mono text-[0.65625rem] opacity-80">
            {receipt.delivered_to.join(" · ")}
          </p>
        )}
        {!nobody && (
          <p className="mt-0.5 opacity-80">
            Queued, not yet in force: a shop applies a book when it next syncs,
            and charges the previous one until it does.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="ml-auto shrink-0 underline"
      >
        Dismiss
      </button>
    </div>
  )
}
