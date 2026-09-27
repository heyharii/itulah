import { useQuery } from "@tanstack/react-query"
import { Link, type LinkProps } from "@tanstack/react-router"

import { Banner } from "@/components/ui/states"
import { moment } from "@/lib/format"
import type { CreatedStore } from "@/lib/queries/setup"
import { listStores, storesKeys } from "@/lib/queries/stores"
import { CopyLinkButton } from "@/screens/people/invite-sheet"

/// "Send these links to your store managers" — shown right after stores are
/// opened, wherever that happens: the wizard's last screen and the "Open a
/// new store" sheet both hand their answer's `created` array straight to
/// this.
///
/// Every store here has a manager and therefore a link: the server has
/// refused a store without one since 2026-09-27. This still filters on
/// `manager_invitation` rather than assuming it, because a store opened
/// before that date — read back from the register elsewhere — has none, and
/// this component is written to be safe wherever `CreatedStore` travels.
export function ManagerLinks({
  stores,
}: {
  stores: readonly CreatedStore[]
}) {
  // Read unconditionally — a hook cannot sit after the early return below,
  // and this list is cheap: it is the same `/api/v1/stores` the Stores page
  // already keeps warm, not a call made for this component alone.
  //
  // `CreatedStore` (the setup wire's `SetupStore`) only carries the client's
  // code — the caller who just opened these stores can also read
  // `/api/v1/stores`, so this reads that list once to find each one's
  // internal id, the one `/stores/$unit` takes. Absent (still loading, or a
  // reach that somehow excludes a store it just made) means no link, not a
  // broken one.
  const storesList = useQuery({
    queryKey: storesKeys.list(),
    queryFn: ({ signal }) => listStores(signal),
  })

  const withLinks = stores.filter((store) => store.manager_invitation !== null)
  if (withLinks.length === 0) return null

  const idByCode = new Map(
    (storesList.data?.items ?? []).map((row) => [row.code, row.unit_id])
  )

  return (
    <div className="flex flex-col gap-3">
      <Banner tone="warn">
        Send these links to your store managers. Each is shown here once and
        never again.
      </Banner>
      <div className="flex flex-col gap-2.5">
        {withLinks.map((store) => {
          const invitation = store.manager_invitation!
          const unitId = idByCode.get(store.unit_code)
          return (
            <div
              key={store.unit_code}
              className="flex flex-col gap-2 rounded-card border border-hairline-2 bg-canvas p-3.5"
            >
              <div className="flex items-center justify-between gap-2">
                <b className="truncate text-cell font-semibold text-ink">
                  {invitation.name}
                </b>
                <span className="shrink-0 text-meta text-mute">
                  {store.unit_code} · {store.name}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-inner bg-soft-2 px-2.5 py-2 font-mono text-id text-body">
                  {invitation.link}
                </code>
                <CopyLinkButton link={invitation.link} />
              </div>
              <p className="text-meta text-mute">
                Expires in 72 h — {moment(invitation.expires_at)}.
              </p>
              {/* Created, not open — the same wording the toast for "Open a
                  new store" uses (`open-stores-sheet.tsx`). */}
              <p className="text-meta text-mute">
                {store.unit_code} created —{" "}
                {unitId ? (
                  <Link
                    to={
                      `/stores/${encodeURIComponent(unitId)}` as LinkProps["to"]
                    }
                    className="font-medium text-accent underline underline-offset-2"
                  >
                    install its server from its page
                  </Link>
                ) : (
                  "install its server from its page"
                )}
                .
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
