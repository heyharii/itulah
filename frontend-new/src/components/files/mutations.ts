/**
 * Files' write boundary, built on TanStack Query's `useMutation` +
 * `useQueryClient` — this domain never used a write wrapper; it called the raw
 * fetchers from `./api` directly and reloaded the one list they all affect by
 * hand (`files.tsx`'s old `driveWrite` helper). That is exactly the pattern
 * §M1 rules out — the screen owning a cache effect that belongs with the
 * write — so it moves here.
 *
 * There is exactly one query in this domain, `fileQueries.library()` (see
 * `./queries`): folders, files, favourites, trash and shares all live in one
 * response. Every write below therefore invalidates that same single key —
 * it is simultaneously the narrowest and the widest affected prefix (§M2),
 * because there is only one.
 *
 * Shape per write, from the docs/frontend-rules.md §M3 table:
 *
 *  - `useCreateLibraryFolder` and `useShareLibraryFile` back composers that
 *    `files.tsx` already closes at the moment the write is fired (`setCreating
 *    (false)` / `setSharing(null)` happen before the request settles) — the
 *    "sheet that closes on success" row. Neither shape.
 *
 *  - `useSetLibraryTrashed` moves a whole selection to (or out of) the bin.
 *    Multiple scopes read the same list — the current folder view loses the
 *    rows, the Trash scope gains them — but both are the *same* query key, so
 *    there is nothing to patch across separate caches; the existing UX (the
 *    rows disappear only once the refetch lands, never before) already is
 *    "wait for the server." Neither shape, kept as-is.
 *
 *  - `useSetLibraryFavourite` is the canonical variables-based example the
 *    rules name directly — a star, in one place. `files.tsx` reads
 *    `variables`/`isPending` off it to show the toggled star immediately,
 *    with no cache write.
 *
 *  - `useUnshareLibraryFile` revokes one person's access from the file-detail
 *    sheet, which stays open afterwards — one place on screen. `files.tsx`
 *    filters that person out of the rendered list while the mutation is
 *    pending, the same variables-based technique, again without touching the
 *    cache.
 *
 *  - `useMoveLibraryFile` wraps a real write (`moveLibraryFile` in `./api`)
 *    that no screen currently calls — nothing in `files.tsx` offers a move
 *    action. It is included for parity with the rest of this file's writes,
 *    unwired, exactly as it was before this pass (`moveLibraryFile` itself
 *    was already dead code). Neither shape, since nothing renders it yet.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import {
  createLibraryFolder,
  moveLibraryFile,
  setLibraryFavourite,
  setLibraryTrashed,
  shareLibraryFile,
  unshareLibraryFile,
} from "./api"
import { fileQueries } from "./queries"
import type { FileNode } from "./data"

function useInvalidateLibrary() {
  const client = useQueryClient()
  const key = fileQueries.library().queryKey
  return () => void client.invalidateQueries({ queryKey: key })
}

export interface CreateLibraryFolderInput {
  name: string
  parentId: string
}

/** Creates a folder. The composer is already closed by the time this fires. */
export function useCreateLibraryFolder() {
  const invalidate = useInvalidateLibrary()
  return useMutation({
    mutationFn: (input: CreateLibraryFolderInput) =>
      createLibraryFolder(input.name, input.parentId),
    onSettled: invalidate,
  })
}

export interface SetLibraryFavouriteInput {
  id: string
  favourite: boolean
}

/**
 * Stars or unstars one file. Variables-based (§M3): the caller renders the
 * toggled star from `variables`/`isPending`, so nothing here touches the
 * cache beyond the ordinary settle-time invalidation.
 */
export function useSetLibraryFavourite() {
  const invalidate = useInvalidateLibrary()
  return useMutation({
    mutationFn: (input: SetLibraryFavouriteInput) =>
      setLibraryFavourite(input.id, input.favourite),
    onSettled: invalidate,
  })
}

export interface SetLibraryTrashedInput {
  nodes: FileNode[]
  trashed: boolean
}

/**
 * Moves a whole selection into, or out of, the bin. Folders are trashed last
 * by the caller: the hub refuses to bin a folder that still holds live items.
 */
export function useSetLibraryTrashed() {
  const invalidate = useInvalidateLibrary()
  return useMutation({
    mutationFn: async (input: SetLibraryTrashedInput) => {
      for (const node of input.nodes) {
        await setLibraryTrashed(node, input.trashed)
      }
    },
    onSettled: invalidate,
  })
}

export interface ShareLibraryFileInput {
  id: string
  subjectId: string
}

/** Grants one subject access. The share sheet is already closed by the time
 *  this fires. */
export function useShareLibraryFile() {
  const invalidate = useInvalidateLibrary()
  return useMutation({
    mutationFn: (input: ShareLibraryFileInput) =>
      shareLibraryFile(input.id, input.subjectId),
    onSettled: invalidate,
  })
}

/**
 * Revokes one subject's grant. Variables-based (§M3): the detail sheet stays
 * open, so the caller filters the removed subject out of the rendered people
 * list from `variables`/`isPending` rather than patching the cache.
 */
export function useUnshareLibraryFile() {
  const invalidate = useInvalidateLibrary()
  return useMutation({
    mutationFn: (input: ShareLibraryFileInput) =>
      unshareLibraryFile(input.id, input.subjectId),
    onSettled: invalidate,
  })
}

export interface MoveLibraryFileInput {
  attachmentId: string
  folderId: string
}

/** Files one item into a folder. Not wired to any screen yet — see the module
 *  note above. */
export function useMoveLibraryFile() {
  const invalidate = useInvalidateLibrary()
  return useMutation({
    mutationFn: (input: MoveLibraryFileInput) =>
      moveLibraryFile(input.attachmentId, input.folderId),
    onSettled: invalidate,
  })
}
