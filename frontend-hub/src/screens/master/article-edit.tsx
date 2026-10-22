import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { ImagePlus } from "lucide-react"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Switch } from "@/components/ui/form"
import { type Choice, PickMany } from "@/components/ui/pick"
import { SubHead } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import { day, count, money, sku as skuNumber } from "@/lib/format"
import { asJpeg, PICTURE_TYPES } from "@/lib/image"
import { useLayout } from "@/lib/layout"
import {
  articleConsequences,
  articleKeys,
  updateArticle,
  type ArticleDetail,
  type UpdateArticleRequest,
} from "@/lib/queries/articles"
import {
  articleMainImage,
  removeArticleImage,
  uploadArticleImage,
  uploadArticleMainImage,
} from "@/lib/queries/procurement"
import { listTerms, vocabularyKeys } from "@/lib/queries/vocabulary"
import { cn } from "@/lib/utils"
import { gridOf, type Grid, type GridColour } from "@/screens/master/article-grid"
import {
  useObjectUrl,
  type ArticlePictures,
} from "@/screens/master/article-pictures"
import { ColourThumb } from "@/screens/master/article-view"
import { Matrix } from "@/screens/procurement/setups"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import { ApiError } from "@itulah/contract/client"
import type { ArticleConsequence, CatalogueVocabulary } from "@itulah/contract"

/// Correcting an article — its attributes, never its identity.
///
/// What may change is what the backend lets a PATCH carry: the name, the
/// pictures, the division, the tags and whether it is active. Never the code,
/// the sizes, a price or a quantity — an article code and its SKU codes are
/// minted at the centre and already encoded into the tags on the goods, and a
/// price or a quantity is changed by what is done with the goods, not by
/// typing over it. The grid below the form shows them so the pictures can be
/// chosen colour by colour, and says nothing it cannot back.
///
/// The patch distinguishes three things a field can say — absent leaves it
/// alone, `null` clears it, a value sets it. The form sends the four fields it
/// edits and the picture link only when the main picture moved.

/// A picture the person has chosen but not saved: a new file, or a removal.
/// Nothing is uploaded or deleted until Save.
export type Staged =
  | { readonly kind: "new"; readonly file: File }
  | { readonly kind: "remove" }

export interface Draft {
  readonly name: string
  /// A division code, or "" for unclassified.
  readonly division: string
  readonly tags: readonly string[]
  readonly active: boolean
  /// The article's main picture, when it has been changed.
  readonly main: Staged | null
  /// A colour's own picture by digit, for the colours that have been changed.
  readonly pics: Readonly<Record<string, Staged>>
}

const draftOf = (article: ArticleDetail): Draft => ({
  name: article.name,
  division: article.division_code ?? "",
  tags: [...article.tags],
  active: article.active,
  main: null,
  pics: {},
})

const sameTags = (a: readonly string[], b: readonly string[]) =>
  [...a].sort().join("\u0000") === [...b].sort().join("\u0000")

const dirtyOf = (article: ArticleDetail, draft: Draft) =>
  draft.name.trim() !== article.name ||
  (draft.division === "" ? null : draft.division) !== article.division_code ||
  !sameTags(draft.tags, article.tags) ||
  draft.active !== article.active ||
  draft.main !== null ||
  Object.keys(draft.pics).length > 0

