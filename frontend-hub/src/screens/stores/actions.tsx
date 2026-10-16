import { Menu } from "@base-ui/react/menu"
import { Fragment, useState } from "react"
import { ChevronDown, MoreHorizontal } from "lucide-react"

import { button, type ButtonStyle } from "@/components/ui/button-style"
import { Card } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { ITEM, POPUP } from "@/lib/filter-chrome"
import { ago, moment } from "@/lib/format"
import {
  useRequestStoreAction,
  useStoreActionHistory,
  useStoreActionMenu,
  type StoreActionEntry,
  type StoreActionOption,
} from "@/lib/queries/store-actions"
import { queryState } from "@/lib/query-state"
import { Pill } from "@/components/ui/pill"
import { EmptyState } from "@/components/ui/states"
import { cn } from "@/lib/utils"

/// The Actions menu (remote actions, 28 Sep 2026): head office asking a
/// store's server or one of its devices to do something, watched to a finish
/// on the Activity tab. See `STORE-SERVER-PLAN.md` §9e and
/// `lib/queries/store-actions.ts`.
///
/// One dialog for every dangerous or note-carrying item, shared by the
/// server button and every device's kebab, rather than each item inventing
/// its own — see `ActionsMenu` below for why it lives outside the popup.

const STATE_TONE: Readonly<
  Record<StoreActionEntry["state"], "neutral" | "info" | "ok" | "bad">
> = {
  QUEUED: "neutral",
  SENT: "info",
  RUNNING: "info",
  DONE: "ok",
  FAILED: "bad",
  EXPIRED: "neutral",
}

const STATE_WORD: Readonly<Record<StoreActionEntry["state"], string>> = {
  QUEUED: "Queued",
  SENT: "Sent",
  RUNNING: "Running",
  DONE: "Done",
  FAILED: "Failed",
  EXPIRED: "Expired",
}

function MenuItemRow({
  option,
  onPress,
}: {
  option: StoreActionOption
  onPress: () => void
}) {
  return (
    <Menu.Item
      disabled={!option.enabled}
      onClick={() => option.enabled && onPress()}
      closeOnClick={option.enabled}
      className={cn(
        ITEM,
        "flex-col items-start gap-0",
        !option.enabled &&
          "cursor-default opacity-60 data-[highlighted]:bg-transparent"
      )}
    >
      <span>{option.label}</span>
      {!option.enabled && option.reason_disabled && (
        <span className="text-meta text-mute">{option.reason_disabled}</span>
      )}
    </Menu.Item>
  )
}

/// A menu of `StoreActionOption`s, its trigger, and the one confirmation
/// dialog every dangerous or note-carrying item shares.
///
/// The dialog is a SIBLING of `<Menu.Root>`, not a child of a `Menu.Item` —
/// Base UI unmounts a menu's popup the moment it closes (which happens on
/// selection, by default), and an item that opened a dialog nested inside
/// that popup would have it torn down with the menu before anybody read it.
export function ActionsMenu({
  unit,
  items,
  label,
  ariaLabel,
  variant = "ghost",
  size,
}: {
  unit: string
  items: readonly StoreActionOption[]
  /// The trigger's own content — "Actions" and a chevron, or a bare kebab
  /// icon for a device row.
  label: React.ReactNode
  ariaLabel?: string
  variant?: ButtonStyle["variant"]
  size?: ButtonStyle["size"]
}) {
  const request = useRequestStoreAction(unit)
  const [confirming, setConfirming] = useState<StoreActionOption | null>(null)
  const [failure, setFailure] = useState<unknown>(null)

  function send(option: StoreActionOption, note: string) {
    return request.mutateAsync({
      key: option.key,
      request: {
        device_id: option.device_id ?? undefined,
        note: note.trim() === "" ? undefined : note,
        confirm: option.danger ? true : undefined,
      },
    })
  }

  function press(option: StoreActionOption) {
    if (option.danger || option.note_required) {
      setConfirming(option)
      setFailure(null)
      return
    }
    void send(option, "")
  }

  if (items.length === 0) return null

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label={ariaLabel}
          className={cn(button({ variant, size }))}
        >
          {label}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            side="bottom"
            align="end"
            sideOffset={4}
            className="z-50"
          >
            <Menu.Popup className={cn(POPUP, "min-w-56")}>
              {items.map((option) => (
                <MenuItemRow
                  key={option.key}
                  option={option}
                  onPress={() => press(option)}
                />
              ))}
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Dialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next) {
            setConfirming(null)
            setFailure(null)
          }
        }}
        title={confirming?.label ?? ""}
        confirm={confirming?.label ?? "Confirm"}
        tone={confirming?.danger ? "danger" : "primary"}
        pending={request.isPending}
        problem={failure}
        reason={
          confirming
            ? {
                label: "Note",
                optional: !confirming.note_required,
              }
            : undefined
        }
        onConfirm={(note) => {
          if (!confirming) return
          const option = confirming
          setFailure(null)
          void send(option, note).then(
            () => setConfirming(null),
            (error: unknown) => setFailure(error)
          )
        }}
      >
        {confirming?.confirm_sentence}
      </Dialog>
    </>
  )
}

