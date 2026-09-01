import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { zodValidator } from "@tanstack/zod-adapter"
import { z } from "zod"

import { Files } from "@/components/files/files"
import { FilesError, FilesPending } from "@/components/files/route-states"
import { fileQueries } from "@/components/files/queries"

/**
 * What Drive is showing: the sidebar scope, the folder you are in, the
 * search, the layout, the sort, and the file whose detail sheet is open.
 * Multi-select, the new-folder draft and the share sheet stay local.
 */
const searchSchema = z.object({
  scope: z
    .enum(["drive", "shared", "recent", "starred", "trash"])
    .default("drive"),
  /** Folder id inside My Drive. Absent means the root. */
  folder: z.string().optional(),
  q: z.string().optional(),
  layout: z.enum(["list", "grid"]).default("list"),
  sort: z.enum(["name", "modified", "size"]).default("name"),
  dir: z.enum(["asc", "desc"]).default("asc"),
  /** The file the detail sheet is showing, by id. */
  open: z.string().optional(),
})

export type FilesSearch = z.infer<typeof searchSchema>

/** A bare `/files` is My Drive, by name. Defaults are stripped so it stays that way. */
const SEARCH_DEFAULTS: Partial<FilesSearch> = {
  scope: "drive",
  layout: "list",
  sort: "name",
  dir: "asc",
}

export const Route = createFileRoute("/files")({
  validateSearch: zodValidator(searchSchema),
  search: { middlewares: [stripSearchParams(SEARCH_DEFAULTS)] },

  /* `scope`, `folder`, `q`, `layout` and `sort` are all client-side views
   * over the one flat listing the library query returns — none of them
   * change what is fetched, so no `loaderDeps` is needed. */
  loader: async ({ context: { queryClient } }) => {
    await queryClient.query({ ...fileQueries.library(), staleTime: "static" })
  },

  component: Files,
  pendingComponent: FilesPending,
  errorComponent: FilesError,
})