/// The editor's state, held by the sheet so its foot can save what its body
/// edits. Safe to call before the article has arrived: it draws nothing and
/// holds nothing until `editing` and the article are both there.
export function useArticleEditor({
  article,
  vocabulary,
  editing,
  onSaved,
  onLeave,
}: {
  article: ArticleDetail | undefined
  vocabulary?: CatalogueVocabulary
  pictures: ArticlePictures
  editing: boolean
  onSaved: () => void
  /// Leave the form without saving: the way out of a refused save.
  onLeave: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [draft, setDraft] = useState<Draft | null>(null)
  /// Whether the consequences below have been read and pressed past. Cleared by
  /// every further edit — what was accepted was a specific consequence.
  const [accepted, setAccepted] = useState(false)

  // Opened, or closed, by adjusting state during render: an effect would let
  // one frame of the form draw before the draft exists, or after it should be
  // gone.
  const live = editing && article !== undefined
  if (live && draft === null) setDraft(draftOf(article))
  if (!live && draft !== null) {
    setDraft(null)
    setAccepted(false)
  }

  const change = (patch: Partial<Draft>) => {
    setDraft((was) => (was === null ? was : { ...was, ...patch }))
    setAccepted(false)
  }

  const save = useMutation({
    mutationFn: async (input: { article: ArticleDetail; draft: Draft }) => {
      const { article: was, draft: next } = input
      const code = was.article_code
      // The main picture: the bytes, then the link the lists read it by. The
      // server's permanent link already says which picture it is (the stored
      // object's tag), so a replaced picture is fetched and not the old one
      // kept. A bucket that hands out expiring links cannot have one stored
      // against the article, so then the sheet reads the picture by its key
      // and the link is left as it is.
      let image: string | null | undefined
      if (next.main?.kind === "new") {
        await uploadArticleMainImage(code, await asJpeg(next.main.file))
        const stored = await articleMainImage(code)
        if (stored !== null && stored.expires_in_seconds === null)
          image = stored.url
      } else if (next.main?.kind === "remove") {
        await removeArticleImage(code, null)
        image = null
      }
      for (const [digit, one] of Object.entries(next.pics)) {
        if (one.kind === "new")
          await uploadArticleImage(code, digit, await asJpeg(one.file))
        else await removeArticleImage(code, digit)
      }

      const fieldsMoved =
        next.name.trim() !== was.name ||
        (next.division === "" ? null : next.division) !== was.division_code ||
        !sameTags(next.tags, was.tags) ||
        next.active !== was.active
      if (!fieldsMoved && image === undefined) return null

      const request: UpdateArticleRequest = {
        name: next.name.trim(),
        division_code: next.division === "" ? null : next.division,
        // Present replaces, so an empty list means "remove every tag" — a
        // thing somebody may legitimately say about an article.
        tags: next.tags,
        active: next.active,
        ...(image === undefined ? {} : { image_url: image }),
      }
      return updateArticle(code, request, was.version, idempotency.key)
    },
    onSuccess: () => {
      // `all` is a prefix of both the record's key and every list key, so one
      // invalidation reaches the sheet and the catalogue behind it. The
      // pictures are keyed apart.
      void client.invalidateQueries({ queryKey: articleKeys.all })
      void client.invalidateQueries({
        queryKey: ["procurement", "catalogue", "article-image"],
      })
      idempotency.rotate()
      onSaved()
    },
  })

  /// The version guard fired: somebody else saved between this sheet opening
  /// and this button being pressed. 412 is what `If-Match` returns; 409 is what
  /// a handler returns when it phrases the same collision as a conflict.
  const stale =
    save.error instanceof ApiError &&
    (save.error.status === 409 || save.error.status === 412)

  /// What the edit would do to the promotions around it — only asked once the
  /// division or the tags differ from what is on record. The tags are sorted so
  /// that ticking A then B asks the same question as ticking B then A.
  const proposed = useMemo(
    () => ({
      division_code: draft === null || draft.division === "" ? null : draft.division,
      tags: draft === null ? [] : [...draft.tags].sort(),
    }),
    [draft]
  )
  const changed =
    article !== undefined &&
    draft !== null &&
    (proposed.division_code !== article.division_code ||
      !sameTags(proposed.tags, article.tags))
  const consequences = useQuery({
    queryKey: articleKeys.consequences(article?.article_code ?? "", proposed),
    queryFn: ({ signal }) =>
      articleConsequences(article!.article_code, proposed, signal),
    enabled: changed,
    staleTime: 30 * 1000,
  })
  const scheduled = changed ? (consequences.data?.scheduled ?? []) : []
  const started = changed ? (consequences.data?.started ?? []) : []

  const retired = useRetired(article, vocabulary)
  const dirty = article !== undefined && draft !== null && dirtyOf(article, draft)
  const valid = draft === null || draft.name.trim() !== ""
  const guarded = scheduled.length > 0 && !accepted

  return {
    draft,
    change,
    dirty,
    valid,
    stale,
    saving: save.isPending,
    error: stale ? null : save.error,
    reset: () => save.reset(),
    /// Somebody else saved first: drop what was typed and read their version.
    /// Pressing save again would only be refused again — the guard compares
    /// versions, not text.
    readTheirs: () => {
      if (article !== undefined)
        void client.invalidateQueries({
          queryKey: articleKeys.article(article.article_code),
        })
      save.reset()
      onLeave()
    },
    scheduled,
    started,
    startedNote: consequences.data?.started_note,
    /// The first press past a list of promotions is not a save — it is the
    /// moment the list stops being scenery and becomes what is agreed to.
    guarded,
    accepted,
    submit: () => {
      if (article === undefined || draft === null) return
      if (guarded) {
        setAccepted(true)
        return
      }
      save.mutate({ article, draft })
    },
    retired,
  }
}

export type ArticleEditor = ReturnType<typeof useArticleEditor>

/// The words this article already holds that the pickers no longer offer.
///
/// `/catalogue/vocabulary` returns only active terms, which is right for
/// choosing and wrong for showing: an article filed under a division that has
/// since been retired would open with the Division box blank, and its retired
/// tags would be held in the draft and invisible. The master lists carry the
/// retired terms, so they are read — and only when this article needs them,
/// which is almost never.
function useRetired(
  article: ArticleDetail | undefined,
  vocabulary?: CatalogueVocabulary
) {
  const offered = useMemo(
    () => ({
      divisions: new Set((vocabulary?.divisions ?? []).map((one) => one.code)),
      tags: new Set((vocabulary?.tags ?? []).map((one) => one.code)),
    }),
    [vocabulary]
  )
  const needsDivisions =
    article !== undefined &&
    article.division_code !== null &&
    !offered.divisions.has(article.division_code)
  const needsTags =
    article !== undefined &&
    vocabulary !== undefined &&
    article.tags.some((code) => !offered.tags.has(code))
  const [divisions, tags] = useQueries({
    queries: [
      {
        queryKey: vocabularyKeys.list("divisions"),
        queryFn: ({ signal }: { signal?: AbortSignal }) =>
          listTerms("divisions", signal),
        enabled: needsDivisions,
      },
      {
        queryKey: vocabularyKeys.list("tags"),
        queryFn: ({ signal }: { signal?: AbortSignal }) =>
          listTerms("tags", signal),
        enabled: needsTags,
      },
    ],
  })
  /// One code's word, for a term the picker has stopped offering: the code
  /// itself while the list loads, and forever if it never does.
  const label = (
    list: { terms: readonly { code: string; label: string }[] } | undefined,
    code: string
  ) => list?.terms.find((one) => one.code === code)?.label ?? code
  return {
    offeredTags: offered.tags,
    division: needsDivisions ? (article?.division_code ?? null) : null,
    divisionLabel: (code: string) => label(divisions.data, code),
    tagLabel: (code: string) => label(tags.data, code),
  }
}

// ---------------------------------------------------------------------------

/// A file picker that looks like a quiet text button. The input is the real
/// control, hidden from sight and not from the keyboard: a label around it
/// hands the press over.
function PicturePicker({
  children,
  onPick,
  disabled,
}: {
  children: React.ReactNode
  onPick: (file: File) => void
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        "relative inline-flex h-7 cursor-pointer items-center gap-1 rounded-inner text-[0.9375rem] font-medium whitespace-nowrap text-accent transition-[opacity,transform] duration-150 ease-out active:scale-[0.97] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent hover:opacity-75 pointer-coarse:h-11 [&_svg]:size-4",
        disabled && "pointer-events-none opacity-50"
      )}
    >
      <input
        type="file"
        accept={PICTURE_TYPES}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onPick(file)
          // The same file picked twice in a row is still a pick.
          event.target.value = ""
        }}
      />
      <ImagePlus aria-hidden />
      {children}
    </label>
  )
}

