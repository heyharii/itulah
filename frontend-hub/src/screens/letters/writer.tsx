import { Menu } from "@base-ui/react/menu"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import type { JSONContent } from "@tiptap/react"
import {
  ArrowLeft,
  BookmarkPlus,
  Check,
  ChevronRight,
  Download,
  Ellipsis,
  Printer,
  Rows3,
  Ban,
  Trash2,
} from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { button } from "@/components/ui/button-style"
import { Field, Input, Textarea } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { RecordPanel } from "@/components/ui/record-panel"
import { Sheet } from "@/components/ui/sheet"
import { SheetFooter } from "@/components/ui/sheet-footer"
import { Banner } from "@/components/ui/states"
import { POP_MOTION } from "@/lib/filter-chrome"
import { time } from "@/lib/format"
import { useNameOfLogin } from "@/lib/queries/hr-employees"
import {
  discardLetter,
  issueLetter,
  letterKeys,
  letterTone,
  LETTER_STATUS_LABEL,
  saveLetter,
  saveTemplate,
  voidLetter,
} from "@/lib/queries/letters"
import { cn } from "@/lib/utils"
import {
  FormatBar,
  LetterProse,
  useLetterEditor,
} from "@/screens/letters/editor"
import {
  itemsOf,
  newItem,
  registerFacts,
  writtenFacts,
  type WrittenForm,
  type WrittenItem,
} from "@/screens/letters/forms"
import { downloadLetterPdf } from "@/screens/letters/letter-pdf"
import {
  LetterPrintSheet,
  type LetterPrintChoice,
} from "@/screens/letters/print-letter"
import {
  COPY_NAMES,
  PrintCopies,
  PrintedProse,
  WrittenPaper,
} from "@/screens/letters/written"
import type { LetterDetail } from "@itulah/contract"

