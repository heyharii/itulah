import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { Camera } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { PhotoImg } from "@/components/ui/photo-img"
import { PhotoViewer } from "@/components/ui/photo-viewer"
import { buildOf } from "@/lib/builds"
import { PICTURE_TYPES, asJpeg } from "@/lib/image"
import { gaKeys } from "@/lib/queries/ga"
import {
  documentContentUrl,
  searchDocuments,
  uploadDocument,
} from "@/lib/queries/workplace"
import { toast } from "@/lib/toast"
import { cn } from "@/lib/utils"
import { TextAction } from "@/screens/assets/asset-sections"
import type { GaAssetRow } from "@itulah/contract"

/// An asset's photograph.
///
/// # A document, not a column
///
/// The photo is filed in the Library like every other file about the asset —
/// linked to it, under `GA › <number> › Photos`, with the document type
/// `PHOTO` — so it needs nothing new on the server. The newest one is the
/// asset's photo; changing it files another and the old one stays in the
/// Library, as a replaced paper does.
export const PHOTO_TYPE = "PHOTO"
const PHOTO_FOLDER = "Photos"

/// Every asset's photo in one request: asset id → document id, newest first
/// wins. Under the GA prefix, so every GA write refreshes it.
export const assetPhotosQuery = () =>
  queryOptions({
    queryKey: [...gaKeys.all, "photos"] as const,
    queryFn: async ({ signal }) => {
      const documents = await searchDocuments(
        { path: [PHOTO_FOLDER], subjectKind: "asset", limit: 200 },
        signal
      )
      const photos = new Map<string, string>()
      for (const document of documents) {
        if (document.doc_type !== PHOTO_TYPE) continue
        for (const link of document.links) {
          if (link.subject_kind !== "asset") continue
          if (!photos.has(link.subject_id))
            photos.set(link.subject_id, document.document_id)
        }
      }
      return photos
    },
  })

/// The photo's address, or null while there is none.
export function useAssetPhoto(assetId: string): string | null {
  const photos = useQuery(assetPhotosQuery())
  const documentId = photos.data?.get(assetId)
  return documentId === undefined ? null : documentContentUrl(documentId)
}

/// File a photo against an asset.
export async function uploadAssetPhoto(
  asset: Pick<GaAssetRow, "asset_id" | "asset_number">,
  file: File
) {
  const photo = await asJpeg(file)
  return uploadDocument(photo, {
    title: `Photo · ${asset.asset_number}`,
    doc_type: PHOTO_TYPE,
    path_tokens: ["GA", asset.asset_number, PHOTO_FOLDER],
    tags: [],
    links: [{ subject_kind: "asset", subject_id: asset.asset_id }],
  })
}

/// The small square at the start of a register row: the photo, or the
/// asset type's icon on grey.
export function AssetThumb({
  assetId,
  build,
  className,
}: {
  assetId: string
  build: string
  className?: string
}) {
  const url = useAssetPhoto(assetId)
  const Icon = buildOf(build).icon
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-inner bg-soft-2",
        className
      )}
    >
      {url === null ? (
        <Icon className="size-4.5 text-line-ico" strokeWidth={1.7} />
      ) : (
        <PhotoImg url={url} alt="" className="size-full object-cover" />
      )}
    </span>
  )
}

/// The photo at the top of an asset's sheet: large, opened full size on a
/// tap, changed from the corner. With none, the empty frame is the button.
export function AssetPhotoPanel({ asset }: { asset: GaAssetRow }) {
  const client = useQueryClient()
  const url = useAssetPhoto(asset.asset_id)
  const picker = useRef<HTMLInputElement>(null)
  const [viewing, setViewing] = useState(false)

  const upload = useMutation({
    mutationFn: (file: File) => uploadAssetPhoto(asset, file),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: gaKeys.all })
      toast.success("Photo saved")
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Photo not saved"),
  })
  const choose = () => picker.current?.click()

  return (
    <section className="flex items-end gap-4">
      {url === null ? (
        <button
          type="button"
          onClick={choose}
          disabled={upload.isPending}
          aria-label="Add photo"
          className="flex size-40 shrink-0 flex-col items-center justify-center gap-2 rounded-card border border-dashed border-hairline bg-soft-2 text-[0.9375rem] font-medium text-accent transition-[opacity,scale] duration-(--t-press) ease-(--ease-out) hover:opacity-80 active:scale-[0.97]"
        >
          <Camera className="size-6" strokeWidth={1.7} />
          {upload.isPending ? "Uploading…" : "Add photo"}
        </button>
      ) : (
        <>
          <button
            type="button"
            aria-label={`Photo of ${asset.name}`}
            onClick={() => setViewing(true)}
            className="block size-40 shrink-0 overflow-hidden rounded-card bg-soft-2 transition-[scale] duration-(--t-press) ease-(--ease-out) active:scale-[0.97]"
          >
            <PhotoImg
              url={url}
              alt={asset.name}
              eager
              className="size-full object-cover"
            />
          </button>
          <TextAction onClick={choose}>
            <Camera />
            {upload.isPending ? "Uploading…" : "Change photo"}
          </TextAction>
          <PhotoViewer
            open={viewing}
            onOpenChange={setViewing}
            url={url}
            name={asset.name}
          />
        </>
      )}
      <input
        ref={picker}
        type="file"
        accept={PICTURE_TYPES}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (file !== undefined) upload.mutate(file)
        }}
      />
    </section>
  )
}

/// The photo on the Register asset form, held until the asset exists: it is
/// filed against the new asset once Register succeeds.
export function PhotoPick({
  file,
  onChange,
}: {
  file: File | null
  onChange: (file: File | null) => void
}) {
  const picker = useRef<HTMLInputElement>(null)
  const preview = useMemo(
    () => (file === null ? null : URL.createObjectURL(file)),
    [file]
  )
  useEffect(
    () => () => {
      if (preview !== null) URL.revokeObjectURL(preview)
    },
    [preview]
  )

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => picker.current?.click()}
        aria-label={file === null ? "Add photo" : "Change photo"}
        className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-card border border-dashed border-hairline bg-soft-2 transition-[opacity,scale] duration-(--t-press) ease-(--ease-out) hover:opacity-80 active:scale-[0.97]"
      >
        {preview === null ? (
          <Camera className="size-6 text-accent" strokeWidth={1.7} />
        ) : (
          <img src={preview} alt="" className="size-full object-cover" />
        )}
      </button>
      <div className="flex flex-col items-start gap-1">
        <TextAction onClick={() => picker.current?.click()}>
          {file === null ? "Add photo" : "Change photo"}
        </TextAction>
        {file !== null && (
          <TextAction onClick={() => onChange(null)}>Remove</TextAction>
        )}
      </div>
      <input
        ref={picker}
        type="file"
        accept={PICTURE_TYPES}
        className="hidden"
        onChange={(event) => {
          const next = event.target.files?.[0]
          event.target.value = ""
          if (next !== undefined) onChange(next)
        }}
      />
    </div>
  )
}
