import { RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ApiError } from "@itulah/contract/client"

/// The four states every screen here has, in one place.
///
/// Loading, empty, failed and loaded are not decoration: a member opening this
/// on shop wifi will meet all four, and a screen that only draws the last one
/// shows a blank page for the other three with nothing to do about it.

export function LoadingRows({ rows = 3 }: { rows?: number }) {
  return (
    <Card className="divide-y divide-hairline p-1.5">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-3 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-3.5 w-20" />
        </div>
      ))}
    </Card>
  )
}

export function EmptyState({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <Card className="flex flex-col items-center gap-1.5 border-dashed bg-soft px-6 py-10 text-center shadow-none">
      <p className="text-card-title font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-meta text-body">{description}</p>
    </Card>
  )
}

/// What went wrong, said in the language this surface speaks.
///
/// The operator consoles repeat the server's own message, because an operator
/// can act on "conflict: sealed carton" and the exact words matter when they
/// raise it with somebody. This surface does the opposite: the server writes
/// its refusals in English for the people who run the system, and
/// "not found: transaction" in the middle of an Indonesian screen tells a
/// shopper nothing and looks broken. So the status becomes a sentence a
/// shopper can act on, and the server's wording stays in the network tab where
/// whoever is debugging will look for it anyway.
export function ErrorState({
  error,
  notFound = "Data yang kamu cari tidak ditemukan.",
  onRetry,
}: {
  error: unknown
  /// What a 404 means on THIS screen. A missing receipt and a missing member
  /// are different sentences to the person reading them.
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
      className="flex flex-col items-start gap-3 rounded-card border border-hairline bg-bad-bg px-4 py-4"
    >
      <p className="text-bad-fg">{message}</p>
      {onRetry !== undefined && worthRetrying && (
        <Button size="sm" onClick={onRetry}>
          <RefreshCw />
          Coba lagi
        </Button>
      )}
    </div>
  )
}
