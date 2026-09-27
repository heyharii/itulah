import { Inbox, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { ListGroup } from "@/components/ui/list"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@itulah/contract/client"

/// Placeholder rows in the shape of the rows that are coming, so the list
/// does not jump when they land.
export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <ListGroup aria-busy>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3.5 px-3 py-3">
          <Skeleton className="size-11 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </ListGroup>
  )
}

/// Nothing here yet — said plainly, centred, with the one thing that would
/// change it.
export function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-card bg-canvas px-6 py-10 text-center shadow-soft">
      <span className="mb-2 flex size-12 items-center justify-center rounded-full bg-soft-2">
        <Inbox className="size-5 text-mute" strokeWidth={1.75} />
      </span>
      <p className="text-card-title font-semibold text-ink">{title}</p>
      <p className="max-w-[16rem] text-meta text-body">{description}</p>
    </div>
  )
}

/// A refusal, turned into a sentence a shopper can act on.
///
/// The server words its refusals in English for the people who run the
/// system; this surface is Indonesian and for the people who shop, so the
/// status becomes a sentence here rather than the operator's text on screen.
export function ErrorState({
  error,
  notFound = "Data yang kamu cari tidak ditemukan.",
  onRetry,
}: {
  error: unknown
  notFound?: string
  onRetry?: () => void
}) {
  const status = error instanceof ApiError ? error.status : 0
  const message =
    status === 404
      ? notFound
      : status === 401
        ? "Sesi kamu sudah berakhir. Muat ulang halaman untuk masuk lagi."
        : status === 0 || status >= 500
          ? "Server sedang bermasalah atau tidak terjangkau. Coba lagi sebentar lagi."
          : "Permintaannya tidak bisa diproses sekarang."

  // A refusal that will not change on a second attempt does not offer a retry
  // button: pressing it would fail identically and teach the reader nothing.
  const worthRetrying = !(error instanceof ApiError) || error.worthRetrying

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card bg-canvas px-5 py-6 text-center shadow-soft"
    >
      <p className="max-w-[18rem] text-nav text-bad-fg">{message}</p>
      {onRetry !== undefined && worthRetrying && (
        <Button size="sm" variant="soft" onClick={onRetry}>
          <RefreshCw />
          Coba lagi
        </Button>
      )}
    </div>
  )
}
