import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import {
  articleKeys,
  updateArticle,
  type ArticleColourwayInput,
  type ArticleDetail,
} from "@/lib/queries/articles"
import { ColourPicker } from "@/screens/master/colour-picker"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import { ApiError } from "@itulah/contract/client"
import type { CatalogueVocabulary } from "@itulah/contract"

/// Correcting an article — its attributes, never its identity.
///
/// There is no field here for `article_code` and none for any `sku_code`, and
/// their absence is the design. Identity is minted once, by the centre, through
/// an article setup session; a code that can be edited afterwards is a
/// different product wearing an old one's history, and every EPC already
/// encoding it becomes a lie the moment somebody saves. What a merchandiser
/// legitimately corrects is what the thing is *called* and how it is filed.
///
/// The patch shape distinguishes three things a field can say — absent leaves
/// it alone, `null` clears it, a value sets it. Everything on this form is
/// sent, so emptying a box genuinely clears the field.

interface ArticleDraft {
  name: string
  division: string
  image: string
  active: boolean
  tags: string[]
  colours: ArticleColourwayInput[]
}

export function ArticleForm({
  article,
  vocabulary,
  onSaved,
  onCancel,
}: {
  article: ArticleDetail
  /// The closed sets an article is described with. Handed in rather than
  /// fetched here: the sheet around this form already reads them to render the
  /// same words, and a second request to learn what "KAUS_KAKI" says is a
  /// request for nothing.
  vocabulary?: CatalogueVocabulary
  onSaved: () => void
  onCancel: () => void
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()

  /// Which digits are settled, counted off the article's own SKUs.
  ///
  /// A digit with SKUs against it cannot be repointed at another colour: those
  /// SKUs are printed on labels and tagged onto goods already sitting in a
  /// shop, and moving the colour would rename them where they stand. The
  /// server refuses it; this is so nobody gets far enough to be refused.
  const minted = useMemo(() => {
    const perDigit = new Map<string, number>()
    for (const sku of article.skus) {
      if (sku.colour_digit === null) continue
      perDigit.set(sku.colour_digit, (perDigit.get(sku.colour_digit) ?? 0) + 1)
    }
    return perDigit
  }, [article.skus])

  const save = useMutation({
    // Wrapped rather than passed by reference: v5 hands a mutation context as
    // the second argument, which is not the `AbortSignal` the fetcher expects.
    mutationFn: (draft: ArticleDraft) =>
      updateArticle(
        article.article_code,
        {
          name: draft.name.trim(),
          division_code: draft.division === "" ? null : draft.division,
          image_url: draft.image.trim() === "" ? null : draft.image.trim(),
          // Present replaces, so an empty list means "remove every tag" — a
          // thing somebody may legitimately say about an article.
          tags: draft.tags,
          active: draft.active,
          colours: draft.colours,
        },
        article.version,
        idempotency.key
      ),
    onSuccess: () => {
      // `all` is a prefix of both the record's key and every list key, so one
      // invalidation reaches the sheet and the catalogue behind it. A renamed
      // article that stays renamed only in the sheet is the bug this avoids.
      void client.invalidateQueries({ queryKey: articleKeys.all })
      idempotency.rotate()
      onSaved()
    },
  })

  /// The version guard fired: somebody else saved between this sheet opening
  /// and this button being pressed.
  ///
  /// 412 is what `If-Match` returns; 409 is what a handler returns when it
  /// phrases the same collision as a conflict. Either way nothing was written.
  const stale =
    save.error instanceof ApiError &&
    (save.error.status === 409 || save.error.status === 412)

  const form = useForm({
    defaultValues: {
      name: article.name,
      division: article.division_code ?? "",
      image: article.image_url ?? "",
      active: article.active,
      tags: [...article.tags],
      colours: article.colours.map((way) => ({
        colour_digit: way.colour_digit,
        colour_code: way.colour_code,
      })),
    } as ArticleDraft,
    onSubmit: ({ value }) => save.mutate(value),
  })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        form.handleSubmit()
      }}
      className="flex flex-col gap-3.5"
    >
      {stale ? (
        <Banner tone="warn">
          Somebody else changed this article after you opened it, so nothing was
          saved — your edits are still here, and theirs are still on the server.
          Pressing save again would only be refused again: the guard compares
          versions, not text. Read their version first, then make your change on
          top of it.
        </Banner>
      ) : (
        save.isError && (
          <Banner tone="bad">{(save.error as Error).message}</Banner>
        )
      )}

      {stale && (
        <Button
          variant="ghost"
          onClick={() => {
            void client.invalidateQueries({
              queryKey: articleKeys.article(article.article_code),
            })
            onCancel()
          }}
        >
          Discard my changes and read theirs
        </Button>
      )}

      {/* Shown, never offered. The code is the one thing on this record that
          cannot be corrected, and a form that simply omitted it would leave
          somebody hunting for the field rather than knowing there isn't one. */}
      <div className="rounded-inner bg-soft px-3 py-2.5">
        <span className="font-mono text-id text-body">
          {article.article_code}
        </span>
        <p className="mt-1 text-[0.71875rem] text-mute">
          Minted by a setup session and fixed. So are the SKU codes below it —
          every one is already encoded into the EPCs tagged onto goods.
        </p>
      </div>

      <form.Field name="name">
        {(field) => (
          <Field label="Name">
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="division">
        {(field) => (
          <Field
            label="Division"
            hint="Our own vocabulary, so a supplier's shirt and our shirt are the same word."
          >
            <Select
              value={field.state.value}
              onChange={(next) => field.handleChange(next)}
            >
              <option value="">Unclassified</option>
              {(vocabulary?.divisions ?? []).map((term) => (
                <option key={term.code} value={term.code}>
                  {term.label}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form.Field>

      <form.Field name="image">
        {(field) => (
          <Field
            label="Picture"
            hint="The article's own image. The per-colourway photographs are filed against the setup session, not here."
          >
            <Input
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              placeholder="https://…"
            />
          </Field>
        )}
      </form.Field>

      <form.Field name="tags">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.78125rem] font-medium text-text">
              Tags
            </span>
            {(vocabulary?.tags ?? []).length === 0 ? (
              <span className="text-[0.71875rem] text-mute">
                The vocabulary has no tags in it yet.
              </span>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {(vocabulary?.tags ?? []).map((term) => {
                  const on = field.state.value.includes(term.code)
                  return (
                    <button
                      key={term.code}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        field.handleChange(
                          on
                            ? field.state.value.filter(
                                (each) => each !== term.code
                              )
                            : [...field.state.value, term.code]
                        )
                      }
                      className={
                        on
                          ? "inline-flex h-[1.625rem] items-center rounded-full bg-accent-bg px-2.5 text-[0.71875rem] font-medium text-info-fg"
                          : "inline-flex h-[1.625rem] items-center rounded-full bg-soft-2 px-2.5 text-[0.71875rem] font-medium text-body transition-colors hover:bg-hairline hover:text-ink"
                      }
                    >
                      {term.label}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </form.Field>

      <form.Field name="colours">
        {(field) => (
          <ColourPicker
            value={field.state.value}
            onChange={(next) => field.handleChange(next)}
            minted={minted}
            disabled={save.isPending}
          />
        )}
      </form.Field>

      {/* Not a `<Field>`: that wraps its children in a `<label>`, and a label
          around a two-button group hands every click to the first button. */}
      <form.Field name="active">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.78125rem] font-medium text-text">
              Sold
            </span>
            <Segmented
              options={[
                { value: "active", label: "Active" },
                { value: "retired", label: "Retired" },
              ]}
              value={field.state.value ? "active" : "retired"}
              onChange={(next) => field.handleChange(next === "active")}
            />
            <span className="text-[0.71875rem] text-mute">
              Retiring an article stops it being sold. It does not remove it:
              the SKUs, their EPCs and everything already sold under them stay
              exactly where they are.
            </span>
          </div>
        )}
      </form.Field>

      <div className="mt-1 flex items-center gap-2">
        <form.Subscribe selector={(state) => state.values.name.trim() !== ""}>
          {(ready) => (
            <Button
              type="submit"
              variant="dark"
              className="flex-1"
              disabled={save.isPending || stale || !ready}
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          )}
        </form.Subscribe>
        <Button variant="quiet" onClick={onCancel} disabled={save.isPending}>
          Cancel
        </Button>
      </div>

      <p className="text-[0.71875rem] text-mute">
        Saving is guarded on version <Tag>{article.version}</Tag> — if anybody
        else has saved since this sheet opened, the write is refused rather than
        quietly winning.
      </p>
    </form>
  )
}
