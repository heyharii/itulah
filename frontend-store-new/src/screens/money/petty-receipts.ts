import { useQuery, useQueryClient } from "@tanstack/react-query"

/// The photo of a BKK's nota, kept on THIS device.
///
/// **The node has nowhere to put a photo.** An expense has no attachment, and
/// there is no upload route on the shop's node or at the centre, so the nota
/// the owner wants on every BKK is held here, in the browser's own database
/// (IndexedDB), under the id of the voucher's first record. It survives a
/// reload and a sleeping tablet; it does not reach head office and it is not on
/// the till in the next room. The day the node takes an upload, what is in here
/// is the backlog to send.
///
/// The picture is shrunk before it is kept — a phone's camera hands over 4000
/// pixels and 5 MB, and a nota is read at a fraction of that.

const DATABASE = "central-store-notas"
const STORE = "photos"
const LONGEST_EDGE = 1280

let opened: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No storage."))
  })
  // A failed open is not kept: the next try may be in a window that can.
  opened.catch(() => {
    opened = null
  })
  return opened
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("No storage."))
  })
}

/// A photo as a data URL, or `null` when this device holds none for the id.
export async function readNota(id: string): Promise<string | null> {
  try {
    const db = await database()
    const found = await done(
      db.transaction(STORE, "readonly").objectStore(STORE).get(id),
    )
    return typeof found === "string" ? found : null
  } catch {
    return null
  }
}

export async function keepNota(id: string, dataUrl: string): Promise<void> {
  const db = await database()
  await done(
    db.transaction(STORE, "readwrite").objectStore(STORE).put(dataUrl, id),
  )
}

/// A camera file, shrunk to a JPEG data URL.
export async function shrinkPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(
    1,
    LONGEST_EDGE / Math.max(bitmap.width, bitmap.height),
  )
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext("2d")
  if (context === null) {
    bitmap.close()
    throw new Error("This browser cannot draw the photo.")
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL("image/jpeg", 0.8)
}

const notaKey = (id: string) => ["petty", "nota", id] as const

/// The photo kept for a voucher, if this device has it.
export function useNota(id: string) {
  return useQuery({
    queryKey: notaKey(id),
    queryFn: () => readNota(id),
    // Held on this device and changed only by this app, below.
    staleTime: Infinity,
  })
}

/// Keep a photo for a voucher and let every place that shows it know.
export function useKeepNota() {
  const client = useQueryClient()
  return async (id: string, dataUrl: string) => {
    await keepNota(id, dataUrl)
    client.setQueryData(notaKey(id), dataUrl)
  }
}
