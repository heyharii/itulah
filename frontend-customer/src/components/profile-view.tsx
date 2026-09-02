import { useQuery } from "@tanstack/react-query"
import { CreditCard, LogOut } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, member as api } from "@/lib/api"
import { shortDate } from "@/lib/dates"
import { units } from "@/lib/money"
import { useSession } from "@/lib/session"

/// The member's card, and the way to disconnect this phone from it.
///
/// Nothing here is editable, because nothing else about a member exists to
/// edit: there is no phone number, no address in this system yet. A profile
/// form full of fields that go nowhere would be a promise the server cannot
/// keep.
///
/// The appearance control that used to sit here went with the dark theme it
/// switched — Cloud Hub has one appearance. What also went is the "Sesi
/// perangkat" card naming an operator account: a shopper is now signed in as
/// themselves, and there is no longer a second identity to explain.
export function ProfileView() {
  const { member, signOut } = useSession()

  const summary = useQuery({
    queryKey: cacheKey.summary(),
    queryFn: ({ signal }) => api.summary(signal),
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
                {member.member_id}
              </p>
              {member.display_name !== null && (
                <p className="truncate text-meta text-body">
                  {member.display_name}
                </p>
              )}
            </div>
          </div>

          {summary.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : summary.isSuccess ? (
            <p className="num text-meta text-body">
              {units(summary.data.points_earned_total)} poin ·{" "}
              {units(summary.data.transaction_count)} transaksi
              {summary.data.first_purchase_at !== null && (
                <> · belanja pertama {shortDate(summary.data.first_purchase_at)}</>
              )}
            </p>
          ) : null}

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            {/* Said plainly, because a shared phone is the ordinary case here
                and the person pressing this needs to know what it costs them:
                getting back in means asking a cashier for another code. */}
            <p className="max-w-xs text-meta text-body">
              Putuskan kalau ponsel ini dipakai orang lain. Untuk menghubungkan
              lagi, minta kode baru ke kasir.
            </p>
            <Button size="sm" onClick={signOut}>
              <LogOut />
              Putuskan
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