/// One written letter: the paper is the editor (owner, 2026-10-17,
/// letter-writer-prototype.html step 4–5).
///
/// The desk holds the A4 sheet with the format bar floating over it; the side
/// says what happens to the letter rather than what it says — its number and
/// details, the blanks still To fill, the items, the activity — and carries
/// the one verb. A draft saves itself as it is typed ("Saved 14:31"); Issue
/// gives the number, locks the paper, adds the QR and opens the print sheet.
export function WrittenLetter({
  letter,
  form,
  onBack,
}: {
  letter: LetterDetail
  form: WrittenForm
  onBack: () => void
}) {
  const client = useQueryClient()
  const nameOf = useNameOfLogin()
  const id = letter.letter_id
  const draft = letter.status === "DRAFT"
  const author = nameOf(letter.created_by)

  const [facts, setFacts] = useState<Record<string, unknown>>(() => ({
    ...letter.facts,
  }))
  const items = itemsOf(facts)
  const typed = writtenFacts(facts)

  // What is waiting to be saved, read by the save when it fires rather than
  // when it was scheduled.
  const pending = useRef<{ facts: Record<string, unknown>; body: unknown }>({
    facts,
    body: letter.body,
  })
  const [body, setBody] = useState<unknown>(letter.body)
  const [unsaved, setUnsaved] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: letterKeys.detail(id) })
    void client.invalidateQueries({ queryKey: letterKeys.all })
  }, [client, id])

  const save = useMutation({
    mutationFn: () => {
      const next = pending.current
      return saveLetter(id, {
        body: next.body as Record<string, unknown>,
        facts: {
          ...next.facts,
          ...registerFacts(
            form,
            writtenFacts(next.facts),
            itemsOf(next.facts)
          ),
        },
      })
    },
    onSuccess: () => {
      setSavedAt(new Date())
      void client.invalidateQueries({ queryKey: letterKeys.all })
    },
  })

  const touch = () => setUnsaved(true)

  useEffect(() => {
    if (!unsaved || !draft) return
    const timer = setTimeout(() => {
      setUnsaved(false)
      save.mutate()
    }, 800)
    return () => clearTimeout(timer)
    // `save` is stable enough: its mutate reads `pending` when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unsaved, draft, facts, body])

  const setFact = (key: string, value: unknown) => {
    setFacts((current) => {
      const next = { ...current, [key]: value }
      pending.current = { ...pending.current, facts: next }
      return next
    })
    touch()
  }
  const setItems = (next: WrittenItem[]) => setFact("items", next)

  const editor = useLetterEditor({
    body: letter.body,
    editable: draft,
    onChange: (next: JSONContent) => {
      pending.current = { ...pending.current, body: next }
      setBody(next)
      touch()
    },
  })

  // — print —
  const [printing, setPrinting] = useState(false)
  const [choice, setChoice] = useState<LetterPrintChoice>({
    paper: "A4",
    copies: form.items ? 3 : 1,
  })

  const issue = useMutation({
    mutationFn: async () => {
      // What is issued is what was typed: the last keystrokes go up first.
      if (unsaved || save.isPending) {
        setUnsaved(false)
        await save.mutateAsync()
      }
      return issueLetter(id)
    },
    onSuccess: () => {
      refresh()
      setPrinting(true)
    },
  })

  const link = `${typeof window === "undefined" ? "" : window.location.origin}/letters?letter=${id}`
  const signatures = Array.isArray(facts.signatures)
    ? (facts.signatures as unknown[]).map((one) =>
        typeof one === "string" ? one : ""
      )
    : []

  const pdf = () =>
    downloadLetterPdf({
      number: letter.letter_number ?? "BELUM DITERBITKAN",
      form,
      facts: typed,
      items,
      body,
      author,
      signatures,
      copies: choice.copies > 1 ? COPY_NAMES.slice(0, choice.copies) : [],
      paper: choice.paper,
      link,
      voided: letter.status === "VOID" ? (letter.void_reason ?? "") : null,
    })

  const print = () => {
    setPrinting(false)
    // The copies are drawn before the printer is asked for them.
    window.setTimeout(() => window.print(), 80)
  }

  // — the rest of the verbs —
  const [naming, setNaming] = useState(false)
  const [patternName, setPatternName] = useState("")
  const [voiding, setVoiding] = useState(false)
  const [reason, setReason] = useState("")

  const keep = useMutation({
    mutationFn: async () => {
      if (unsaved) {
        setUnsaved(false)
        await save.mutateAsync()
      }
      return saveTemplate({ kind: letter.kind, name: patternName, from_letter: id })
    },
    onSuccess: () => {
      setNaming(false)
      setPatternName("")
      void client.invalidateQueries({ queryKey: letterKeys.all })
    },
  })
  const stop = useMutation({
    mutationFn: () => voidLetter(id, { reason }),
    onSuccess: () => {
      setVoiding(false)
      setReason("")
      refresh()
    },
  })
  const discard = useMutation({
    mutationFn: () => discardLetter(id),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: letterKeys.all })
      onBack()
    },
  })

  const problem = [save.error, issue.error, discard.error].find(
    (error): error is Error => error instanceof Error
  )

  // — the paper fits the desk —
  const desk = useRef<HTMLDivElement>(null)
  const [zoom, setZoom] = useState(1)
  useEffect(() => {
    const element = desk.current
    if (element === null) return
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0
      setZoom(Math.min(1, Math.max(0.3, (width - 48) / 794)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const paper = useRef<HTMLDivElement>(null)
  /// Takes the caret to a blank or a row, and lights it up for a moment.
  const goTo = (selector: string) => {
    const target = paper.current?.querySelector<HTMLElement>(selector)
    if (!target) return
    target.scrollIntoView({ behavior: "smooth", block: "center" })
    target.classList.remove("letter-flash")
    void target.offsetWidth
    target.classList.add("letter-flash")
    if (!draft) return
    window.setTimeout(() => {
      target.focus()
      const range = document.createRange()
      range.selectNodeContents(target)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    }, 250)
  }

  const addRow = () => {
    setItems([...items, newItem()])
    window.setTimeout(
      () => goTo(`[data-item="${items.length}"] [role="textbox"]`),
      60
    )
  }

  const blanks = form.head.filter((line) => line.blank !== undefined)
  const left = blanks.filter((line) => (typed[line.key] ?? "") === "").length

  const status =
    LETTER_STATUS_LABEL[letter.status] ?? letter.status

  return (
    <div className="flex h-full min-h-0 flex-col">
      <style>{`
        @keyframes letter-flash { 0%, 30% { background: #fff3c4; box-shadow: 0 0 0 3px #fff3c4 } 100% { background: transparent; box-shadow: 0 0 0 3px transparent } }
        .letter-flash { animation: letter-flash 1.1s var(--ease-out) }
      `}</style>

      {/* The bar: back, what it is, where it stands, whether it is saved. */}
      <div className="flex h-15 shrink-0 items-center gap-2.5 border-b border-hairline px-3 md:px-4">
        <Button variant="quiet" onClick={onBack}>
          <ArrowLeft />
          Letters
        </Button>
        <span aria-hidden className="h-5 w-px bg-hairline-2" />
        <span className="truncate text-[0.9375rem] font-semibold text-ink">
          {form.name}
        </span>
        <Pill tone={letterTone(letter.status)}>{status}</Pill>
        <span className="ml-auto truncate text-[0.9375rem] text-body max-md:hidden">
          {draft
            ? save.isPending || unsaved
              ? "Saving…"
              : savedAt !== null
                ? `Saved ${time(savedAt)}`
                : null
            : letter.issued_at !== null
              ? `Issued ${time(letter.issued_at)}`
              : null}
        </span>
        <Menu.Root>
          <Menu.Trigger
            aria-label="More"
            className={cn(
              button({ variant: "quiet", size: "icon" }),
              "max-md:ml-auto"
            )}
          >
            <Ellipsis />
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
              <Menu.Popup
                className={cn(
                  "min-w-[13rem] rounded-card border border-hairline bg-canvas p-1.5 shadow-pop",
                  POP_MOTION
                )}
              >
                <Menu.Item className={MENU_ITEM} onClick={() => setNaming(true)}>
                  <BookmarkPlus />
                  Keep as template
                </Menu.Item>
                {draft && (
                  <Menu.Item
                    className={cn(MENU_ITEM, "text-bad-fg [&_svg]:text-bad-fg")}
                    onClick={() => discard.mutate()}
                  >
                    <Trash2 />
                    Discard draft
                  </Menu.Item>
                )}
                {letter.status === "ISSUED" && (
                  <Menu.Item
                    className={cn(MENU_ITEM, "text-bad-fg [&_svg]:text-bad-fg")}
                    onClick={() => setVoiding(true)}
                  >
                    <Ban />
                    Void letter
                  </Menu.Item>
                )}
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </div>

      <div className="flex min-h-0 flex-1 max-lg:flex-col max-lg:overflow-y-auto">
        {/* The desk: the format bar over the paper. */}
        <div
          ref={desk}
          className="relative min-w-0 flex-1 bg-soft-3 lg:overflow-y-auto"
        >
          {draft && editor !== null && (
            <div className="pointer-events-none sticky top-0 z-10 flex justify-center px-4 pt-3">
              <FormatBar
                editor={editor}
                className="pointer-events-auto"
                inserts={
                  form.items
                    ? [{ label: "Item row", icon: Rows3, onSelect: addRow }]
                    : []
                }
              />
            </div>
          )}
          <div className="flex justify-center px-6 pt-5 pb-16">
            <div
              ref={paper}
              style={{ zoom }}
              className="shadow-[0_0_0_1px_rgba(0,0,0,0.06),0_6px_24px_rgba(0,0,0,0.07)]"
            >
              <WrittenPaper
                letter={letter}
                form={form}
                facts={typed}
                items={items}
                author={author}
                editable={draft}
                onFact={setFact}
                onItems={setItems}
                prose={<LetterProse editor={editor} />}
              />
            </div>
          </div>
        </div>

        {/* The side: what happens to the letter, not what it says. */}
        <aside className="flex shrink-0 flex-col border-hairline bg-canvas lg:w-[18.5rem] lg:border-l max-lg:border-t">
          <div className="flex-1 overflow-y-auto px-6 py-5">
            {problem && (
              <Banner tone="bad" className="mb-4">
                {problem.message}
              </Banner>
            )}
            <Block>
              <Row term="Number">
                {letter.letter_number === null ? (
                  <span className="text-body italic">no number yet</span>
                ) : (
                  <span className="font-mono">{letter.letter_number}</span>
                )}
              </Row>
              <Row term="Template">{form.name}</Row>
              {form.fields
                .flat()
                .filter((field) => field.key !== "letter_date")
                .map((field) => (
                  <Row key={field.key} term={field.label}>
                    {typed[field.key] || "—"}
                  </Row>
                ))}
              <Row term="Written by">{author}</Row>
            </Block>

            {draft && blanks.length > 0 && (
              <Block title="To fill" count={left || undefined}>
                {blanks.map((line) => {
                  const value = typed[line.key] ?? ""
                  const done = value !== ""
                  return (
                    <button
                      key={line.key}
                      type="button"
                      onClick={() => goTo(`[data-fact="${line.key}"]`)}
                      className="-mx-2 flex min-h-10 w-[calc(100%+1rem)] items-center gap-2.5 rounded-inner px-2 text-left text-[0.9375rem] transition-colors hover:bg-soft"
                    >
                      <span
                        className={cn(
                          "grid size-4 shrink-0 place-items-center rounded-full transition-colors duration-200",
                          done
                            ? "bg-ok text-canvas"
                            : "border-[1.5px] border-dashed border-line-ico"
                        )}
                      >
                        {done && <Check className="size-2.5 stroke-[3]" />}
                      </span>
                      <span className="flex-1 text-ink">{line.blank}</span>
                      {done ? (
                        <span className="max-w-[9rem] truncate text-body">
                          {value}
                        </span>
                      ) : (
                        <ChevronRight className="size-4 text-faint" />
                      )}
                    </button>
                  )
                })}
                {left === 0 && (
                  <div className="mt-1.5 flex items-center gap-2 text-[0.9375rem] text-ok-fg">
                    <Check className="size-4" />
                    Nothing left to fill
                  </div>
                )}
              </Block>
            )}

            {form.items && (
              <Block
                title="Items"
                count={items.filter((item) => item.name.trim() !== "").length}
              >
                {items.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      goTo(`[data-item="${index}"] [role="textbox"], [data-item="${index}"] td:nth-child(2)`)
                    }
                    className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-3 rounded-inner px-2 py-2 text-left text-[0.9375rem] transition-colors hover:bg-soft"
                  >
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {item.name || "New row"}
                    </span>
                    <span className="shrink-0 text-body tabular-nums">
                      {item.quantity} {item.unit}
                    </span>
                  </button>
                ))}
              </Block>
            )}

            {/* The block above already ends on a hairline; a second one here
                drew the line twice. */}
            <RecordPanel
              subject={{ kind: "letter", id }}
              className="mt-0 border-t-0 pt-0"
            />
          </div>

          {letter.status !== "VOID" && (
            <div className="shrink-0 border-t border-hairline px-6 py-3.5">
              {draft ? (
                <Button
                  variant="primary"
                  className="h-10 w-full"
                  pending={issue.isPending}
                  onClick={() => issue.mutate()}
                >
                  {issue.isPending ? "Issuing…" : "Issue letter"}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  <Button
                    variant="quiet"
                    className="btn-to-file font-semibold text-bad-fg hover:text-bad-fg [&_svg]:text-bad-fg"
                    onClick={pdf}
                  >
                    <Download />
                    Download PDF
                  </Button>
                  <Button
                    variant="primary"
                    className="h-10 flex-1"
                    onClick={() => setPrinting(true)}
                  >
                    <Printer />
                    Print
                  </Button>
                </div>
              )}
            </div>
          )}
        </aside>
      </div>

      {letter.letter_number !== null && (
        <>
          <LetterPrintSheet
            open={printing}
            onOpenChange={setPrinting}
            number={letter.letter_number}
            choice={choice}
            onChoice={setChoice}
            page={
              <WrittenPaper
                letter={letter}
                form={form}
                facts={typed}
                items={items}
                author={author}
                editable={false}
                prose={<PrintedProse body={body} />}
              />
            }
            onPrint={print}
            onPdf={() => {
              setPrinting(false)
              pdf()
            }}
          />
          <PrintCopies
            copies={choice.copies}
            paper={choice.paper}
            render={(copy) => (
              <WrittenPaper
                letter={letter}
                form={form}
                facts={typed}
                items={items}
                author={author}
                editable={false}
                copy={copy}
                prose={<PrintedProse body={body} />}
              />
            )}
          />
        </>
      )}

      <Sheet
        open={naming}
        onOpenChange={(next) => !next && setNaming(false)}
        size="rail"
        title="Keep as template"
        footer={
          <SheetFooter
            error={keep.error}
            primary={{
              label: "Keep",
              pending: keep.isPending,
              pendingLabel: "Keeping…",
              disabled: patternName.trim() === "",
              onClick: () => keep.mutate(),
            }}
          />
        }
      >
        <Field label="Name" required>
          <Input
            value={patternName}
            autoFocus
            onChange={(event) => setPatternName(event.target.value)}
          />
        </Field>
      </Sheet>

      <Sheet
        open={voiding}
        onOpenChange={(next) => !next && setVoiding(false)}
        size="rail"
        title={`Void ${letter.letter_number ?? ""}`}
        footer={
          <SheetFooter
            error={stop.error}
            primary={{
              label: "Void letter",
              tone: "danger",
              pending: stop.isPending,
              pendingLabel: "Voiding…",
              disabled: reason.trim() === "",
              onClick: () => stop.mutate(),
            }}
          />
        }
      >
        <Field label="Reason" required>
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </Sheet>
    </div>
  )
}

const MENU_ITEM =
  "flex min-h-9 cursor-default items-center gap-2.5 rounded-inner px-2.5 text-[0.9375rem] text-ink outline-none select-none data-[highlighted]:bg-soft-2 [&_svg]:size-4 [&_svg]:text-line-ico"

function Block({
  title,
  count,
  children,
}: {
  title?: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <section className="mb-5 border-b border-hairline pb-5">
      {title !== undefined && (
        <h3 className="mb-2 text-[0.9375rem] font-semibold text-ink">
          {title}
          {count !== undefined && (
            <span className="ml-2 font-normal text-body">{count}</span>
          )}
        </h3>
      )}
      {children}
    </section>
  )
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1 text-[0.9375rem] leading-[1.45]">
      <span className="shrink-0 text-body">{term}</span>
      <span className="min-w-0 truncate text-right text-ink">{children}</span>
    </div>
  )
}