const TEXT_BUTTON =
  "inline-flex h-7 items-center rounded-inner text-[0.9375rem] font-medium whitespace-nowrap text-mute transition-[opacity,transform,color] duration-150 ease-out hover:text-ink active:scale-[0.97] pointer-coarse:h-11"

const NEW_BADGE = (
  <span className="inline-flex h-5 items-center rounded-full bg-ok-bg px-2 text-[0.9375rem] font-medium text-ok-fg">
    New
  </span>
)

export function ArticleEditForm({
  article,
  vocabulary,
  pictures,
  editor,
}: {
  article: ArticleDetail
  vocabulary?: CatalogueVocabulary
  pictures: ArticlePictures
  editor: ArticleEditor
}) {
  const { draft, change, retired } = editor
  const grid = useMemo(() => gridOf(article), [article])
  const phone = useLayout() === "phone"

  // Hooks first: a draft only exists once the sheet is editing.
  const mainFile = draft?.main?.kind === "new" ? draft.main.file : null
  const mainPreview = useObjectUrl(mainFile)
  if (draft === null) return null

  /// The picture a colour without its own shows, as the draft has it.
  const mainNow =
    draft.main?.kind === "new"
      ? mainPreview
      : draft.main?.kind === "remove"
        ? null
        : pictures.main
  const hasMain = draft.main?.kind === "new" || (draft.main === null && pictures.main !== null)

  const pickMain = (file: File) => change({ main: { kind: "new", file } })
  const removeMain = () =>
    change({ main: pictures.main !== null ? { kind: "remove" } : null })

  const pickColour = (digit: string, file: File) =>
    change({ pics: { ...draft.pics, [digit]: { kind: "new", file } } })
  const useMain = (digit: string) => {
    const next = { ...draft.pics }
    if (pictures.own.get(digit)) next[digit] = { kind: "remove" }
    else delete next[digit]
    change({ pics: next })
  }

  const divisions = [
    ...(vocabulary?.divisions ?? []).map((term) => ({
      code: term.code,
      label: term.label,
    })),
  ]

  const tagChoices: Choice[] = [
    ...(vocabulary?.tags ?? []).map((term) => ({
      value: term.code,
      label: term.label,
    })),
    // Carried by the draft, no longer offered: shown so it can be taken off,
    // and gone from the list once it has been — never put back.
    ...draft.tags
      .filter((code) => !retired.offeredTags.has(code))
      .map((code) => ({
        value: code,
        label: `${retired.tagLabel(code)} · Cancelled`,
      })),
  ]

  return (
    <div className="flex flex-col gap-5">
      {editor.stale && (
        <Banner tone="warn">
          Somebody else changed this article after you opened it, so nothing was
          saved — your edits are still here, and theirs are still on the server.
          Pressing save again would only be refused again: the guard compares
          versions, not text. Read their version first, then make your change on
          top of it.
        </Banner>
      )}
      {editor.stale && (
        <Button variant="ghost" onClick={editor.readTheirs}>
          Discard my changes and read theirs
        </Button>
      )}

      <div className="flex flex-col gap-1.5">
        <span id="main-picture-label" className="text-[0.9375rem] font-medium text-text">
          Main picture
        </span>
        <div className="flex items-center gap-3">
          <ColourThumb
            url={mainNow}
            article={article}
            vocabulary={vocabulary}
            colour={
              grid.colours[0] ?? { key: "", digit: null, label: "", hex: null }
            }
            className={cn(
              "size-[4.5rem]",
              draft.main?.kind === "new" && "ring-1 ring-ok-fg/40"
            )}
          />
          <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5">
            <PicturePicker onPick={pickMain}>
              {hasMain ? "Change picture" : "Add picture"}
            </PicturePicker>
            {hasMain && (
              <button type="button" className={TEXT_BUTTON} onClick={removeMain}>
                Remove
              </button>
            )}
            {draft.main?.kind === "new" && NEW_BADGE}
          </span>
        </div>
      </div>

      <Field
        label="Name"
        required
        aside={<span className="font-mono text-id">{article.article_code}</span>}
        problem={draft.name.trim() === "" ? "Name is required" : undefined}
      >
        <Input
          value={draft.name}
          onChange={(event) => change({ name: event.target.value })}
        />
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field label="Division">
          <Select
            value={draft.division}
            onChange={(next) => change({ division: next })}
          >
            <option value="">Unclassified</option>
            {divisions.map((term) => (
              <option key={term.code} value={term.code}>
                {term.label}
              </option>
            ))}
            {/* The one this article is already filed under, when it has been
                cancelled since. Selectable only because it is already
                selected: picking another is a one-way door, which is what
                retiring a division means. */}
            {retired.division !== null && (
              <option value={retired.division}>
                {retired.divisionLabel(retired.division)} · Cancelled
              </option>
            )}
          </Select>
        </Field>

        {/* Not a `<Field>`: that wraps its children in a `<label>`, and a
            label around chips with their own buttons hands every click to the
            first of them. */}
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-[0.9375rem] font-medium text-text">Tags</span>
            <span className="text-[0.9375rem] text-mute tabular-nums">
              {count(draft.tags.length)} selected
            </span>
          </div>
          {/* The vocabulary is hundreds of words, so the ones this article
              carries are the chips and the rest are searched, never spread
              out. */}
          <PickMany
            label="Tags"
            choices={tagChoices}
            values={draft.tags}
            onChange={(next) => change({ tags: next })}
          />
        </div>
      </div>

      {/* The whole box answers a press, not only the switch: it is the one row
          on this form with nothing else to aim at. */}
      <div
        onClick={() => change({ active: !draft.active })}
        className="flex cursor-pointer items-center justify-between gap-4 rounded-inner border border-hairline-2 px-3.5 py-3"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[0.9375rem] font-medium text-ink">
            {draft.active ? "Active" : "Non-active"}
          </span>
          <span className="text-[0.9375rem] text-body">
            {draft.active ? "Shown in the catalogue." : "Hidden from the catalogue."}
          </span>
        </span>
        <Switch
          on={draft.active}
          label="Active"
          onToggle={() => change({ active: !draft.active })}
        />
      </div>

      {(editor.scheduled.length > 0 || editor.started.length > 0) && (
        <Consequences editor={editor} />
      )}

      <section>
        <SubHead aside={`${count(grid.total)} pcs`}>Variants</SubHead>
        <EditGrid
          article={article}
          vocabulary={vocabulary}
          pictures={pictures}
          grid={grid}
          draft={draft}
          mainNow={mainNow}
          phone={phone}
          onPick={pickColour}
          onUseMain={useMain}
        />
      </section>
    </div>
  )
}

