import type { QueryClient } from "@tanstack/react-query"
import { useSyncExternalStore } from "react"

import type { CreateSupplierItemRequest } from "@itulah/contract"
import { ApiError } from "@itulah/contract/client"

import { cacheKey } from "@/lib/api"
import {
  createCatalogPurchaseOrder,
  createSupplierItemWithPhoto,
  procurementKeys,
  supplierDetail,
} from "@/lib/queries/procurement"
import { toast } from "@/lib/toast"

/// Purchase orders made with no line to head office, held on this device until
/// there is one.
///
/// This is not a second way of making a purchase order. The buyer fills in the
/// same New PO form, presses the same Create PO, and the form does what it
/// always does — except that with no connection its last step is to put the
/// finished order here instead of sending it. It stands in the list as an order
/// that has not been sent yet, goes by itself the moment the connection is
/// back, and takes its number from the server then.
///
/// What is held is what Create PO would have sent, already worked out by the
/// form: the new items to create, and the order that lists them. Nothing here
/// knows how an order is priced. The order's key and each item's key were
/// minted when the buyer pressed Create PO and are never changed, so every
/// attempt — now, after a laptop sleeps, tomorrow morning in a second tab —
/// carries the same ones, and the server answers a repeat with the first
/// receipt instead of making the order twice.
///
/// IndexedDB, not localStorage, because a new item may carry its photograph —
/// a `Blob` — and localStorage can only hold text. One store, keyed by id.

/// What Create PO sends, minus the idempotency key (kept on the job).
type OrderBody = Parameters<typeof createCatalogPurchaseOrder>[0]

/// A new item to be created before the order that lists it.
export interface OutboxItem {
  /// The name the order's lines call it by until it exists (`draft:…`).
  readonly local_id: string
  /// Its own idempotency key, fixed when the item was typed.
  readonly key: string
  readonly request: CreateSupplierItemRequest
  /// The photograph taken for it, sent once the item exists.
  readonly photo: Blob | null
}

/// Where a held order stands:
///  - `waiting` — not sent. The ordinary state, offline or between attempts.
///  - `sending` — an attempt is running now.
///  - `refused` — the server read it and said no (a supplier that has since
///    been closed, a price past the ceiling). Sending again cannot change that;
///    somebody has to correct it. A dropped line is NOT a refusal — that goes
///    back to `waiting`, because the order is money head office has not heard
///    of yet.
export type OutboxState = "waiting" | "sending" | "refused"

export interface OutboxJob {
  readonly id: string
  /// Who made it — their login. An order held on a shared machine is sent as
  /// its maker and nobody else: whoever signs in next neither sees it nor
  /// sends it.
  readonly owner: string
  readonly created_at: string
  readonly updated_at: string
  readonly idempotency_key: string
  readonly supplier_id: string
  readonly supplier_name: string
  readonly items: readonly OutboxItem[]
  /// The order as it will be sent. A line for a new item names it by its
  /// `local_id`; that is swapped for the real id once the item exists.
  readonly body: OrderBody
  /// For the list, which has no order to ask: what the order comes to as the
  /// form worked it out.
  readonly line_count: number
  readonly pieces: number
  readonly value_minor: number
  readonly arrival: string | null
  /// The form as it was left, for taking the order back to correct it. Opaque
  /// here: the form wrote it and the form reads it.
  readonly form: unknown
  readonly state: OutboxState
  /// The server's sentence, when it refused.
  readonly refusal: string | null
}

