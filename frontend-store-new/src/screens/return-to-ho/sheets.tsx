import { Dialog } from "@base-ui/react/dialog"
import { X } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Sheet } from "@/components/ui/sheet"
import { count, pcs, sku } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import type { ReturnArticle, ReturnKoli } from "@/lib/return-steps"
import {
  drawn,
  FOOT,
  many,
  Notice,
  RedText,
  Thumb,
} from "@/screens/return-to-ho/parts"

/// The sheets of Return to HO: an article opened to its SKUs, the Pack sheet,
/// and the small dialog that puts koli on a trip.

/// An article as a card: photograph, name and pieces on a soft head, then one
/// row per SKU. `action` sits in the head; `marked` says the article is in the
/// koli being packed.
function ArticleCard({
  article,
  action,
  marked = false,
}: {
  article: ReturnArticle
  action?: React.ReactNode
  marked?: boolean
}) {
  return (
    <div className="overflow-hidden rounded-card border border-hairline">
      <div className="flex items-center gap-3 bg-soft px-3.5 py-3">
        <Thumb url={article.image_url} name={drawn(article)} />
        <div className="min-w-0 flex-1 leading-5">
          <div className="truncate font-medium text-ink">{article.name}</div>
          <div className="truncate text-body">
            {many(article.skus.length, "SKU")}
            {" · "}
            <span className="font-mono">{article.article_code}</span>
          </div>
        </div>
        <span className="shrink-0 font-semibold whitespace-nowrap text-ink tabular-nums">
          {pcs(article.quantity)}
        </span>
        {action}
      </div>
      {article.skus.map((one) => (
        <div
          key={one.sku_code}
          className="flex h-[3.25rem] items-center gap-3 border-t border-hairline px-3.5"
        >
          <div className="min-w-0 flex-1 leading-5">
            <div className="truncate text-ink">
              {one.variant === "" ? sku(one.sku_code) : one.variant}
            </div>
            <div className="truncate font-mono text-body">
              {sku(one.sku_code)}
            </div>
          </div>
          <span className="whitespace-nowrap text-body tabular-nums">
            {pcs(one.quantity)}
          </span>
          {marked && (
            <span className="font-medium whitespace-nowrap text-ok-fg">
              In koli
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/// One article opened over its table: its SKUs and pieces. On the Picklist the
/// foot picks the whole article; from Picked it is only read.
export function ArticleSheet({
  article,
  open,
  pending,
  notice,
  onPick,
  onClose,
}: {
  article: ReturnArticle
  open: boolean
  /// Set on the Picklist: the foot's Pick.
  pending: boolean | null
  notice: readonly string[]
  onPick: () => void
  onClose: () => void
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      id={article.article_code}
      title={article.name}
      footer={
        pending === null ? undefined : (
          <div className="flex justify-end">
            <Button
              variant="primary"
              className={`${FOOT} max-md:w-full`}
              pending={pending}
              onClick={onPick}
            >
              Pick {pcs(article.quantity)}
            </Button>
          </div>
        )
      }
    >
      <Notice lines={notice} />
      <ArticleCard article={article} />
    </Sheet>
  )
}

/// **Pack · Koli** — one card per picked article; Pack puts it into this koli,
/// Take out puts it back. Nothing exists until **Done**, which seals the koli
/// with what was put in; closing the sheet any other way makes nothing.
export function PackSheet({
  articles: live,
  open,
  pending,
  notice,
  onDone,
  onClose,
}: {
  articles: readonly ReturnArticle[]
  open: boolean
  pending: boolean
  notice: readonly string[]
  onDone: (articleCodes: string[]) => void
  onClose: () => void
}) {
  // Kept after the articles have left Picked, so the sheet does not empty while
  // it slides away.
  const last = useRef(live)
  if (live.length > 0) last.current = live
  const articles = last.current
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set())
  // A koli starts empty each time the sheet opens.
  const [wasOpen, setWasOpen] = useState(open)
  if (wasOpen !== open) {
    setWasOpen(open)
    if (open) setChosen(new Set())
  }
  const toggle = (code: string) =>
    setChosen((was) => {
      const next = new Set(was)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  const inKoli = articles.filter((one) => chosen.has(one.article_code))
  const done = () => {
    if (inKoli.length === 0) onClose()
    else onDone(inKoli.map((one) => one.article_code))
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Pack · Koli"
      footer={
        <div className="flex items-center justify-end gap-3">
          {inKoli.length > 0 && (
            <span className="min-w-0 flex-1 truncate text-body max-md:hidden">
              {pcs(inKoli.reduce((sum, one) => sum + one.quantity, 0))}
            </span>
          )}
          <Button
            variant="primary"
            className={`${FOOT} max-md:w-full`}
            pending={pending}
            onClick={done}
          >
            Done
          </Button>
        </div>
      }
    >
      <Notice lines={notice} />
      <div className="flex flex-col gap-3">
        {articles.map((article) => {
          const on = chosen.has(article.article_code)
          return (
            <ArticleCard
              key={article.article_code}
              article={article}
              marked={on}
              action={
                on ? (
                  <RedText onClick={() => toggle(article.article_code)}>
                    Take out
                  </RedText>
                ) : (
                  <Button
                    variant="primary"
                    size="card"
                    onClick={() => toggle(article.article_code)}
                  >
                    Pack
                  </Button>
                )
              }
            />
          )
        })}
      </div>
    </Sheet>
  )
}

/// **Dispatch N koli** — a small centred dialog (a sheet on a phone, which
/// keeps the keyboard clear of its button): where it goes, how many pieces,
/// who carries it, and the one button.
export function DispatchDialog({
  open,
  koli,
  note,
  pending,
  notice,
  onNote,
  onSend,
  onClose,
}: {
  open: boolean
  koli: readonly ReturnKoli[]
  note: string
  pending: boolean
  notice: readonly string[]
  onNote: (note: string) => void
  onSend: () => void
  onClose: () => void
}) {
  const phone = useLayout() === "phone"
  // Kept after the koli have left the table, so the dialog does not empty while
  // it fades out.
  const last = useRef(koli)
  if (koli.length > 0) last.current = koli
  const shown = last.current
  const title = `Dispatch ${count(shown.length)} koli`

  const body = (
    <div className="flex flex-col gap-6">
      <Notice lines={notice} />
      <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-meta">
        <dt className="text-body">To</dt>
        <dd className="font-medium text-ink">HO</dd>
        <dt className="text-body">Pcs</dt>
        <dd className="font-medium text-ink tabular-nums">
          {count(shown.reduce((sum, one) => sum + one.koli.unit_count, 0))}
        </dd>
      </dl>
      <Field label="Trip note">
        <Input
          value={note}
          onChange={(event) => onNote(event.target.value)}
          placeholder="Courier · plate · driver"
          autoComplete="off"
        />
      </Field>
    </div>
  )
  const send = (
    <Button
      variant="primary"
      className={`${FOOT} max-md:w-full`}
      pending={pending}
      onClick={onSend}
    >
      Dispatch
    </Button>
  )

  if (phone)
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => !next && onClose()}
        title={title}
        footer={<div className="flex justify-end">{send}</div>}
      >
        {body}
      </Sheet>
    )

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="sheet-veil fixed inset-0 z-50 bg-[var(--scrim)] transition-opacity duration-(--t-sheet) ease-(--ease-out) data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:opacity-0" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[27.5rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-card border border-hairline bg-canvas shadow-pop transition-[opacity,scale] duration-(--t-sheet) ease-(--ease-out) outline-none data-[ending-style]:scale-[0.97] data-[ending-style]:opacity-0 data-[ending-style]:duration-(--t-exit) data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0">
          <div className="flex items-center gap-4 border-b border-hairline py-3 pr-4 pl-6">
            <Dialog.Title className="min-w-0 flex-1 truncate text-[1rem] leading-6 font-semibold tracking-[-0.01em] text-ink">
              {title}
            </Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-inner text-line-ico transition-colors hover:bg-soft-2 hover:text-ink"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="px-6 py-5">{body}</div>
          <div className="flex justify-end border-t border-hairline px-6 py-3.5">
            {send}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
