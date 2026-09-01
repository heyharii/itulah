import { useQuery } from "@tanstack/react-query"
import { CreditCard, LogOut, Monitor, Moon, Sun } from "lucide-react"

import { useTheme } from "@/components/theme-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, customerSummary } from "@/lib/api"
import { shortDate } from "@/lib/dates"
import { useMember, useMemberId } from "@/lib/member"
import { units } from "@/lib/money"
import { useSession } from "@/lib/session"
import { cn } from "@/lib/utils"

/// The member's card, the look of the app, and the way out.
///
/// Nothing here is editable except the card number and the theme, because
/// nothing else about a member exists to edit: there is no name, no phone, no
/// address in this system yet. A profile form full of fields that go nowhere
/// would be a promise the server cannot keep.
export function ProfileView() {
  const memberId = useMemberId()
  const { forget } = useMember()
  const { identity, node, signOut } = useSession()
  const { theme, setTheme } = useTheme()

  const summary = useQuery({
    queryKey: cacheKey.summary(memberId),
    queryFn: ({ signal }) => customerSummary(memberId, signal),
  })

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading px-1 text-lg font-medium">Profil</h1>

      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <span className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-full">
              <CreditCard className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-muted-foreground text-xs">Nomor member</p>
              <p className="font-medium break-all">{memberId}</p>
            </div>
          </div>

          {summary.isPending ? (
            <Skeleton className="h-4 w-48" />
          ) : summary.isSuccess ? (
            <p className="text-muted-foreground text-sm">
              {units(summary.data.points_earned_total)} poin ·{" "}
              {units(summary.data.transaction_count)} transaksi
              {summary.data.first_purchase_at !== null && (
                <> · member sejak {shortDate(summary.data.first_purchase_at)}</>
              )}
            </p>
          ) : null}

          <Separator />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              Ganti kartu kalau kamu memakai nomor member yang lain di ponsel
              ini.
            </p>
            <Button variant="outline" size="sm" onClick={forget}>
              Ganti kartu
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm font-medium">Tampilan</p>
          <div className="flex gap-2">
            {(
              [
                { value: "light", label: "Terang", icon: Sun },
                { value: "dark", label: "Gelap", icon: Moon },
                { value: "system", label: "Sistem", icon: Monitor },
              ] as const
            ).map((option) => (
              <Button
                key={option.value}
                variant={theme === option.value ? "default" : "outline"}
                size="sm"
                className={cn("flex-1")}
                onClick={() => setTheme(option.value)}
              >
                <option.icon />
                {option.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* The node session, named for what it is. A member is not signed in to
          anything yet — this is the account that lets this browser reach the
          API at all, and pretending otherwise would leave somebody hunting for
          a member logout that does not exist. */}
      <Card size="sm">
        <CardContent className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-medium">Sesi perangkat</p>
            <p className="text-muted-foreground text-xs">
              {identity.display_name} · {identity.username}
              {node !== null && (
                <>
                  {" · "}
                  {node.node_id}
                </>
              )}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={signOut}>
            <LogOut />
            Keluar
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
