import { useMemo, useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { CardList } from "@/components/ui/card-list"
import { LeadCard } from "@/components/ui/lead-card"
import { SheetFoot, SheetSection } from "@/components/ui/people-sheet"
import { Pill, Status } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Stat, StatStrip } from "@/components/ui/stat-strip"
import { Banner, EmptyState } from "@/components/ui/states"
import { count, label } from "@/lib/format"
import { useGaAsset, useGaAssets } from "@/lib/queries/ga"
import {
  ASSET_CLASSES,
  assetStanding,
  assetStatusOf,
  assetUrgency,
  classOf,
  conditionOf,
  dateLead,
  day,
  daysUntil,
  inDays,
} from "@/screens/ga/format"
import {
  Facts,
  GaScreen,
  ListBar,
  ListLine,
  type GaContext,
} from "@/screens/ga/parts"
import { RepairComposer } from "@/screens/ga/repair-composer"
import { gaState } from "@/screens/ga/state"
import { personByLogin } from "@/screens/hr/words"
import type {
  EmployeeList,
  GaAssetEvent,
  GaAssetRow,
  GaDocument,
} from "@itulah/contract"

/// What head office has on its register for THIS shop.
///
/// # Read-only, and that is the owner's decision
///
/// A shop can see what it is holding and cannot add to it. The register is
/// head office's record of what the company owns; when an air conditioner
/// arrives here, somebody at head office registers it, and this screen is how
/// the shop checks that they did. What a shop CAN do is say something is
/// wrong with one — "Report a problem" files a repair request or a note on
/// the thing itself.
///
/// # No rupiah on this screen, ever
///
/// GA's side of the register (`/ga/assets`) carries no money at all — the
/// cost lives in Finance's half, which this never asks for. The asset's own
/// record does carry a "related cost" total; it is not drawn. A shop manager
/// can read the whole list without being shown what the company carries the
/// shop's fit-out at. So a card's one figure is the day the thing was acquired.
///
/// # The things, not the costs
///
/// Work in progress, deferred pre-opening and software are on the register
/// too, but they are costs being paid for rather than objects anybody can walk
/// up to; they are Finance's queue and are left out, as are things already
/// disposed of or replaced. What is left is the number the shop can check
/// against its floor. See `PHYSICAL_BUILDS` and `FLOOR_STATUSES`.
///
/// # Classes, as the hub finds things
///
/// The status chip is the hub's seven build views — Property, Technical
/// equipment, Vehicles, Furniture & fixtures, IT hardware, Audio / music,
/// Operating equipment — counted over this shop's own rows. (The server's
/// facets count the whole estate, so they are not used.)
export function Assets() {
  return (
    <GaScreen>
      {({ site, team }) => <Register site={site} team={team} />}
    </GaScreen>
  )
}

type Order = "register" | "name" | "condition" | "acquired"

const ORDERS: readonly { readonly value: Order; readonly label: string }[] = [
  { value: "register", label: "Register" },
  { value: "name", label: "Name" },
  { value: "condition", label: "Condition" },
  { value: "acquired", label: "Newest" },
]

function sorted(rows: readonly GaAssetRow[], order: Order): GaAssetRow[] {
  const copy = [...rows]
  switch (order) {
    case "register":
      return copy
    case "name":
      return copy.sort((a, b) => a.name.localeCompare(b.name))
    case "condition":
      return copy.sort(
        (a, b) =>
          assetUrgency(a) - assetUrgency(b) || a.name.localeCompare(b.name),
      )
    case "acquired":
      return copy.sort((a, b) => b.acquired_on.localeCompare(a.acquired_on))
  }
}

