import { Camera, Printer } from "lucide-react"
import { useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Fab } from "@/components/ui/fab"
import { Banner } from "@/components/ui/states"
import { dateText, moment } from "@/lib/format"
import { useLayout } from "@/lib/layout"
import type { ShopPeople } from "@/lib/queries/shop-people"
import { cn } from "@/lib/utils"
import type { Voucher } from "@/screens/money/petty-book"
import {
  BackLink,
  Stamp,
  TotalPanel,
  VoucherHeading,
} from "@/screens/money/petty-parts"
import {
  shrinkPhoto,
  useKeepNota,
  useNota,
} from "@/screens/money/petty-receipts"
import { printNode } from "@/screens/money/petty-printing"
import { VoucherPaper } from "@/screens/money/petty-voucher-paper"
import { money } from "@itulah/contract/money"

/// A saved BKM or BKK, read — the same page as the form with the fields turned
/// into facts, a stamp on the total, and Print in the heading.
///
/// A BKK's nota is shown when this device holds its photo, and can be added
/// here afterwards: a voucher saved without one cannot be, but one whose photo
/// was taken on another tablet can be given one on this.
export function VoucherView({
  voucher,
  shop,
  people,
  said,
  onDismiss,
  onBack,
}: {
  voucher: Voucher
  /// The shop's name, for the printed slip.
  shop: string
  people: ShopPeople
  /// What to say about the save that led here, until it is dismissed.
  said: string | null
  onDismiss: () => void
  onBack: () => void
}) {
  const phone = useLayout() === "phone"
  const out = voucher.kind === "BKK"
  const paper = useRef<HTMLDivElement>(null)
  const by = people.nameOf(voucher.by)
  const counted =
    voucher.countedWith === null ? null : people.nameOf(voucher.countedWith)

  const print = () => {
    if (paper.current !== null) printNode(paper.current, voucher.no)
  }

  return (
    <div>
      <BackLink onClick={onBack}>Petty cash</BackLink>
      <VoucherHeading kind={voucher.kind} title={voucher.kind} no={voucher.no}>
        <Button onClick={print}>
          <Printer />
          Print
        </Button>
      </VoucherHeading>
      <Fab label="Print" icon={Printer} onClick={print} />

      {said !== null && (
        <Banner tone="ok" className="mb-4" onDismiss={onDismiss}>
          {said}
        </Banner>
      )}

      <Card className="grid lg:grid-cols-[minmax(0,1fr)_18.75rem]">
        <dl className="grid content-start gap-x-6 gap-y-[1.125rem] p-5 sm:grid-cols-2">
          <Item term="Date">{moment(voucher.at)}</Item>
          <Item term={out ? "Paid to" : "Received from"}>
            {voucher.party === "" ? <Dash /> : voucher.party}
          </Item>
          <Item term="Reference">
            {voucher.reference === "" ? (
              <Dash />
            ) : (
              <span className="font-mono">{voucher.reference}</span>
            )}
          </Item>
          {voucher.note !== "" && (
            <Item term="Note" wide>
              {voucher.note}
            </Item>
          )}
          {voucher.approval !== null && (
            <Item term="Finance code">
              <span className="font-mono">{voucher.approval.code}</span>
              {voucher.approval.by !== null && (
                <span className="font-normal text-mute">
                  {" "}
                  · {voucher.approval.by}
                </span>
              )}
            </Item>
          )}
          <Item term="By">{by}</Item>
          {counted !== null && <Item term="Counted with">{counted}</Item>}
        </dl>
        <TotalPanel
          label={out ? "Total paid" : "Total received"}
          totalMinor={voucher.totalMinor}
          stamp={
            <Stamp
              sub={dateText(new Date(voucher.at), {
                day: "2-digit",
                month: "short",
              }).toUpperCase()}
            >
              Recorded
            </Stamp>
          }
        />
      </Card>

      <div className="mt-6 mb-2 flex">
        <span className="border-b-2 border-ink pb-1.5 text-control font-medium text-ink">
          Other lines
          <em className="ml-1.5 font-normal text-mute not-italic tabular-nums">
            {voucher.lines.length}
          </em>
        </span>
      </div>
      <Card>
        {phone ? (
          <ul>
            {voucher.lines.map((line) => (
              <li
                key={line.id}
                className="flex items-start justify-between gap-3 border-b border-hairline px-4 py-3 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block text-control break-words text-ink">
                    {line.note}
                  </span>
                  <span className="block text-[0.875rem] text-mute">
                    {line.word}
                  </span>
                </span>
                <span className="shrink-0 text-control font-medium text-ink tabular-nums">
                  {money(line.amountMinor)}
                </span>
              </li>
            ))}
            <li className="flex justify-between gap-3 bg-soft/50 px-4 py-3 text-control font-semibold text-ink tabular-nums">
              <span>Total</span>
              <span>{money(voucher.totalMinor)}</span>
            </li>
          </ul>
        ) : (
          <table className="w-full table-fixed border-collapse text-cell">
            <thead>
              <tr className="h-10 bg-soft text-left text-eyebrow font-medium text-body">
                <th className="w-[30%] border-b border-hairline px-4 font-medium">
                  Account
                </th>
                <th className="border-b border-hairline px-4 font-medium">
                  Note
                </th>
                <th className="w-40 border-b border-hairline px-4 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {voucher.lines.map((line) => (
                <tr key={line.id} className="border-b border-hairline">
                  <td className="px-4 py-3 align-top">{line.word}</td>
                  <td className="px-4 py-3 align-top break-words whitespace-normal">
                    {line.note}
                  </td>
                  <td className="px-4 py-3 text-right align-top tabular-nums">
                    {money(line.amountMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="h-[3.25rem] bg-soft/50 font-semibold text-ink">
                <td className="px-4">Total</td>
                <td />
                <td className="px-4 text-right tabular-nums">
                  {money(voucher.totalMinor)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </Card>

      {out && <Nota id={voucher.id} />}

      {/* The slip that is printed, out of sight until it is. */}
      <div hidden aria-hidden>
        <VoucherPaper
          ref={paper}
          voucher={voucher}
          shop={shop}
          by={by}
          countedWith={counted}
        />
      </div>
    </div>
  )
}

function Item({
  term,
  wide = false,
  children,
}: {
  term: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-[0.1875rem]",
        wide && "sm:col-span-2",
      )}
    >
      <dt className="text-[0.875rem] text-mute">{term}</dt>
      <dd className="text-control font-medium break-words text-ink">
        {children}
      </dd>
    </div>
  )
}

function Dash() {
  return <span className="font-normal text-mute">—</span>
}

/// The nota's photo, or the way to add one.
function Nota({ id }: { id: string }) {
  const nota = useNota(id)
  const keep = useKeepNota()
  const input = useRef<HTMLInputElement>(null)
  const [failed, setFailed] = useState<string | null>(null)
  if (nota.isPending) return null
  return (
    <div className="mt-4 flex flex-col gap-2">
      {nota.data !== null && nota.data !== undefined ? (
        <Card className="p-3">
          <img
            src={nota.data}
            alt="Photo of the nota"
            className="mx-auto max-h-[28rem] w-full rounded-inner object-contain"
          />
        </Card>
      ) : (
        <>
          <input
            ref={input}
            type="file"
            accept="image/*"
            capture="environment"
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ""
              if (file === undefined) return
              setFailed(null)
              shrinkPhoto(file)
                .then((url) => keep(id, url))
                .catch(() =>
                  setFailed("That photo could not be kept on this device."),
                )
            }}
          />
          <Button
            className="w-full justify-center sm:w-auto sm:self-start"
            onClick={() => input.current?.click()}
          >
            <Camera />
            Add the nota photo
          </Button>
          {failed !== null && (
            <span className="text-[0.875rem] text-bad">{failed}</span>
          )}
        </>
      )}
    </div>
  )
}
