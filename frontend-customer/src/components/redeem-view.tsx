import { ScreenTitle } from "@/components/app-shell"
import { MattePicture } from "@/components/matte"
import { NumberTicker } from "@/components/motion/number-ticker"
import { AskPanel } from "@/components/redeem-ask"
import { ErrorState, LoadingRows } from "@/components/states"
import { Card } from "@/components/ui/card"
import { ListGroup, ListRow } from "@/components/ui/list"
import { Pill } from "@/components/ui/pill"
import { Skeleton } from "@/components/ui/skeleton"
import { rowDate } from "@/lib/dates"
import { money, units } from "@/lib/money"
import { usePointsFeed } from "@/lib/points-feed"
import { WATCH_MS, useLiveAsk } from "@/lib/redeem-asks"
import { cn } from "@/lib/utils"
import type { RedeemRequest } from "@itulah/contract"

/// Points redemption: a balance, the cashier's ask when there is one, and the
/// history of every ask.
///
/// The shopper never starts a redemption and never says how many points. The
/// cashier asks at the till — the number is the cashier's — and the shopper
/// answers here (`redeem-ask.tsx`), or reads back the code WhatsApp sent them
/// and never touches this screen at all. Both end in the same place: the
/// centre spends the points and the till finds the voucher
/// (`postgres/loyalty.rs::confirm_redeem_request`).
///
/// The rate — how many points buy how much — is decided once, at the centre.
/// Nothing on this screen states one, because nothing here decides one.

const STATUS_LABEL: Record<RedeemRequest["status"], string> = {
  PENDING: "Menunggu",
  CONFIRMED: "Ditukar",
  // The server records a refusal by the shopper and a withdrawal by the
  // cashier as one thing, so the word has to be true of both.
  CANCELLED: "Dibatalkan",
  EXPIRED: "Kedaluwarsa",
}

const STATUS_TONE: Record<RedeemRequest["status"], "warn" | "ok" | "bad" | "soft"> = {
  PENDING: "warn",
  CONFIRMED: "ok",
  CANCELLED: "soft",
  EXPIRED: "soft",
}

const step = (index: number) => ({ "--i": index }) as React.CSSProperties

export function RedeemView() {
  const balance = usePointsFeed()
  // The cashier is waiting on the other side of the counter: this screen asks
  // every few seconds while it is open (the rest of the app asks calmly, and
  // stands down while this one does).
  const { requests, ask } = useLiveAsk(WATCH_MS)

  const available =
    balance.data === undefined ? undefined : (balance.data.balance_points ?? 0)

  return (
    <div className="flex flex-col">
      <ScreenTitle>Tukar poin</ScreenTitle>

      <Card className="rise flex flex-col px-5 py-5" style={step(0)}>
        <p className="text-nav text-body">Poin yang bisa ditukar</p>
        <div className="mt-1 flex min-h-[3.5rem] items-baseline gap-2">
          {balance.isError ? (
            <p className="text-body">Saldo belum bisa ditampilkan.</p>
          ) : available === undefined ? (
            <Skeleton className="h-12 w-32" />
          ) : (
            <>
              <NumberTicker
                value={available}
                format={units}
                className="text-display font-semibold text-ink"
              />
              <span className="text-headline font-semibold text-mute">poin</span>
            </>
          )}
        </div>
      </Card>

      {/* Nothing is shown until the first read lands: an invitation to wait
          for the cashier, replaced a moment later by their ask, would be a
          lie told for a few hundred milliseconds. */}
      <AskPanel
        ask={ask}
        idle={requests.data !== undefined ? <IdleHint /> : undefined}
        className="mt-4"
      />

      {/* A poll that fails between two that worked keeps the list: the error
          is for a screen that has nothing to show. */}
      {requests.data !== undefined ? (
        <History requests={requests.data.filter((request) => request.request_id !== ask?.request_id)} />
      ) : requests.isError ? (
        <section className="rise mt-8 flex flex-col gap-2.5" style={step(2)}>
          <ErrorState error={requests.error} onRetry={() => void requests.refetch()} />
        </section>
      ) : (
        <section className="rise mt-8 flex flex-col gap-2.5" style={step(2)}>
          <LoadingRows rows={2} />
        </section>
      )}
    </div>
  )
}

/// Said once, in the place the ask will appear.
function IdleHint() {
  return (
    <Card className="flex items-center gap-3 px-4 py-3.5">
      <MattePicture art="gift" size={44} />
      <p className="text-nav text-body">Tukar poin dimulai oleh kasir saat kamu membayar.</p>
    </Card>
  )
}

/// Every ask, newest first. With none yet there is no heading and no empty
/// card: the line above already says how a first one begins.
function History({ requests }: { requests: readonly RedeemRequest[] }) {
  if (requests.length === 0) return null
  return (
    <section
      aria-labelledby="riwayat-penukaran"
      className="rise mt-8 flex flex-col gap-2.5"
      style={step(2)}
    >
      <h2 id="riwayat-penukaran" className="px-1 text-headline font-semibold text-ink">
        Riwayat penukaran
      </h2>
      <ListGroup>
        {requests.map((request) => (
          <HistoryRow key={request.request_id} request={request} />
        ))}
      </ListGroup>
    </section>
  )
}

function HistoryRow({ request }: { request: RedeemRequest }) {
  const confirmed = request.status === "CONFIRMED"
  const store = request.store_name?.trim()
  return (
    <ListRow
      art="gift"
      title={<span className="num">{units(request.points)} poin</span>}
      description={
        <>
          <span className="block">
            {store}
            {store ? " · " : null}
            {/* The date stays in one piece when the shop's name wraps. */}
            <span className="whitespace-nowrap">{rowDate(request.requested_at)}</span>
          </span>
          {/* How a spent ask was answered: tapped here, or the code WhatsApp
              brought read back to the cashier. */}
          {confirmed && (
            <span className="block">
              {request.approved_in_app ? "Disetujui di app" : "Kode WhatsApp"}
            </span>
          )}
        </>
      }
      trailing={
        <span className="flex flex-col items-end gap-1">
          <span
            className={cn(
              "num text-metric font-semibold",
              confirmed ? "text-ink" : "text-mute",
            )}
          >
            {money(request.value_minor)}
          </span>
          <Pill tone={STATUS_TONE[request.status]}>{STATUS_LABEL[request.status]}</Pill>
        </span>
      }
    />
  )
}