function Register({
  site,
  team,
}: {
  site: string
  team: GaContext["team"]
}) {
  const register = useGaAssets(site)
  const [klass, setKlass] = useState<string>("all")
  const [typed, setTyped] = useState("")
  const [order, setOrder] = useState<Order>("register")
  // The record and whether its sheet is showing are two facts: the record
  // stays set while the sheet slides away, so it leaves with its content
  // rather than as an empty panel.
  const [openId, setOpenId] = useState<string | null>(null)
  const [showing, setShowing] = useState(false)
  const [reporting, setReporting] = useState<GaAssetRow | null>(null)
  const [composing, setComposing] = useState(false)
  const [filed, setFiled] = useState<"repair" | "note" | null>(null)
  const needle = typed.trim().toLowerCase()

  const rows = useMemo(() => register.data?.rows ?? [], [register.data])
  const shown = useMemo(() => {
    const builds =
      klass === "all"
        ? null
        : (ASSET_CLASSES.find((one) => one.value === klass)?.builds ?? [])
    return sorted(
      rows.filter(
        (row) =>
          (builds === null || builds.includes(row.build)) &&
          (needle === "" ||
            [
              row.name,
              row.asset_number,
              row.serial_number,
              row.class_name,
              row.sub_location,
              row.holder,
            ].some((field) => field?.toLowerCase().includes(needle))),
      ),
      order,
    )
  }, [rows, klass, needle, order])
  const open = rows.find((row) => row.asset_id === openId) ?? null
  const show = (row: GaAssetRow) => {
    setOpenId(row.asset_id)
    setShowing(true)
  }

  return (
    <>
      {filed !== null && (
        <Banner
          tone="ok"
          className="mb-4"
          onDismiss={() => setFiled(null)}
          action={
            filed === "repair" ? (
              <AppLink
                to="/ga/repairs"
                className="shrink-0 font-medium underline underline-offset-2"
              >
                See repairs
              </AppLink>
            ) : undefined
          }
        >
          {filed === "repair" ? "Sent to head office." : "Noted."}
        </Banner>
      )}

      {gaState(register, {
        loading: "Reading the assets…",
        render: () => {
          if (rows.length === 0) {
            return <EmptyState>No assets registered.</EmptyState>
          }
          const drafts = rows.filter((row) => row.status === "DRAFT").length
          const broken = rows.filter((row) => row.condition !== "BAIK").length
          return (
            <>
              <ListBar
                search={{
                  value: typed,
                  onChange: setTyped,
                  label: "Search assets",
                }}
                status={{
                  title: "Class",
                  value: klass,
                  onChange: setKlass,
                  options: [
                    { value: "all", label: "All classes", count: rows.length },
                    ...ASSET_CLASSES.map((one) => ({
                      value: one.value,
                      label: one.label,
                      count: rows.filter((row) => one.builds.includes(row.build))
                        .length,
                    })).filter((one) => one.count > 0),
                  ],
                }}
                sort={{
                  value: order,
                  options: ORDERS,
                  onChange: (next) => setOrder(next as Order),
                }}
              />

              <StatStrip>
                <Stat label="Assets" value={count(rows.length)} />
                <Stat
                  label="Need attention"
                  value={count(broken)}
                  tone={broken > 0 ? "warn" : undefined}
                />
                <Stat label="Not confirmed" value={count(drafts)} />
              </StatStrip>

              {shown.length === 0 ? (
                <EmptyState
                  action={
                    <Button
                      onClick={() => {
                        setTyped("")
                        setKlass("all")
                      }}
                    >
                      Show everything
                    </Button>
                  }
                >
                  {needle !== ""
                    ? `No match for “${typed.trim()}”.`
                    : "None in this class."}
                </EmptyState>
              ) : (
                <CardList grid>
                  {shown.map((row) => (
                    <AssetCard
                      key={row.asset_id}
                      row={row}
                      onOpen={() => show(row)}
                    />
                  ))}
                </CardList>
              )}
            </>
          )
        },
      })}

      <AssetSheet
        asset={open}
        team={team}
        open={showing}
        onClose={() => setShowing(false)}
        onReport={(asset) => {
          // One sheet at a time: the record steps aside for the form rather
          // than a sheet stacking on a sheet.
          setShowing(false)
          setFiled(null)
          setReporting(asset)
          setComposing(true)
        }}
      />

      {/* Keyed by the asset so a report on another thing starts clean rather
          than carrying the first one's half-typed words across. */}
      {reporting !== null && (
        <RepairComposer
          key={reporting.asset_id}
          open={composing}
          onClose={() => setComposing(false)}
          site={site}
          asset={reporting}
          onFiled={setFiled}
        />
      )}
    </>
  )
}

/// One thing as the uniform lead-figure card: its name over its number, the day
/// it was acquired as the one figure, and — in the foot — the one status that
/// matters about it. A broken thing takes the red foot.
function AssetCard({
  row,
  onOpen,
}: {
  row: GaAssetRow
  onOpen: () => void
}) {
  const standing = assetStanding(row)
  return (
    <LeadCard
      title={row.name}
      code={row.asset_number}
      lines={[
        row.class_name,
        [row.sub_location, row.holder].filter(Boolean).join(" · "),
      ]}
      lead={dateLead(row.acquired_on, "acquired")}
      tone={row.condition === "RUSAK" ? "alert" : undefined}
      foot={{
        info: <Status tone={standing.tone}>{standing.label}</Status>,
        action: { label: "Open", onClick: onOpen },
      }}
      onOpen={onOpen}
    />
  )
}

