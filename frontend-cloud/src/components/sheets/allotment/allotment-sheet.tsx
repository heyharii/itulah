import { AllotmentPanel } from "@/components/allotment/allotment-panel"
import { SheetShell } from "@/components/sheets/sheet-shell"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { allotmentDetail, humanise } from "@/lib/allotments"
import { units } from "@/lib/money"
import { useAllotmentSheet } from "@/lib/sheets/allotment"
import { ApiError } from "@itulah/contract/client"
import { useQuery } from "@tanstack/react-query"

/// One allotment, opened over the list of them.
///
/// This was `/allotments/$allotmentId`. Watching an allotment is not reading a
/// status word — it is seven stage counts and a warehouse that may not have
/// answered yet — so it is checked again and again across a list, and as a
/// route each check threw that list away.
///
/// It keeps polling on a minute, which is the reason this fetch stays here
/// rather than being handed down: the panel is remounted whenever ↑ moves to
/// another allotment, and a poll that restarted with it would never complete.
export function AllotmentSheet({ rows }: { rows: readonly string[] }) {
  const sheet = useAllotmentSheet()
  const allotmentId = sheet.allotmentId
  const allotment = useQuery({
    queryKey: ["allotments", allotmentId],
    queryFn: ({ signal }) => allotmentDetail(allotmentId ?? "", signal),
    enabled: allotmentId !== null,
    refetchInterval: 60_000,
  })
  const detail = allotment.data

  return (
    <SheetShell
      open={allotmentId !== null}
      onClose={sheet.close}
      title={
        detail === undefined ? (
          <Skeleton className="h-4 w-28" />
        ) : (
          <span className="font-mono">{detail.allotment_number}</span>
        )
      }
      subtitle={
        detail === undefined
          ? undefined
          : `${humanise(detail.type)} · ${units(detail.total_quantity)} allotted`
      }
      description="One allotment: what was promised, how far it has got, and who is allowed to move it."
      rows={rows}
      current={allotmentId}
      onMove={sheet.open}
      className="sm:max-w-4xl"
    >
      {allotment.isError ? (
        <div className="flex flex-col items-center gap-3 p-10 text-center">
          <p className="text-xs text-destructive">
            {allotment.error instanceof ApiError
              ? allotment.error.message
              : "The allotment could not be loaded."}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void allotment.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : detail === undefined ? (
        <p className="p-10 text-center text-xs text-muted-foreground">
          Loading the allotment…
        </p>
      ) : (
        // Keyed by the allotment, so ↑ to the next one opens on Lines with no
        // cancellation box half-filled from the last.
        <AllotmentPanel key={detail.id} detail={detail} />
      )}
    </SheetShell>
  )
}