/// The Server tab's own "Actions" button — every `target: "server"` item,
/// hidden outright when the menu could not be read (403: not Admin, owner or
/// IT) or when this caller may not act on anything in it.
export function ServerActionsButton({ unit }: { unit: string }) {
  const menu = useStoreActionMenu(unit)
  if (menu.data === undefined || !menu.data.can_act) return null
  const items = menu.data.items.filter((item) => item.target === "server")
  return (
    <ActionsMenu
      unit={unit}
      items={items}
      label={
        <>
          Actions
          <ChevronDown className="size-3.5" />
        </>
      }
    />
  )
}

/// One device's kebab, over `suspend_device` / `reactivate_device` /
/// `revoke_device` — `test_print` keeps its own button on the row
/// (`devices-tab.tsx`), which predates this menu and already does the same
/// thing through a simpler endpoint.
export function DeviceActionsMenu({
  unit,
  deviceId,
}: {
  unit: string
  deviceId: string
}) {
  const menu = useStoreActionMenu(unit)
  if (menu.data === undefined || !menu.data.can_act) return null
  const items = menu.data.items.filter(
    (item) =>
      item.target === "device" &&
      item.device_id === deviceId &&
      item.key !== "test_print"
  )
  if (items.length === 0) return null
  return (
    <ActionsMenu
      unit={unit}
      items={items}
      label={<MoreHorizontal className="size-4" />}
      ariaLabel="Device actions"
      variant="quiet"
      size="icon"
    />
  )
}

// ---- Activity: the history, watched to a finish ----------------------------

/// A `store_action.detail` blob, or a diagnosis's `checks`/`report`, drawn as
/// key/value rows rather than a JSON dump — one level deep is enough for
/// everything the node actually sends (a backup's size, a sync's queue, a
/// diagnosis's checks and its report), and anything deeper still reads,
/// just nested.
function humanKey(key: string): string {
  const words = key.replace(/_/g, " ")
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function DetailValue({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-mute">—</span>
  if (typeof value === "boolean") return <span>{value ? "Yes" : "No"}</span>
  if (typeof value === "number" || typeof value === "string")
    return <span>{String(value)}</span>
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-mute">—</span>
    if (value.every((item) => !isPlainObject(item) && !Array.isArray(item)))
      return <span>{value.map(String).join(", ")}</span>
    return (
      <ul className="flex flex-col gap-1.5">
        {value.map((item, index) => (
          <li key={index} className="rounded-inner bg-soft-2 p-2">
            {isPlainObject(item) ? (
              <DetailRows detail={item} />
            ) : (
              <DetailValue value={item} />
            )}
          </li>
        ))}
      </ul>
    )
  }
  if (isPlainObject(value)) return <DetailRows detail={value} />
  return <span>{JSON.stringify(value)}</span>
}

function DetailRows({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail)
  if (entries.length === 0) return null
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-meta">
      {entries.map(([key, value]) => (
        <Fragment key={key}>
          <dt className="text-mute">{humanKey(key)}</dt>
          <dd className="min-w-0 text-body">
            <DetailValue value={value} />
          </dd>
        </Fragment>
      ))}
    </dl>
  )
}

function HistoryRow({ entry }: { entry: StoreActionEntry }) {
  const hasDetail = Object.keys(entry.detail).length > 0
  return (
    <li className="flex flex-col gap-1.5 px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <b className="text-[0.9375rem] font-semibold text-ink">
              {entry.label}
            </b>
            <Pill tone={STATE_TONE[entry.state]}>
              {STATE_WORD[entry.state]}
            </Pill>
          </div>
          <p className="mt-0.5 text-meta text-body">
            {entry.device_label ? `${entry.device_label} · ` : ""}
            {entry.requested_by} · {moment(entry.requested_at)}
          </p>
        </div>
        {(entry.state === "QUEUED" ||
          entry.state === "SENT" ||
          entry.state === "RUNNING") && (
          <span className="shrink-0 text-meta text-mute">
            expires {ago(entry.expires_at)}
          </span>
        )}
      </div>
      {entry.result_sentence && (
        <p className="text-[0.9375rem] text-body">{entry.result_sentence}</p>
      )}
      {entry.note && <p className="text-meta text-mute">Note: {entry.note}</p>}
      {hasDetail && (
        <details className="text-meta">
          <summary className="cursor-pointer text-body select-none">
            Details
          </summary>
          <div className="mt-2 rounded-inner bg-soft-2 p-2.5">
            <DetailRows detail={entry.detail} />
          </div>
        </details>
      )}
    </li>
  )
}

/// The store page's "Activity" tab: every action asked of this store's
/// server or its devices, newest first, polled every five seconds while any
/// of them is still on its way.
export function ActivityTab({ unit }: { unit: string }) {
  const history = useStoreActionHistory(unit)
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <Card className="overflow-hidden">
        {queryState(history, {
          loading: "Reading the activity…",
          render: (page) =>
            page.items.length === 0 ? (
              <EmptyState>
                Nothing has been asked of this store from head office yet.
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline">
                {page.items.map((entry) => (
                  <HistoryRow key={entry.action_id} entry={entry} />
                ))}
              </ul>
            ),
        })}
      </Card>
    </div>
  )
}
