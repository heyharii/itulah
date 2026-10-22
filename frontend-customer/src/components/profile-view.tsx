import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight } from "lucide-react"

import { Avatar } from "@/components/avatar"
import { ScreenTitle } from "@/components/app-shell"
import { ListGroup, ListRow } from "@/components/ui/list"
import { Skeleton } from "@/components/ui/skeleton"
import { cacheKey, member as api } from "@/lib/api"
import { units } from "@/lib/money"
import { useNodeIdentity, useSession } from "@/lib/session"

const JOINED = new Intl.DateTimeFormat("id-ID", { month: "long", year: "numeric" })
const step = (index: number) => ({ "--i": index }) as React.CSSProperties

/// Who this phone is showing, and the one way to stop it.
export function ProfileView() {
  const { member, signOut } = useSession()
  const where = useNodeIdentity()

  const summary = useQuery({
    queryKey: cacheKey.summary(),
    queryFn: ({ signal }) => api.summary(signal),
  })

  const name = member.display_name?.trim() || "Member Central"

  return (
    <div className="flex flex-col">
      <ScreenTitle>Profil</ScreenTitle>

      <section className="rise flex flex-col items-center text-center" style={step(0)}>
        <Avatar memberId={member.member_id} name={member.display_name} size="xl" />
        <p className="mt-4 text-hero font-semibold text-ink">{name}</p>
        <Link
          to="/kartu"
          className="press mt-2 inline-flex items-center gap-1 rounded-full bg-matte-ground px-3.5 py-1.5 text-meta font-semibold text-matte-foot"
        >
          Member Central
          <ChevronRight className="size-4 text-matte-foot" />
        </Link>
        <p className="mt-2 text-meta text-body">
          Sejak {JOINED.format(new Date(member.joined_on))}
        </p>
      </section>

      <ListGroup className="rise mt-7" style={step(1)}>
        <ListRow
          art="card"
          title="Kartu member"
          description="Tunjukkan atau pindai di kasir"
          chevron
          render={<Link to="/kartu" />}
        />
        <ListRow
          art="profile"
          title="Nomor member"
          trailing={
            <span className="font-mono text-meta font-medium tracking-[0.02em] text-ink uppercase select-all">
              {member.member_id}
            </span>
          }
        />
        <ListRow
          art="receipt"
          title="Riwayat belanja"
          trailing={
            summary.data === undefined ? (
              <Skeleton className="h-3.5 w-16" />
            ) : (
              <span className="num text-meta text-body">
                {units(summary.data.transaction_count)} transaksi
              </span>
            )
          }
          chevron
          render={<Link to="/riwayat" />}
        />
        <ListRow
          art="gift"
          title="Tukar poin"
          chevron
          render={<Link to="/tukar-poin" />}
        />
      </ListGroup>

      <ListGroup className="rise mt-4" style={step(2)}>
        <ListRow
          art="shield"
          title="Keamanan"
          description="Ponsel ini terhubung lewat kode dari kasir. Tidak ada kata sandi yang disimpan."
        />
      </ListGroup>

      <ListGroup className="rise mt-4" style={step(3)}>
        {/* Said plainly, because a shared phone is the ordinary case here and
            the person pressing this needs to know what it costs them:
            getting back in means asking a cashier for another code. */}
        <ListRow
          art="logout"
          title="Putuskan ponsel ini"
          description="Untuk menghubungkan lagi, minta kode baru ke kasir."
          tone="danger"
          onClick={signOut}
        />
      </ListGroup>

      {where.data != null && (
        <p className="mt-6 text-center text-meta text-faint">
          {where.data.node_id} · {where.data.node_role}
        </p>
      )}
    </div>
  )
}
