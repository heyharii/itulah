import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { AppLink } from "@/components/ui/app-link"
import { Button } from "@/components/ui/button"
import { useDirtyGuard } from "@/components/ui/dirty-guard"
import { PhotoImg } from "@/components/ui/photo-img"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { Thumbnail } from "@/components/ui/thumbnail"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { articleDetail, articleKeys } from "@/lib/queries/articles"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { ArticleEditForm, useArticleEditor } from "@/screens/master/article-edit"
import { useArticlePictures } from "@/screens/master/article-pictures"
import { purchaseOf } from "@/screens/master/article-grid"
import { ArticleView } from "@/screens/master/article-view"
import { termLabel } from "@/screens/procurement/shared"
import { useSupplierName } from "@/screens/procurement/supplier-name"

/// One article, whole.
///
/// Nowhere in the app showed a product as itself before this: the catalogue was
/// readable only through a price list, which meant a merchandiser asking "what
/// do we sell" got a company price and had to ignore half the answer.
///
/// It reads like a shop page — the picture, the colours, the sizes and the
/// price together, the variants as a grid below — and shows only what New
/// articles set up: the purchase price and its supplier, the selling price and
/// its markup, the division, the tags and what is in stock. `article-view.tsx`
/// draws it; `article-edit.tsx` is the Edit form.
///
/// The identity is drawn but never offered for editing. An article code and its
/// SKU codes come from a setup session at the centre and are already encoded
/// into the EPCs tagged onto goods; the Edit control opens attributes only.

export function ArticleSheet({
  articleCode,
  open,
  onClose,
  edit = false,
  stock = true,
  readOnly = false,
}: {
  articleCode: string | null
  open: boolean
  onClose: () => void
  /// Open on the edit form rather than the overview: the card's Edit button.
  edit?: boolean
  /// False leaves the stock out (the Ops flow: owner, 16 Oct 2026).
  stock?: boolean
  /// True hides the Edit control.
  readOnly?: boolean
}) {
  const [editing, setEditing] = useState(edit)

  /// Reset when the sheet moves to a different article, adjusting state during
  /// render rather than in an effect: an effect would let one frame of the new
  /// article draw under an edit form still holding the previous article's typed
  /// values.
  const [shown, setShown] = useState(articleCode)
  if (shown !== articleCode) {
    setShown(articleCode)
    setEditing(edit)
  }

  const detail = useQuery({
    queryKey: articleKeys.article(articleCode ?? ""),
    queryFn: ({ signal }) => articleDetail(articleCode!, signal),
    enabled: open && articleCode !== null,
  })
  const article = detail.data

  const vocabulary = useQuery({
    queryKey: procurementKeys.vocabulary(),
    queryFn: ({ signal }) => catalogueVocabulary(signal),
    // Closed sets that change when somebody adds a division, not while
    // somebody is reading an article.
    staleTime: 30 * 60 * 1000,
  })

  const pictures = useArticlePictures(article)
  const editor = useArticleEditor({
    article,
    vocabulary: vocabulary.data,
    pictures,
    editing,
    onSaved: () => setEditing(false),
    onLeave: () => setEditing(false),
  })
  // Cancel asks first when there is typed work, the same way ×, Esc and the
  // veil do (the sheet's own `dirty`).
  const guard = useDirtyGuard(editing && editor.dirty)
  const supplierName = useSupplierName()

  /// The head, as option F draws it (owner, 2026-10-15): the photo at 64px
  /// beside the name, and under it division · tags · the supplier, a link.
  const purchase = article === undefined ? null : purchaseOf(article)
  const division =
    article?.division_code == null
      ? null
      : termLabel(vocabulary.data?.divisions, article.division_code)
  const tags = (article?.tags ?? []).map((code) =>
    termLabel(vocabulary.data?.tags, code)
  )
  const filed = [division, ...tags].filter(Boolean).join(" · ")
  const caption =
    article === undefined || editing ? undefined : (
      <>
        {filed}
        {purchase !== null && (
          <>
            {filed !== "" && " · "}
            <AppLink
              to="/procurement/suppliers"
              sheet={{ key: "supplier", value: purchase.supplierId }}
              className="text-accent hover:underline"
            >
              {supplierName(null, purchase.supplier, purchase.supplierId)}
            </AppLink>
          </>
        )}
      </>
    )
  const media =
    article === undefined || editing ? undefined : pictures.main ? (
      <PhotoImg
        url={pictures.main}
        alt={article.name}
        className="size-full object-cover"
      />
    ) : (
      <Thumbnail
        url={null}
        name={article.name}
        division={division}
        className="size-full"
      />
    )

  return (
    <>
      <Sheet
        open={open && articleCode !== null}
        subject={
          articleCode === null ? undefined : { kind: "article", id: articleCode }
        }
        onOpenChange={(next, reason) => {
          if (next) return
          // Esc leaves the edit and not the sheet; × leaves the sheet.
          if (editing && reason === "escape") {
            editor.reset()
            setEditing(false)
            return
          }
          onClose()
        }}
        size="wide"
        stack
        dirty={editing && editor.dirty}
        id={article?.article_code ?? articleCode ?? undefined}
        title={article?.name ?? "Article"}
        caption={caption}
        media={media}
        badge={
          article !== undefined && !article.active ? (
            <Pill tone="neutral">Non-active</Pill>
          ) : undefined
        }
        footer={
          article === undefined || (readOnly && !editing) ? undefined : editing ? (
            <SheetFooter
              onCancel={() =>
                guard.request(() => {
                  editor.reset()
                  setEditing(false)
                })
              }
              error={editor.error}
              primary={{
                label:
                  editor.accepted && editor.scheduled.length > 0
                    ? "Save anyway"
                    : "Save changes",
                onClick: editor.submit,
                pending: editor.saving,
                disabled: !editor.dirty || !editor.valid || editor.stale,
              }}
            />
          ) : (
            // Edit is a ghost, not the blue main act (hub-ui-patterns, 14 Oct):
            // a read-only record has no main act.
            <SheetFooter
              secondary={
                <Button variant="ghost" onClick={() => setEditing(true)}>
                  Edit
                </Button>
              }
            />
          )
        }
      >
        {queryState(detail, {
          loading: "Loading the article…",
          render: (one) =>
            editing ? (
              <ArticleEditForm
                article={one}
                vocabulary={vocabulary.data}
                pictures={pictures}
                editor={editor}
              />
            ) : (
              <ArticleView
                key={one.article_code}
                article={one}
                vocabulary={vocabulary.data}
                pictures={pictures}
                stock={stock}
              />
            ),
        })}
      </Sheet>
      {guard.dialog}
    </>
  )
}
