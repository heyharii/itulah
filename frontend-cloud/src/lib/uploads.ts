import { uploadFile } from "@/lib/files"
import { ApiError } from "@itulah/contract/client"
import type { StoredFile } from "@itulah/contract"
import { useMemo, useState } from "react"

/// A file picked but not yet attached to anything.
export interface Staged {
  readonly key: string
  readonly name: string
  readonly size: number
  /// The row the server wrote, once the bytes have landed. A message attaches
  /// a `file_id`, so an upload still in flight has nothing to attach yet.
  readonly stored: StoredFile | null
  readonly error: string | null
}

/// Picking files, uploading them, and knowing which are ready to be named.
///
/// Upload is its own step because the server made it one: `POST /api/v1/files`
/// answers with a `file_id` and the message merely names it. A photograph
/// therefore finishes uploading while the sentence is still being typed, a slow
/// attachment never blocks a send, and a send that fails does not lose the
/// upload.
///
/// Shared by the conversation composer and the discussion reply box. They look
/// different — one sends on Enter, the other on a button — but this part is the
/// same, and two copies of it would drift the first time one grew a fix.
export function useStagedUploads() {
  const [staged, setStaged] = useState<Staged[]>([])

  const stage = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(16).slice(2, 8)}`
      setStaged((current) => [
        ...current,
        { key, name: file.name, size: file.size, stored: null, error: null },
      ])
      void uploadFile(file)
        .then((stored) => {
          setStaged((current) =>
            current.map((item) => (item.key === key ? { ...item, stored } : item)),
          )
        })
        .catch((error: unknown) => {
          setStaged((current) =>
            current.map((item) =>
              item.key === key
                ? {
                    ...item,
                    error: error instanceof ApiError ? error.message : "the upload failed",
                  }
                : item,
            ),
          )
        })
    }
  }

  const ready = useMemo(
    () =>
      staged
        .map((item) => item.stored)
        .filter((stored): stored is StoredFile => stored !== null),
    [staged],
  )

  return {
    staged,
    ready,
    /// True while bytes are still going out, so a screen can say so rather than
    /// looking idle.
    waiting: staged.some((item) => item.stored === null && item.error === null),
    stage,
    remove: (key: string) =>
      setStaged((current) => current.filter((item) => item.key !== key)),
    /// Drop what was just attached, and keep what is still uploading: those
    /// bytes belong to the next message, and discarding them would throw away a
    /// wait somebody has already sat through.
    takeReady: () => setStaged((current) => current.filter((item) => item.stored === null)),
  }
}