const DB_NAME = "itulah-offline"
const STORE = "po-outbox"

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function store<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode)
      const request = run(tx.objectStore(STORE))
      tx.oncomplete = () => resolve(request.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

let jobs: readonly OutboxJob[] = []
const listeners = new Set<() => void>()

function announce(): void {
  for (const listener of listeners) listener()
}

function ordered(list: readonly OutboxJob[]): readonly OutboxJob[] {
  return [...list].sort((a, b) => a.created_at.localeCompare(b.created_at))
}

async function reload(): Promise<void> {
  try {
    const all = await store<OutboxJob[]>("readonly", (s) => s.getAll())
    jobs = ordered(all)
    announce()
  } catch (error) {
    console.error("po outbox: could not read the device", error)
  }
}

/// Other tabs write to the same store; tell this one to look again.
const channel =
  typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel("po-outbox")
channel?.addEventListener("message", () => void reload())

async function put(job: OutboxJob): Promise<void> {
  await store("readwrite", (s) => s.put(job))
  jobs = ordered([...jobs.filter((one) => one.id !== job.id), job])
  announce()
  channel?.postMessage("changed")
}

/// Hold an order. Rejects when the device would not take it — full, or storage
/// refused — and the caller must then keep the form open: an order that was
/// neither sent nor kept is the one failure this module must never allow.
export async function enqueueOrder(job: OutboxJob): Promise<void> {
  // Ask the browser not to clear this under storage pressure: it is the only
  // copy of an order head office has not heard of.
  void navigator.storage?.persist?.()
  await put(job)
}

/// Take an order off the device: it was sent, or the buyer took it back to the
/// form, or gave it up.
export async function removeOrder(id: string): Promise<void> {
  await store("readwrite", (s) => s.delete(id))
  jobs = jobs.filter((one) => one.id !== id)
  announce()
  channel?.postMessage("changed")
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/// React's window onto the held orders, oldest first.
export function useOutbox(): readonly OutboxJob[] {
  return useSyncExternalStore(
    subscribe,
    () => jobs,
    () => jobs
  )
}

/// Whether a refusal is the server's final word. A dropped line, a server
/// fault, a lapsed sign-in and "too many requests" all pass; a reasoned 4xx
/// does not.
function final(error: unknown): error is ApiError {
  if (!(error instanceof ApiError)) return false
  const status = error.status
  if (status < 400 || status >= 500) return false
  return status !== 401 && status !== 408 && status !== 429
}

async function send(client: QueryClient, job: OutboxJob): Promise<void> {
  await put({ ...job, state: "sending", refusal: null })
  try {
    // Items first, each under its own key: a second attempt after a dropped
    // line finds the ones already made instead of making them twice.
    const made = new Map<string, string>()
    const lost: string[] = []
    let supplierCode: string | undefined
    for (const item of job.items) {
      if (item.photo !== null && supplierCode === undefined) {
        supplierCode = (await supplierDetail(job.supplier_id)).supplier_code
      }
      const { item: created, photoTrouble } = await createSupplierItemWithPhoto(
        job.supplier_id,
        item.request,
        item.photo,
        supplierCode,
        item.key
      )
      made.set(item.local_id, created.supplier_item_id)
      if (photoTrouble !== null) lost.push(item.request.name)
    }
    const receipt = await createCatalogPurchaseOrder(
      {
        ...job.body,
        lines: job.body.lines.map((line) => ({
          ...line,
          supplier_item_id:
            made.get(line.supplier_item_id) ?? line.supplier_item_id,
        })),
      },
      job.idempotency_key
    )
    await removeOrder(job.id)
    void client.invalidateQueries({ queryKey: procurementKeys.orders() })
    void client.invalidateQueries({ queryKey: procurementKeys.supplierItems() })
    toast.success(`${receipt.po_number} created`)
    if (lost.length > 0)
      toast.error(
        `${lost.join(", ")}: the photo could not be saved. Add it from the item.`
      )
  } catch (error) {
    if (final(error)) {
      await put({
        ...job,
        state: "refused",
        refusal: error.message,
        updated_at: new Date().toISOString(),
      })
      return
    }
    // Back to waiting, to be tried again: a transport failure is not an answer.
    await put({ ...job, state: "waiting", refusal: null })
  }
}

let flushing = false

/// Send the signed-in buyer's waiting orders, oldest first. One at a time, one
/// tab at a time (`navigator.locks`), and only with a connection.
export async function flushOutbox(client: QueryClient): Promise<void> {
  if (flushing || !navigator.onLine) return
  const me = client.getQueryData<{ username?: string } | null>(cacheKey.me())
  if (me == null || me.username === undefined) return
  const mine = (job: OutboxJob) =>
    job.owner === me.username && job.state !== "refused"
  if (!jobs.some(mine)) return
  flushing = true
  try {
    const run = async () => {
      // Read again under the lock: another tab may have sent them already.
      await reload()
      // Holding the lock, nobody else is sending: an order still marked
      // `sending` is one a closed page left half done. Its keys finish it.
      for (const job of jobs.filter(mine)) {
        if (!navigator.onLine) break
        await send(client, job)
      }
    }
    if (navigator.locks !== undefined)
      await navigator.locks.request("po-outbox-flush", run)
    else await run()
  } finally {
    flushing = false
  }
}

/// Start sending held orders, for the life of the page: once they are read off
/// the device, when the connection comes back, and every half minute while any
/// is waiting. Called once, from `main.tsx`.
export function startOutbox(client: QueryClient): void {
  void reload().then(() => flushOutbox(client))
  window.addEventListener("online", () => void flushOutbox(client))
  window.setInterval(() => void flushOutbox(client), 30_000)
}
