import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, X } from "lucide-react"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner } from "@/components/ui/states"
import { dayIndonesian } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  draftLetter,
  letterKeys,
  letterTemplates,
  saveLetter,
} from "@/lib/queries/letters"
import { cn } from "@/lib/utils"
import {
  LETTER_GROUPS,
  WRITTEN_FORMS,
  newItem,
  proseDocument,
  registerFacts,
  writtenFacts,
  writtenForm,
  type WrittenForm,
  type WrittenItem,
} from "@/screens/letters/forms"
import type { LetterPreset } from "@/screens/letters/preset"
import type { LetterTemplate } from "@itulah/contract"

/// New letter: a template, a few details, then the letter itself.
///
/// The gallery holds only the letters a person writes, grouped by what they
/// are about — Goods & documents, People, Notices & requests (owner,
/// 2026-10-17: the letters the system writes are not templates, they come out
/// of their own flows). A wording somebody kept sits in its own form's group,
/// with who kept it.
///
/// Picking one swaps the sheet's contents to the details: plain text boxes,
/// two to a row at most, and for goods a typed list of items. Write letter
/// drafts it and opens the paper — where everything else is written.
export function NewLetterSheet({
  open,
  onClose,
  onDrafted,
  preset = null,
}: {
  open: boolean
  onClose: () => void
  onDrafted: (id: string) => void
  /// A form to open on, with its details already filled in.
  preset?: LetterPreset | null
}) {
  const client = useQueryClient()
  const nameOf = useNameOfLogin()
  const [form, setForm] = useState<WrittenForm | null>(null)
  const [pattern, setPattern] = useState<LetterTemplate | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [items, setItems] = useState<WrittenItem[]>([])

  // Patterns are kept on the general kind; the ones from a written letter
  // carry its form, and an older blank pattern files as a blank letter.
  const patterns = useQuery({
    queryKey: letterKeys.templates("GENERAL"),
    queryFn: ({ signal }) => letterTemplates("GENERAL", signal),
    enabled: open,
  })

  const start = (next: WrittenForm, from: LetterTemplate | null) => {
    const kept = from === null ? {} : writtenFacts(from.facts)
    setForm(next)
    setPattern(from)
    setValues({ ...kept, letter_date: dayIndonesian(new Date()) })
    setItems(next.items ? [newItem()] : [])
  }

  // Asked for by another screen: open on that form with what it knows.
  useEffect(() => {
    if (!open || preset === null) return
    const asked = writtenForm(preset.form)
    if (asked === undefined) return
    setForm(asked)
    setPattern(null)
    setValues({ letter_date: dayIndonesian(new Date()), ...preset.values })
    setItems(asked.items ? [newItem()] : [])
  }, [open, preset])

  const back = () => {
    setForm(null)
    setPattern(null)
  }

  const close = () => {
    onClose()
    back()
  }

  const write = useMutation({
    mutationFn: async (chosen: WrittenForm) => {
      const draft = await draftLetter({
        kind: "GENERAL",
        subject_id: "",
        template_id: pattern?.template_id ?? null,
        form: chosen.key,
      })
      const typed = items.filter((item) => item.name.trim() !== "")
      const facts = { ...values }
      // The opening prose is written once, from the details; the kept wording
      // of a pattern stands in for it when one was picked.
      const body =
        pattern !== null && Object.keys(pattern.body).length > 0
          ? pattern.body
          : proseDocument(chosen.prose(facts, nameOf(draft.created_by)))
      await saveLetter(draft.letter_id, {
        body: body as Record<string, unknown>,
        facts: {
          ...facts,
          form: chosen.key,
          group: chosen.group,
          items: typed,
          ...registerFacts(chosen, facts, typed),
        },
      })
      return draft.letter_id
    },
    onSuccess: (id) => {
      void client.invalidateQueries({ queryKey: letterKeys.all })
      onDrafted(id)
      back()
    },
  })

  const noItems =
    form?.items === true && !items.some((item) => item.name.trim() !== "")

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && close()}
      size="wide"
      context={form === null ? "Letters" : false}
      title={form === null ? "New letter" : form.name}
      back={
        form === null ? undefined : { label: "New letter", onClick: back }
      }
      footer={
        form === null ? undefined : (
          <SheetFooter
            note={noItems ? "Add at least one item" : undefined}
            noteTone="warn"
            error={write.error instanceof Error ? write.error.message : undefined}
            primary={{
              label: "Write letter",
              pendingLabel: "Writing…",
              pending: write.isPending,
              disabled: noItems,
              onClick: () => write.mutate(form),
            }}
          />
        )
      }
      noFoot={form === null}
    >
      <style>{`@keyframes letter-swap-in { from { opacity: 0 } } .letter-swap { animation: letter-swap-in var(--t-swap-in, 160ms) var(--ease-out) }`}</style>
      {form === null ? (
        <div key="pick" className="letter-swap flex flex-col gap-8">
          {patterns.error instanceof Error && (
            <Banner tone="bad">{patterns.error.message}</Banner>
          )}
          {LETTER_GROUPS.map((group) => {
            const forms = WRITTEN_FORMS.filter(
              (one) => one.group === group.value
            )
            const kept = (patterns.data?.items ?? []).flatMap((one) => {
              const of = writtenForm(
                (one.facts as Record<string, unknown>).form
              ) ?? writtenForm("blank")
              return of !== undefined && of.group === group.value
                ? [{ pattern: one, form: of }]
                : []
            })
            return (
              <section key={group.value}>
                <h3 className="mb-3 text-[0.9375rem] font-semibold text-ink">
                  {group.label}
                  <span className="ml-2 font-normal text-body">
                    {forms.length + kept.length}
                  </span>
                </h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-5 md:grid-cols-4">
                  {forms.map((one) => (
                    <TemplateCard
                      key={one.key}
                      form={one}
                      name={one.name}
                      caption={one.paper}
                      onPick={() => start(one, null)}
                    />
                  ))}
                  {kept.map(({ pattern: one, form: of }) => (
                    <TemplateCard
                      key={one.template_id}
                      form={of}
                      name={one.name}
                      caption={`Saved by ${nameOf(one.created_by)}`}
                      onPick={() => start(of, one)}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      ) : (
        <div key={form.key} className="letter-swap flex max-w-[48rem] flex-col gap-5">
          {form.fields.map((row) => (
            <div
              key={row.map((field) => field.key).join("-")}
              className={cn(
                "grid gap-5",
                row.length === 2 || !WIDE_KEYS.has(row[0]?.key ?? "")
                  ? "md:grid-cols-2"
                  : "grid-cols-1"
              )}
            >
              {row.map((field) => (
                <Field key={field.key} label={field.label}>
                  <Input
                    value={values[field.key] ?? ""}
                    autoComplete="off"
                    onChange={(event) =>
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }))
                    }
                  />
                </Field>
              ))}
            </div>
          ))}

          {form.items && (
            <ItemsEditor items={items} onChange={setItems} />
          )}
        </div>
      )}
    </Sheet>
  )
}

/// A row with one long answer takes the row; a short one keeps half of it.
const WIDE_KEYS = new Set(["subject", "purpose"])

/// A template: its paper drawn small, its name, and the paper's own name.
function TemplateCard({
  form,
  name,
  caption,
  onPick,
}: {
  form: WrittenForm
  name: string
  caption: string
  onPick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      className="group flex flex-col gap-2.5 rounded-card text-left transition-transform duration-(--t-press) ease-(--ease-out) active:scale-[0.98]"
    >
      <div className="flex h-44 items-end justify-center overflow-hidden rounded-card bg-soft-3 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.03)] transition-shadow duration-200 group-hover:shadow-[inset_0_0_0_1px_rgba(40,98,220,0.35)]">
        <MiniPaper form={form} />
      </div>
      <div>
        <div className="text-[0.9375rem] leading-5 font-medium text-ink">
          {name}
        </div>
        <div className="text-[0.9375rem] leading-5 text-body">{caption}</div>
      </div>
    </button>
  )
}

/// The paper's shape in grey: letterhead, head lines, the table for goods, the
/// signature lines.
function MiniPaper({ form }: { form: WrittenForm }) {
  const bar = (width: string, tone = "bg-hairline") => (
    <span className={cn("block h-[3px] rounded-[2px]", tone)} style={{ width }} />
  )
  return (
    <div className="flex h-[9.5rem] w-[7rem] translate-y-2 flex-col gap-[5px] rounded-t-[3px] bg-canvas px-[11px] pt-3 shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_4px_14px_rgba(0,0,0,0.06)] transition-[translate,box-shadow] duration-250 ease-(--ease-out) group-hover:translate-y-0.5 group-hover:shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_10px_24px_rgba(0,0,0,0.1)]">
      <span className="mb-0.5 flex items-center justify-between border-b-[1.5px] border-ink pb-1">
        {bar("30%", "bg-ink")}
        {bar("36%", "bg-ink")}
      </span>
      <span className="grid grid-cols-2 gap-x-1.5 gap-y-[3px]">
        {bar("90%")}
        {bar("70%")}
        {bar("80%")}
        {bar("60%")}
      </span>
      {bar("84%")}
      {form.items ? (
        <span className="my-0.5 flex flex-col gap-[3px] border-y border-line-ico py-[3px]">
          {bar("100%", "bg-hairline-strong")}
          {bar("100%", "bg-soft-2")}
          {bar("100%", "bg-soft-2")}
          {bar("100%", "bg-soft-2")}
        </span>
      ) : (
        <>
          {bar("100%")}
          {bar("92%")}
          {bar("96%")}
          {bar("70%")}
        </>
      )}
      <span className="mt-auto mb-3 flex gap-1.5">
        {Array.from({ length: form.signs.length }, (_, index) => (
          <span key={index} className="h-px flex-1 bg-line-ico" />
        ))}
      </span>
    </div>
  )
}

/// The items, typed: what it is, and how many of what — two boxes a row.
function ItemsEditor({
  items,
  onChange,
}: {
  items: readonly WrittenItem[]
  onChange: (items: WrittenItem[]) => void
}) {
  const edit = (index: number, key: keyof WrittenItem, value: string) =>
    onChange(
      items.map((item, at) => (at === index ? { ...item, [key]: value } : item))
    )

  return (
    <section className="mt-3">
      <h3 className="mb-3 text-[0.9375rem] font-semibold text-ink">
        Items
        {items.length > 0 && (
          <span className="ml-2 font-normal text-body">{items.length}</span>
        )}
      </h3>
      <div className="overflow-hidden rounded-card border border-hairline">
        <div className="grid h-10 grid-cols-[minmax(0,1fr)_12rem_2.25rem] items-center gap-2.5 border-b border-hairline bg-soft px-3 text-[0.9375rem] font-medium text-body">
          <span>Item</span>
          <span>Quantity</span>
          <span />
        </div>
        {items.map((item, index) => (
          <div
            key={item.id}
            className="grid grid-cols-[minmax(0,1fr)_12rem_2.25rem] items-center gap-2.5 border-b border-row-line px-3 py-2 last:border-b-0"
          >
            <Input
              aria-label="Item"
              value={item.name}
              autoComplete="off"
              autoFocus={index === items.length - 1 && item.name === ""}
              onChange={(event) => edit(index, "name", event.target.value)}
            />
            {/* The quantity and its unit in one box, both typed: a BPKB is
                "1 buku", a key "2 pcs". */}
            <div className="flex h-11 items-center overflow-hidden rounded-inner border border-hairline-2 bg-canvas transition-[border-color,box-shadow] focus-within:border-accent focus-within:shadow-[0_0_0_3px_var(--focus-ring)]">
              <input
                aria-label="Quantity"
                inputMode="numeric"
                value={item.quantity}
                onChange={(event) =>
                  edit(index, "quantity", event.target.value)
                }
                className="h-full w-16 bg-transparent px-2.5 text-right text-[0.9375rem] text-ink tabular-nums outline-none"
              />
              <input
                aria-label="Unit"
                value={item.unit}
                autoComplete="off"
                onChange={(event) => edit(index, "unit", event.target.value)}
                className="h-full min-w-0 flex-1 border-l border-hairline bg-transparent px-2.5 text-[0.9375rem] text-body outline-none"
              />
            </div>
            <button
              type="button"
              aria-label="Remove item"
              onClick={() => onChange(items.filter((_, at) => at !== index))}
              className="grid size-9 place-items-center rounded-inner text-body transition-colors hover:bg-soft-2 hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
      <Button
        variant="quiet"
        className="mt-2 font-medium text-accent hover:text-accent [&_svg]:text-accent"
        onClick={() => onChange([...items, newItem()])}
      >
        <Plus />
        Add item
      </Button>
    </section>
  )
}
