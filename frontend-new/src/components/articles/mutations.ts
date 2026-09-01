/**
 * Articles' write boundary, built directly on TanStack Query's `useMutation`.
 *
 * `createTag` and `createDivision` back a sheet that closes on success
 * (articles.tsx's `creating` state resets to `null` once `save()` resolves),
 * so per docs/tanstack-gap-plan.md §0 there is nothing to patch
 * optimistically before the write lands — no `onMutate`, no rollback.
 *
 * But the write *does* return the saved row, and the tag/division vocabulary
 * it belongs to is read in more than one place on the same screen (the
 * filter rail, the chip picker in the sheet itself) — M7 applies: seed the
 * catalogue cache with the row the server actually minted and mark it stale
 * without a round trip (`refetchType: "none"`), instead of leaving the
 * screen to hold a second, component-local list that a future refetch of the
 * catalogue would silently drop.
 *
 * M5 holds either way — `id` is never guessed here, only ever the id Go
 * returned.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { toApiMutation, type ApiMutation } from "@/lib/api"
import {
  createDivision,
  createTag,
  type ArticleCatalogue,
  type Division,
  type Tag,
} from "./api"
import { articlesQueries } from "./queries"

/** Creates a tag and folds the server's row into the catalogue cache. */
export function useCreateTag(): ApiMutation<string, Tag> {
  const client = useQueryClient()
  /* The catalogue key now carries the screen's filters, so there is one entry
   * per filter combination the user has visited. A new tag belongs in all of
   * them — hence setQueriesData over the whole articles subtree rather than
   * setQueryData on one key. */
  const key = articlesQueries.all()

  const mutation = useMutation<Tag, Error, string>({
    mutationFn: (name) => createTag(name),
    onSuccess: (tag) => {
      client.setQueriesData<ArticleCatalogue>({ queryKey: key }, (current) =>
        current ? { ...current, tags: [...current.tags, tag] } : current
      )
      void client.invalidateQueries({ queryKey: key, refetchType: "none" })
    },
  })

  return toApiMutation(mutation)
}

export interface CreateDivisionInput {
  code: string
  name: string
  sortOrder?: number
}

/** Creates a division and folds the server's row into the catalogue cache. */
export function useCreateDivision(): ApiMutation<CreateDivisionInput, Division> {
  const client = useQueryClient()
  const key = articlesQueries.all()

  const mutation = useMutation<Division, Error, CreateDivisionInput>({
    mutationFn: (input) => createDivision(input),
    onSuccess: (division) => {
      client.setQueriesData<ArticleCatalogue>({ queryKey: key }, (current) =>
        current ? { ...current, divisions: [...current.divisions, division] } : current
      )
      void client.invalidateQueries({ queryKey: key, refetchType: "none" })
    },
  })

  return toApiMutation(mutation)
}
