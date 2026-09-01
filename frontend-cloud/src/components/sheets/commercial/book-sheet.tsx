import { BookPanel } from "@/components/commercial/book-panel"
import { SheetShell } from "@/components/sheets/sheet-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { priceBookDetail, priceBookKey } from "@/lib/commercial"
import { useBookSheet } from "@/lib/sheets/commercial"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"

/// One price book, opened over the shelf of them.
///
/// Checking a book before it goes out means comparing it with the one it
/// replaces, and as a route that was two navigations and a lost scroll each
/// time. ↑/↓ put the two versions a keystroke apart.
export function BookSheet({ rows }: { rows: readonly string[] }) {
  const sheet = useBookSheet()
  const publicationId = sheet.publicationId
  const book = useQuery({
    queryKey: priceBookKey(publicationId ?? ""),
    queryFn: ({ signal }) => priceBookDetail(publicationId ?? "", signal),
    enabled: publicationId !== null,
  })
  const detail = book.data

  return (
    <SheetShell
      open={publicationId !== null}
      onClose={sheet.close}
      title={
        detail === undefined ? (
          <Skeleton className="h-4 w-24" />
        ) : (
          `Book v${detail.version}`
        )
      }
      subtitle={detail?.name}
      description="One price book: every markdown, promotion and coupon a till was sent."
      rows={rows}
      current={publicationId}
      onMove={sheet.open}
      className="sm:max-w-4xl"
    >
      {book.isError ? (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-xs text-destructive">
            {book.error instanceof ApiError
              ? book.error.message
              : "The book could not be read."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void book.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : detail === undefined ? (
        <p className="p-10 text-center text-xs text-muted-foreground">
          Opening the book…
        </p>
      ) : (
        // Keyed by the publication, so the next book starts from an unsorted
        // price table rather than inheriting the last one's sort.
        <BookPanel key={detail.id} book={detail} />
      )}
    </SheetShell>
  )
}
