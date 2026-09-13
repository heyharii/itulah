import { useForm, useStore } from "@tanstack/react-form"
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input, Select } from "@/components/ui/field"
import { Segmented } from "@/components/ui/segmented"
import { Banner } from "@/components/ui/states"
import { Tag } from "@/components/ui/tag"
import { day } from "@/lib/format"
import {
  articleConsequences,
  articleKeys,
  updateArticle,
  type ArticleColourwayInput,
  type ArticleDetail,
} from "@/lib/queries/articles"
import { listTerms, vocabularyKeys } from "@/lib/queries/vocabulary"
import { ColourPicker } from "@/screens/master/colour-picker"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import { ApiError } from "@itulah/contract/client"
import type { ArticleConsequence, CatalogueVocabulary } from "@itulah/contract"

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

  /// The words this article already holds that the pickers no longer offer.
  ///
  /// `/catalogue/vocabulary` returns only active terms, which is right for
  /// choosing and wrong for showing: an article filed under a division that
  /// has since been retired opened with the Division box BLANK — the value was
  /// there, the option was not — and its retired tags were simply absent from
  /// the chips, held in the draft and invisible. Both are the same failure of
  /// the rule the master screens enforce: visible historically, unavailable
  /// prospectively.
  ///
  /// The master lists carry retired terms, so they are read — and only when
  /// this article actually needs them, which is almost never. `useQueries`
  /// rather than two `useQuery` calls so the pair is one hook whatever the
  /// answer is.
  const offered = useMemo(
    () => ({
      divisions: new Set((vocabulary?.divisions ?? []).map((one) => one.code)),
      tags: new Set((vocabulary?.tags ?? []).map((one) => one.code)),
    }),
    [vocabulary]
  )
  const needsDivisions =
    article.division_code !== null &&
    !offered.divisions.has(article.division_code)
  const needsTags = article.tags.some((code) => !offered.tags.has(code))
  const [retiredDivisions, retiredTags] = useQueries({
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

  /// One code's word, for a term the picker has stopped offering. The code
  /// itself while the list is still loading, and forever if it never does: a
  /// box reading `DIVIDED` is worse than one reading "Divided" and far better
  /// than one reading nothing at all.
  const retiredLabel = (
    list: { terms: readonly { code: string; label: string }[] } | undefined,
    code: string
  ) => list?.terms.find((one) => one.code === code)?.label ?? code

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

  /// Whether the consequences below have been read and pressed past. Cleared
  /// by every further edit — what was accepted was a specific consequence, not
  /// a mood. Set by the Save button's first press; see there.
  const [accepted, setAccepted] = useState(false)

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

  /// What the form is proposing, read from the form itself.
  ///
  /// Derived rather than kept beside it: a second copy of the draft is a
  /// second thing to keep in step, and the copy is the one that goes stale —
  /// the question asked would then be about an article nobody is editing.
  ///
  /// The tags are sorted so that ticking A then B asks the same question as
  /// ticking B then A. It IS the same question, and a query key that says
  /// otherwise pays for the answer twice.
  const draft = useStore(form.store, (state) => state.values)
  const proposed = useMemo(
    () => ({
      division_code: draft.division === "" ? null : draft.division,
      tags: [...draft.tags].sort(),
    }),
    [draft.division, draft.tags]
  )
  const settled = useMemo(
    () => ({
      division_code: article.division_code,
      tags: [...article.tags].sort(),
    }),
    [article.division_code, article.tags]
  )
  const changed =
    proposed.division_code !== settled.division_code ||
    proposed.tags.join("\u0000") !== settled.tags.join("\u0000")

  /// Only asked once the edit differs from what is on record. An article
  /// opened and read asks nothing, which is most of what happens in this
  /// sheet.
  const consequences = useQuery({
    queryKey: articleKeys.consequences(article.article_code, proposed),
    queryFn: ({ signal }) =>
      articleConsequences(article.article_code, proposed, signal),
    enabled: changed,
    staleTime: 30 * 1000,
  })
  const scheduled = changed ? (consequences.data?.scheduled ?? []) : []
  const started = changed ? (consequences.data?.started ?? []) : []

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
              onChange={(next) => {
                field.handleChange(next)
                setAccepted(false)
              }}
            >
              <option value="">Unclassified</option>
              {(vocabulary?.divisions ?? []).map((term) => (
                <option key={term.code} value={term.code}>
                  {term.label}
                </option>
              ))}
              {/* The one this article is already filed under, when it has
                  been retired since. Selectable only because it is already
                  selected: picking another is a one-way door, which is what
                  retiring a division means. */}
              {needsDivisions && article.division_code !== null && (
                <option value={article.division_code}>
                  {retiredLabel(retiredDivisions.data, article.division_code)} ·
                  Retired
                </option>
              )}
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
            {(vocabulary?.tags ?? []).length === 0 && !needsTags ? (
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
                      onClick={() => {
                        field.handleChange(
                          on
                            ? field.state.value.filter(
                                (each) => each !== term.code
                              )
                            : [...field.state.value, term.code]
                        )
                        setAccepted(false)
                      }}
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
                {/* Tags this article carries that are no longer offered. On
                    the chips rather than hidden in the draft: they were being
                    submitted unseen, so nobody could tell that an article was
                    tagged with a word the company had stopped using — or take
                    it off. Removable, never re-addable: clicking one drops it,
                    and it does not come back. */}
                {field.state.value
                  .filter((code) => !offered.tags.has(code))
                  .map((code) => (
                    <button
                      key={code}
                      type="button"
                      aria-pressed
                      title="Retired. It can be taken off, not put back."
                      onClick={() => {
                        field.handleChange(
                          field.state.value.filter((each) => each !== code)
                        )
                        setAccepted(false)
                      }}
                      className="inline-flex h-[1.625rem] items-center gap-1.5 rounded-full border border-dashed border-hairline-2 px-2.5 text-[0.71875rem] font-medium text-body"
                    >
                      {retiredLabel(retiredTags.data, code)}
                      <span className="text-mute">Retired</span>
                    </button>
                  ))}
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

      {/* What this edit would do to the offers around it.
      
          Above the button rather than behind it, and shown while somebody is
          still editing rather than only when they press Save: the useful
          moment is the one where the tag is still in their hand. */}
      {(scheduled.length > 0 || started.length > 0) && (
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
              <p className="mt-1.5 text-[0.71875rem] text-warn-fg">
                Their products are worked out when they start, so they will be
                worked out against this article as it is then.
              </p>
            </div>
          )}

          {/* The quiet half. A promotion already running is not a reason to
              stop somebody editing an article, and saying so in the same voice
              as the half above is how a warning becomes wallpaper. */}
          {started.length > 0 && (
            <div
              className={
                scheduled.length > 0 ? "border-t border-hairline pt-2.5" : ""
              }
            >
              <p className="text-[0.71875rem] text-body">
                {consequences.data?.started_note}
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {started.map((one) => (
                  <ConsequenceLine key={one.rule_id} one={one} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-1 flex items-center gap-2">
        <form.Subscribe selector={(state) => state.values.name.trim() !== ""}>
          {(ready) => {
            // Two presses when something moves, one when nothing does. The
            // first press is not a save — it is the moment the list above
            // stops being scenery and becomes the thing being agreed to. The
            // word changes on the second press rather than the first, which is
            // the same shape the delete on a master value uses.
            const guarded = scheduled.length > 0 && !accepted
            return (
              <Button
                type={guarded ? "button" : "submit"}
                variant="primary"
                className="flex-1"
                disabled={save.isPending || stale || !ready}
                onClick={guarded ? () => setAccepted(true) : undefined}
              >
                {save.isPending
                  ? "Saving…"
                  : accepted && scheduled.length > 0
                    ? "Save anyway"
                    : "Save"}
              </Button>
            )
          }}
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

/// One promotion an edit moves this article into or out of.
///
/// The name, which way it moves, and when it starts — the three things that
/// make the line worth reading. "Used by a promotion" is not one of them: that
/// is true of the tag and says nothing about this article.
function ConsequenceLine({ one }: { one: ArticleConsequence }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-meta">
      <span className="min-w-0 truncate text-ink">{one.name}</span>
      <span className="shrink-0 text-body">
        {/* Two different sentences, because two different things are true.
        
            A promotion that has not started will be worked out against the
            article as it is then, so the edit moves it: "would leave", and the
            date somebody is deciding against.
        
            One that has started was worked out when it began and a shop prices
            against that answer, so the edit moves nothing. Saying "would
            leave" of it would be a lie in the one place somebody is looking
            for permission to make a change. */}
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