/// The variants again, with each colour's picture editable. Quantities and
/// prices stay read-only: they are changed by what is done with the goods.
function EditGrid({
  article,
  vocabulary,
  pictures,
  grid,
  draft,
  mainNow,
  phone,
  onPick,
  onUseMain,
}: {
  article: ArticleDetail
  vocabulary?: CatalogueVocabulary
  pictures: ArticlePictures
  grid: Grid
  draft: Draft
  mainNow: string | null
  phone: boolean
  onPick: (digit: string, file: File) => void
  onUseMain: (digit: string) => void
}) {
  const rowOf = (one: GridColour) => (
    <ColourPictureRow
      colour={one}
      article={article}
      vocabulary={vocabulary}
      staged={one.digit ? draft.pics[one.digit] : undefined}
      loaded={one.digit ? (pictures.own.get(one.digit) ?? null) : null}
      mainNow={mainNow}
      onPick={onPick}
      onUseMain={onUseMain}
    />
  )

  if (phone)
    return (
      <div className="flex flex-col gap-3">
        {grid.colours.map((one) => (
          <div
            key={one.key}
            className="overflow-hidden rounded-inner border border-hairline"
          >
            <div className="bg-soft px-3 py-2">{rowOf(one)}</div>
            {grid.sizes.map((each) => {
              const here = grid.sku(one.key, each.code)
              return (
                <div
                  key={each.code}
                  className="flex items-baseline gap-3 border-t border-hairline px-3 py-2 text-[0.9375rem]"
                >
                  <span className="w-9 shrink-0 font-medium text-ink">
                    {each.label}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[0.9375rem] text-mute">
                    {skuNumber(here?.sku_code)}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {here === undefined
                      ? "—"
                      : `${count(here.stock_qty)} · ${money(here.base_price_minor)}`}
                  </span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    )

  return (
    <Matrix
      colours={grid.colours}
      sizes={grid.sizes}
      columnClass="w-[6.5rem]"
      rowHeadClass="w-[15rem]"
      rowHead={(row) => rowOf(grid.colours.find((each) => each.key === row.key)!)}
      rowTotal={(row) => count(grid.rowTotal(row.key))}
      columnTotal={(col) => count(grid.columnTotal(col.code))}
      total={count(grid.total)}
      cell={(row, col) => {
        const here = grid.sku(row.key, col.code)
        if (here === undefined) return <span className="text-faint">—</span>
        return (
          <span className="flex flex-col items-end py-1 leading-5">
            <span className="text-[0.9375rem] font-medium text-ink">
              {count(here.stock_qty)}
            </span>
            <span className="text-[0.9375rem] text-mute">
              {money(here.base_price_minor)}
            </span>
          </span>
        )
      }}
    />
  )
}

/// One colour's picture, with what can be done to it: a colour on the main
/// picture can be given its own; one with its own can change it or go back to
/// the main one.
function ColourPictureRow({
  colour,
  article,
  vocabulary,
  staged,
  loaded,
  mainNow,
  onPick,
  onUseMain,
}: {
  colour: GridColour
  article: ArticleDetail
  vocabulary?: CatalogueVocabulary
  staged: Staged | undefined
  loaded: string | null
  mainNow: string | null
  onPick: (digit: string, file: File) => void
  onUseMain: (digit: string) => void
}) {
  const preview = useObjectUrl(staged?.kind === "new" ? staged.file : null)
  const own =
    staged?.kind === "new" ? preview : staged?.kind === "remove" ? null : loaded
  const hasOwn = staged?.kind === "new" || (staged?.kind !== "remove" && loaded !== null)
  const digit = colour.digit

  return (
    <span className="flex items-center gap-3">
      <ColourThumb
        url={own ?? mainNow}
        article={article}
        vocabulary={vocabulary}
        colour={colour}
        // Dashed while it is only the main picture showing.
        className={cn("size-12", !hasOwn && "border-dashed")}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-[0.9375rem] font-medium text-ink">
          {colour.label}
        </span>
        {!hasOwn && (
          <span className="text-[0.9375rem] text-mute">
            {mainNow ? "Main picture" : "No picture"}
          </span>
        )}
        {digit !== null && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0">
            <PicturePicker onPick={(file) => onPick(digit, file)}>
              {hasOwn ? "Change picture" : "Add own picture"}
            </PicturePicker>
            {hasOwn && (
              <button
                type="button"
                className={TEXT_BUTTON}
                onClick={() => onUseMain(digit)}
              >
                Use main picture
              </button>
            )}
            {staged?.kind === "new" && NEW_BADGE}
          </span>
        )}
      </span>
    </span>
  )
}

/// What this edit would do to the offers around it.
///
/// Above the foot and shown while somebody is still editing rather than only
/// when they press Save: the useful moment is the one where the tag is still
/// in their hand.
function Consequences({ editor }: { editor: ArticleEditor }) {
  const { scheduled, started } = editor
  return (
    <div className="flex flex-col gap-2.5 rounded-inner border border-warn-fg/30 bg-warn-bg px-3.5 py-3">
      {scheduled.length > 0 && (
        <div>
          <p className="text-meta font-medium text-ink">
            This change affects{" "}
            {scheduled.length === 1
              ? "a promotion that has not started"
              : `${scheduled.length} promotions that have not started`}
            .
          </p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {scheduled.map((one) => (
              <ConsequenceLine key={one.rule_id} one={one} />
            ))}
          </ul>
          <p className="mt-1.5 text-[0.9375rem] text-warn-fg">
            Their articles are worked out when they start, so they will be
            worked out against this article as it is then.
          </p>
        </div>
      )}

      {/* The quiet half. A promotion already running is not a reason to stop
          somebody editing an article, and saying so in the same voice as the
          half above is how a warning becomes wallpaper. */}
      {started.length > 0 && (
        <div
          className={
            scheduled.length > 0 ? "border-t border-hairline pt-2.5" : ""
          }
        >
          <p className="text-[0.9375rem] text-body">{editor.startedNote}</p>
          <ul className="mt-1.5 flex flex-col gap-1">
            {started.map((one) => (
              <ConsequenceLine key={one.rule_id} one={one} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/// One promotion an edit moves this article into or out of: the name, which
/// way it moves, and when it starts — the three things that make the line
/// worth reading.
function ConsequenceLine({ one }: { one: ArticleConsequence }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-meta">
      <span className="min-w-0 truncate text-ink">{one.name}</span>
      <span className="shrink-0 text-body">
        {/* Two different sentences, because two different things are true. A
            promotion that has not started will be worked out against the
            article as it is then, so the edit moves it. One that has started
            was worked out when it began and a shop prices against that
            answer, so the edit moves nothing. */}
        {one.phase === "SCHEDULED"
          ? `${one.gains ? "would join" : "would leave"}${
              one.starts_at !== null ? ` · starts ${day(one.starts_at)}` : ""
            }`
          : `${one.in_frozen_set ? "stays included" : "stays out"}${
              one.resolved_at !== null
                ? ` · resolved ${day(one.resolved_at)}`
                : ""
            }`}
      </span>
    </li>
  )
}
