import { Link, useNavigate, type LinkProps } from "@tanstack/react-router"

import { AppLink } from "@/components/ui/app-link"
import { ConfirmButton } from "@/components/ui/dialog"
import { Pill } from "@/components/ui/pill"
import { ago, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import {
  exceptionKindLabel,
  exceptionSeverityTone,
  exceptionStateLabel,
  useAcknowledgeException,
  useExceptionsForStore,
  type ExceptionItem,
} from "@/lib/queries/exceptions"
import {
  CardFigure,
  CardFoot,
  CardName,
  PhoneCard,
} from "@/components/ui/phone-cards"

/// One exception, drawn the same way on the Stores › Exceptions list and on
/// a store's own Overview card — see `lib/queries/exceptions.ts` and
/// `STORE-SERVER-PLAN.md` §9e's sibling, the ops-exceptions plan (0646-0648).

/// Where the row's own link goes. `ExceptionLink.screen` names a hub screen
/// that does not all exist yet — `inventory.missing` is the one kind whose
/// target is built; the rest (`store-money.*`, `flows.document`,
/// `checkout-exceptions`) have no route to open yet, so this falls back to
/// the one screen that always exists for any of them: the store itself.
function exceptionHref(item: ExceptionItem): string {
  if (item.link.screen === "inventory.missing") return "/inventory/missing"
  return `/stores/${encodeURIComponent(item.unit_id)}`
}

/// Whether `exceptionHref` names a screen `AppLink` can check statically
/// (declared in `lib/navigation.ts`) or a per-record path it cannot.
const STATIC_SCREENS = new Set(["/inventory/missing"])

function ExceptionOpenLink({ item }: { item: ExceptionItem }) {
  const to = exceptionHref(item)
  if (STATIC_SCREENS.has(to)) {
    return (
      <AppLink to={to} className="text-[0.875rem] font-medium text-accent">
        Open
      </AppLink>
    )
  }
  // A per-store path, built at runtime like every store row on the Stores
  // list (`screens/stores/list.tsx`) — `AppLink`'s own registry check is for
  // paths declared as literals, which this never is.
  return (
    <Link
      to={to as LinkProps["to"]}
      className="text-[0.875rem] font-medium text-accent"
    >
      Open
    </Link>
  )
}

/// One row: severity, kind, the store, the data's own sentence, its age, a
/// link to fix it and — while open — Acknowledge.
///
/// `showStore` is false on a store's own Overview card, where every row is
/// already known to be this store's.
export function ExceptionRow({
  item,
  showStore = true,
}: {
  item: ExceptionItem
  showStore?: boolean
}) {
  const acknowledge = useAcknowledgeException()
  const phone = useLayout() === "phone"
  const navigate = useNavigate()
  // A phone reads each exception as a card, as every other list does: what it
  // is and the data's own sentence, how long it has been standing as the
  // figure, and in the foot where it stands with Acknowledge, the one thing to
  // press. A tap opens whatever the row's own "Open" link opens.
  if (phone)
    return (
      <PhoneCard
        onOpen={() => void navigate({ to: exceptionHref(item) } as never)}
        head={
          <CardName
            name={exceptionKindLabel(item.kind)}
            line={<span className="text-text">{item.sentence}</span>}
          />
        }
        lead={
          <CardFigure
            value={ago(item.since).replace(/ ago$/, "")}
            caption={exceptionStateLabel(item.state).toLowerCase()}
            tone={
              exceptionSeverityTone(item.severity) === "bad" ? "bad" : "warn"
            }
          />
        }
        foot={
          <CardFoot>
            {showStore ? `${item.unit_name} (${item.unit_code})` : "Since"}
            {!showStore ? ` ${ago(item.since)}` : ""}
            {item.acknowledged_by && (
              <>
                <br />
                Acknowledged by {item.acknowledged_by}
                {item.note ? ` — "${item.note}"` : ""}
              </>
            )}
            {item.resolved_at && (
              <>
                <br />
                Resolved {moment(item.resolved_at)}
              </>
            )}
          </CardFoot>
        }
        action={
          // The click and the dialog (portalled, but still this card in React's
          // eyes) must not reach the card's own tap, which navigates away.
          <span
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {item.state === "OPEN" ? (
              <ConfirmButton
                label="Acknowledge"
                variant="quiet"
                className="bg-accent-bg font-semibold text-accent hover:bg-accent-bg/60 hover:text-accent"
                title="Acknowledge this exception?"
                description="This says somebody has it — the data fixing itself is what resolves it, not this."
                confirmLabel="Acknowledge"
                reason={{
                  label: "Note (optional)",
                  optional: true,
                }}
                onConfirm={(note) =>
                  acknowledge.mutateAsync({
                    id: item.id,
                    note: note.trim() === "" ? undefined : note,
                  })
                }
              />
            ) : (
              <Pill tone={item.state === "RESOLVED" ? "ok" : "neutral"}>
                {exceptionStateLabel(item.state)}
              </Pill>
            )}
          </span>
        }
      />
    )
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Pill tone={exceptionSeverityTone(item.severity)}>
              {exceptionKindLabel(item.kind)}
            </Pill>
            {item.state !== "OPEN" && (
              <Pill tone={item.state === "RESOLVED" ? "ok" : "neutral"}>
                {exceptionStateLabel(item.state)}
              </Pill>
            )}
          </div>
          <p className="mt-1 text-[0.875rem] text-ink">{item.sentence}</p>
          <p className="mt-0.5 text-meta text-body">
            {showStore ? `${item.unit_name} (${item.unit_code}) · ` : ""}
            since {ago(item.since)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <ExceptionOpenLink item={item} />
          {item.state === "OPEN" && (
            <ConfirmButton
              label="Acknowledge"
              variant="quiet"
              title="Acknowledge this exception?"
              description="This says somebody has it — the data fixing itself is what resolves it, not this."
              confirmLabel="Acknowledge"
              reason={{
                label: "Note (optional)",
                optional: true,
              }}
              onConfirm={(note) =>
                acknowledge.mutateAsync({
                  id: item.id,
                  note: note.trim() === "" ? undefined : note,
                })
              }
            />
          )}
        </div>
      </div>
      {item.acknowledged_by && (
        <p className="text-meta text-mute">
          Acknowledged by {item.acknowledged_by}
          {item.acknowledged_at ? ` · ${moment(item.acknowledged_at)}` : ""}
          {item.note ? ` — "${item.note}"` : ""}
        </p>
      )}
      {item.resolved_at && (
        <p className="text-meta text-mute">
          Resolved {moment(item.resolved_at)}.
        </p>
      )}
    </li>
  )
}

/// The compact card on a store's own Overview: how many of its exceptions
/// are open, the top few, and a link to the full list already narrowed to
/// this store — same shape as `FleetStoreStrip`, one card among the tab's
/// others rather than a tab of its own.
export function ExceptionsCard({ unitId }: { unitId: string }) {
  const list = useExceptionsForStore(unitId, { state: "open", limit: 5 })
  const items = list.data?.items ?? []
  const total = list.data?.summary.total ?? 0

  return (
    <AppLink
      to="/stores/exceptions"
      sheet={{ key: "exceptions-unit", value: unitId }}
      className="block rounded-card border border-hairline bg-canvas shadow-soft transition-colors hover:bg-soft"
    >
      <div className="flex items-center justify-between gap-2.5 px-4 pt-3.5 pb-[0.6875rem]">
        <h3 className="text-card-title font-semibold text-ink">Exceptions</h3>
        {total > 0 ? (
          <Pill tone="bad">{total} open</Pill>
        ) : (
          <Pill tone="ok">All clear</Pill>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 pb-3.5 text-meta text-body">
          No open exceptions — this store is on time.
        </p>
      ) : (
        <ul className="divide-y divide-hairline border-t border-hairline">
          {items.slice(0, 3).map((item) => (
            <li key={item.id} className="px-4 py-2 text-[0.875rem] text-body">
              <b className="text-ink">{exceptionKindLabel(item.kind)}</b> —{" "}
              {item.sentence}
            </li>
          ))}
        </ul>
      )}
    </AppLink>
  )
}