/// One thing: what it is, where it stands, the papers with a date on them,
/// and what has happened to it. The row the list already has is drawn at
/// once; the history and papers arrive from `/ga/assets/{id}` behind it.
function AssetSheet({
  asset,
  team,
  open,
  onClose,
  onReport,
}: {
  asset: GaAssetRow | null
  team: EmployeeList | undefined
  open: boolean
  onClose: () => void
  onReport: (asset: GaAssetRow) => void
}) {
  const hub = useGaAsset(asset?.asset_id ?? null)
  if (asset === null) return null
  const standing = assetStanding(asset)
  const lifecycle = assetStatusOf(asset.status)
  const specs = Object.entries(asset.specs ?? {}).filter(
    ([, value]) =>
      (typeof value === "string" && value.trim() !== "") ||
      typeof value === "number",
  )

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      id={asset.asset_number}
      title={asset.name}
      badge={<Pill tone={standing.tone}>{standing.label}</Pill>}
      caption={`${classOf(asset.build).label} · ${asset.class_name}`}
      footer={
        <SheetFoot>
          <Button variant="primary" onClick={() => onReport(asset)}>
            Report a problem
          </Button>
        </SheetFoot>
      }
    >
      {lifecycle !== null && (
        <Banner
          tone={lifecycle.tone === "warn" ? "warn" : "info"}
          className="mb-6"
        >
          {asset.status === "DRAFT"
            ? "Not confirmed yet. Tell head office if it isn't here."
            : "Disposal requested by head office."}
        </Banner>
      )}

      <Facts
        rows={[
          ["Condition", conditionOf(asset.condition).label],
          ["Where in the shop", asset.sub_location ?? "—"],
          ["Held by", asset.holder ?? "—"],
          [
            "Serial / plate",
            <span key="serial" className="font-mono">
              {asset.serial_number ?? "—"}
            </span>,
          ],
          ["Acquired", day(asset.acquired_on)],
          ...specs.map(
            ([key, value]) => [label(key), String(value)] as [string, string],
          ),
        ]}
      />

      {gaState(hub, {
        loading: "Reading the history…",
        render: (answer) => (
          <div className="mt-6">
            {answer.documents.length > 0 && (
              <SheetSection title="Papers" aside={answer.documents.length}>
                <ul className="flex flex-col">
                  {answer.documents.map((doc) => (
                    <DocumentLine key={doc.document_id} doc={doc} />
                  ))}
                </ul>
              </SheetSection>
            )}
            <SheetSection title="History" aside={answer.events.length}>
              {answer.events.length === 0 ? (
                <p className="text-meta text-mute">Nothing recorded yet.</p>
              ) : (
                <ol className="flex flex-col">
                  {[...answer.events]
                    .sort((a, b) => b.occurred_on.localeCompare(a.occurred_on))
                    .map((event) => (
                      <EventLine
                        key={event.event_id}
                        event={event}
                        team={team}
                      />
                    ))}
                </ol>
              )}
            </SheetSection>
          </div>
        ),
      })}
    </Sheet>
  )
}

/// A paper with a date on it. One that runs out inside ninety days is
/// flagged — the threshold the hub's own overview uses for documents.
function DocumentLine({ doc }: { doc: GaDocument }) {
  const left = doc.expires_on === null ? null : daysUntil(doc.expires_on)
  return (
    <ListLine
      top={doc.doc_type ?? doc.title ?? doc.name}
      under={[doc.doc_number, doc.issuer].filter(Boolean).join(" · ") || doc.name}
      end={
        left === null ? (
          "No expiry"
        ) : left < 0 ? (
          <Status tone="bad">Expired {inDays(left)}</Status>
        ) : left <= 90 ? (
          <Status tone="warn">Expires {inDays(left)}</Status>
        ) : (
          `Until ${day(doc.expires_on)}`
        )
      }
    />
  )
}

function EventLine({
  event,
  team,
}: {
  event: GaAssetEvent
  team: EmployeeList | undefined
}) {
  const what =
    event.kind === "TRANSFER"
      ? `Moved${event.from_site !== null ? ` from ${event.from_site}` : ""}${event.to_site !== null ? ` to ${event.to_site}` : ""}`
      : event.kind === "ASSIGN"
        ? `Handed ${event.to_holder !== null ? `to ${event.to_holder}` : "back"}`
        : event.kind === "CONDITION"
          ? "Condition changed"
          : event.kind === "REGISTERED"
            ? "Registered"
            : "Note"
  return (
    <li className="border-b border-hairline py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-cell font-medium text-ink">{what}</span>
        <span className="shrink-0 text-meta text-mute tabular-nums">
          {day(event.occurred_on)}
        </span>
      </div>
      {event.reason.trim() !== "" && (
        <p className="mt-0.5 text-meta text-body">{event.reason}</p>
      )}
      <p className="mt-0.5 text-meta text-mute">
        {personByLogin(team, event.recorded_by)}
      </p>
    </li>
  )
}
