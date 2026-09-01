import { useQuery } from "@tanstack/react-query"
import { CreditCard, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, customerSummary } from "@/lib/api"
import { shortDate } from "@/lib/dates"
import { useMember, useMemberId } from "@/lib/member"
import { units } from "@/lib/money"
import { useSession } from "@/lib/session"

/// The member's card and the way out.
///
/// Nothing here is editable except the card number, because nothing else about
/// a member exists to edit: there is no name, no phone, no address in this
/// system yet. A profile form full of fields that go nowhere would be a
/// promise the server cannot keep.
///
/// The appearance control that used to sit here is gone with the dark theme it
/// switched. Cloud Hub has one appearance — "always light; nothing ever
/// darkens" — so the toggle was offering a choice the design language does not
/// have.
export function ProfileView() {
  const memberId = useMemberId()
  const { forget } = useMember()
  const { identity, node, signOut } = useSession()

  const summary = useQuery({
    queryKey: cacheKey.summary(memberId),
    queryFn: ({ signal }) => customerSummary(memberId, signal),
  })

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-inner bg-accent-bg">
              <CreditCard className="size-5 text-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-meta text-body">Nomor member</p>
              <p className="font-mono text-card-title break-all text-ink select-all">
                {memberId}
              </p>
            </div>
          </div>

          {summary.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : summary.isSuccess ? (
            <p className="num text-meta text-body">
              {units(summary.data.points_earned_total)} poin ·{" "}
              {units(summary.data.transaction_count)} transaksi
              {summary.data.first_purchase_at !== null && (
                <> · member sejak {shortDate(summary.data.first_purchase_at)}</>
              )}
            </p>
          ) : null}

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xs text-meta text-body">
              Ganti kartu kalau kamu memakai nomor member yang lain di ponsel
              ini.
            </p>
            <Button size="sm" onClick={forget}>
              Ganti kartu
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* The node session, named for what it is. A member is not signed in to
          anything yet — this is the account that lets this browser reach the
          API at all, and pretending otherwise would leave somebody hunting for
          a member logout that does not exist. */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div>
            <p className="font-medium text-ink">Sesi perangkat</p>
            <p className="text-meta text-body">
              {identity.display_name} · {identity.username}
              {node !== null && <> · {node.node_id}</>}
            </p>
          </div>
          <Button size="sm" className="self-start" onClick={signOut}>
            <LogOut />
            Keluar
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
