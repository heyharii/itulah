import { useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { useDirtyGuard } from "@/components/ui/dirty-guard"
import { Pill } from "@/components/ui/pill"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { articleDetail, articleKeys } from "@/lib/queries/articles"
import { catalogueVocabulary, procurementKeys } from "@/lib/queries/procurement"
import { queryState } from "@/lib/query-state"
import { ArticleEditForm, useArticleEditor } from "@/screens/master/article-edit"
import { useArticlePictures } from "@/screens/master/article-pictures"
import { ArticleView } from "@/screens/master/article-view"

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
}: {
  articleCode: string | null
  open: boolean
  onClose: () => void
  /// Open on the edit form rather than the overview: the card's Edit button.
  edit?: boolean
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
        badge={
          article !== undefined && !article.active ? (
            <Pill tone="neutral">Non-active</Pill>
          ) : undefined
        }
        footer={
          article === undefined ? undefined : editing ? (
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
            <SheetFooter
              primary={{ label: "Edit", onClick: () => setEditing(true) }}
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
              />
            ),
        })}
      </Sheet>
      {guard.dialog}
    </>
  )
}
