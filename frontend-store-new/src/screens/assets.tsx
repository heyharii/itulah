import { useMutation, useQuery } from "@tanstack/react-query"
import { ArrowLeft, Boxes, Search, TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"

import { CentralGate } from "@/components/central-gate"
import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { RecordCard } from "@/components/ui/card"
import { KeyValue } from "@/components/ui/rows"
import { CardList, Screen, Section } from "@/components/ui/screen"
import { cloud, CENTRAL_KEY_PREFIX } from "@/lib/cloud"
import { count } from "@/lib/format"
import { queryState } from "@/lib/query-state"
import { useNodeIdentity } from "@/lib/session"
import { describe } from "@/lib/errors"
import { Banner } from "@/components/ui/states"
import type { AssetPage, AssetRow, DiscussionThread } from "@itulah/contract"

/// What head office has on its register for THIS shop.
///
/// # Read-only, and that is the owner's decision
///
/// A shop can see what it is holding and cannot add to it. The register is
/// head office's record of what the company owns, and a shop typing into it
/// directly would put rows in the accounts that nobody at HO agreed to. When
/// an air conditioner arrives here, somebody at head office registers it; this
/// screen is how the shop checks that they did.
///
/// # No rupiah on this screen, ever
///
/// `fixed_asset` carries no monetary column at all — the money lives in
/// `asset_capitalization`, which this never asks for. So a shop manager can
/// read the whole list without being shown what the company carries the shop's
/// fit-out at. The same split is why GA and Finance have separate screens in
/// the console.
///
/// # Contract In Progress is not on this screen
///
/// Half the client's register by count is work being paid for on something not
/// built yet — a shop fit-out, a renovation. That is a COST, not a thing:
/// there is nothing here for anybody to walk up to and check, and asking a
/// manager to reconcile "CONTRACT IN PROGRESS" against their floor is asking
/// them to find an object that does not exist. It is Finance's queue and it
/// stays on Finance's screen. At store-03 that is the difference between 86
/// rows and the 55 things actually in the shop.
///
/// # Reporting a broken one, without a repairs module
///
/// The owner's call, and the right one: a shop reports a fault as a
/// DISCUSSION about the asset. Nothing new was built for it — threads already
/// carry a `subject_kind` and `subject_id`, opening one is a Cashier-level
/// route, and the hub's record panel already draws a record's threads on its
/// sheet. So "printer kasir mati" opened here lands on that printer's sheet in
/// front of GA, with the shop's own words and a reply thread.
///
/// What this deliberately is not is a work-order system: no assignee, no due
/// date, no status beyond open and closed. If the company finds itself wanting
/// those, the threads will say so — and that is a better reason to build one
/// than a guess made now.
///
/// # Why this is worth having at all
///
/// The client's own register cannot answer it. All 1,342 rows of their
/// `MASTER ASSET` have `DEPARTEMEN` set to "-", no serial numbers, and names
/// like "AC" and "KOMPUTER". This is the first surface in the company where
/// somebody standing in a shop can see what that shop is supposed to have —
/// and the count at the top is the number they can check against the floor.
export function Assets() {
  return (
    <CentralGate what="The asset register">
      <ShopAssets />
    </CentralGate>
  )
}

function ShopAssets() {
  const identity = useNodeIdentity()
  const site = identity.data?.site_id ?? null
  const [needle, setNeedle] = useState("")
  const [reporting, setReporting] = useState<AssetRow | null>(null)

  const register = useQuery({
    queryKey: [CENTRAL_KEY_PREFIX, "assets", site, needle] as const,
    // Narrowed to this shop by the query, which is what the app knows about
    // itself — the centre's route is open to every supervisor, so this is a
    // scoping of the question and not a wall. Nothing sensitive is behind it:
    // the answer carries no money.
    queryFn: ({ signal }) =>
      cloud.get<AssetPage>(
        `/api/v1/finance/assets?site=${encodeURIComponent(site ?? "")}` +
          // Everything except work in progress. The three kept are named
          // rather than CIP excluded, because the filter takes the values it
          // keeps — and a shop should still see a thing Finance has not
          // assessed yet, because the thing is standing there either way.
          "&decision=CAPITALIZE,EXPENSE,UNASSESSED" +
          (needle.trim() === ""
            ? ""
            : `&q=${encodeURIComponent(needle.trim())}`) +
          "&limit=200",
        { signal },
      ),
    enabled: site !== null,
  })

  const heading = useMemo(() => {
    const total = register.data?.total
    if (total === undefined) return "What this shop holds"
    return `${count(total)} ${total === 1 ? "thing" : "things"} on the register`
  }, [register.data?.total])

  if (reporting !== null) {
    return <ReportFault asset={reporting} onDone={() => setReporting(null)} />
  }

  return (
    <Screen>
      <Section title={heading}>
        <div className="mb-3 flex items-center gap-2">
          <Search className="size-4 shrink-0 text-mute" />
          <Input
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder="Name, number or serial"
          />
        </div>

        {site === null ? (
          <p className="text-meta text-body">
            This till has not told us which shop it is standing in, so there is
            nothing to look up yet.
          </p>
        ) : (
          queryState(register, {
            loading: "Asking head office…",
            render: (page) =>
              page.rows.length === 0 ? (
                <p className="text-meta text-body">
                  Head office has nothing on the register for this shop. If
                  something here belongs to the company — an air conditioner, a
                  computer, the shelving — ask them to register it.
                </p>
              ) : (
                <CardList>
                  {page.rows.map((row) => (
                    <RecordCard
                      key={row.asset_id}
                      icon={<Boxes />}
                      id={row.name}
                      status={
                        row.decision === null ? (
                          <Pill tone="warn">Not assessed</Pill>
                        ) : undefined
                      }
                    >
                      <div className="px-3.5 pt-1 pb-3">
                        <KeyValue term="Number">{row.asset_number}</KeyValue>
                        <KeyValue term="Kind">{row.category_name}</KeyValue>
                        <KeyValue term="Serial">
                          {row.serial_number ?? "none recorded"}
                        </KeyValue>
                        {row.quantity > 1 && (
                          <KeyValue term="How many">
                            {count(row.quantity)}
                          </KeyValue>
                        )}
                        <Button
                          variant="ghost"
                          className="mt-2"
                          onClick={() => setReporting(row)}
                        >
                          <TriangleAlert />
                          Report a fault
                        </Button>
                      </div>
                    </RecordCard>
                  ))}
                </CardList>
              ),
          })
        )}
      </Section>
    </Screen>
  )
}

/// One fault, in the shop's own words, opened as a thread about the thing.
///
/// The subject note carries the asset's number, name and shop so head office
/// can read the list without opening every thread — a thread that says only
/// "mati total" is a thread somebody has to click to triage.
function ReportFault({
  asset,
  onDone,
}: {
  asset: AssetRow
  onDone: () => void
}) {
  const [what, setWhat] = useState("")
  const [detail, setDetail] = useState("")

  const send = useMutation({
    mutationFn: () =>
      cloud.post<DiscussionThread>("/api/v1/discussions", {
        subject_kind: "asset",
        subject_id: asset.asset_id,
        subject_note: `${asset.asset_number} ${asset.name} — ${asset.site_id}`,
        title: what.trim(),
        body: detail.trim(),
        // One tag, so GA can pull every fault across fourteen shops out of a
        // forum that also carries everything else.
        tags: ["kerusakan"],
      }),
    onSuccess: onDone,
  })

  return (
    <Screen>
      <Section title="Report a fault">
        <Button variant="ghost" className="mb-3" onClick={onDone}>
          <ArrowLeft />
          Back to the list
        </Button>

        <div className="mb-4 rounded-card border border-hairline bg-soft px-3.5 py-2.5">
          <p className="text-card-title font-semibold text-ink">{asset.name}</p>
          <p className="text-meta text-body">
            {asset.asset_number} · {asset.category_name}
          </p>
        </div>

        {send.error !== null && send.error !== undefined && (
          <Banner tone="bad">{describe(send.error)}</Banner>
        )}

        <div className="flex flex-col gap-3">
          <Field label="What is wrong">
            <Input
              value={what}
              onChange={(event) => setWhat(event.target.value)}
              placeholder="Printer kasir mati total"
            />
          </Field>
          <Field label="What happened">
            <Input
              value={detail}
              onChange={(event) => setDetail(event.target.value)}
              placeholder="Sejak pagi tidak menyala. Sudah dicoba di stop kontak lain."
            />
          </Field>
          <Button
            variant="primary"
            disabled={
              what.trim() === "" || detail.trim() === "" || send.isPending
            }
            onClick={() => send.mutate()}
          >
            <TriangleAlert />
            {send.isPending ? "Sending…" : "Send to head office"}
          </Button>
          <p className="text-pill text-mute">
            This opens a discussion about this asset. Head office sees it on the
            asset itself, and replies land back in the same thread.
          </p>
        </div>
      </Section>
    </Screen>
  )
}
