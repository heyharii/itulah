import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ClipboardList,
  Package,
  PackageCheck,
  ShoppingBag,
  Truck,
} from "lucide-react"
import { useMemo, useRef, useState } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { confirm } from "@/components/ui/confirm"
import { Kpi, KpiStrip } from "@/components/ui/kpi"
import { Screen } from "@/components/ui/screen"
import { describe } from "@/lib/errors"
import { count, pcs } from "@/lib/format"
import {
  byArticle,
  dispatchKoli,
  packArticles,
  pickArticles,
  unpackKoli,
  unpickArticles,
  useReturnBoard,
  type ReturnArticle,
  type ReturnKoli,
} from "@/lib/return-steps"
import { returnsKey } from "@/lib/returns"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"
import {
  many,
  Notice,
  RED,
  Tabs,
  type Tab,
  type TabSpec,
} from "@/screens/return-to-ho/parts"
import {
  ArticleSheet,
  DispatchDialog,
  PackSheet,
} from "@/screens/return-to-ho/sheets"
import {
  PackedTable,
  PickedTable,
  PicklistTable,
  TripTable,
} from "@/screens/return-to-ho/tables"
import { idempotencyKey } from "@itulah/contract/client"

const sumOf = (articles: readonly ReturnArticle[]) =>
  articles.reduce((sum, one) => sum + one.quantity, 0)

/// **Return to HO** — the store's copy of the hub's Ops › Allotment board
/// (owner, 25 Oct 2026). What HO asked this shop to send back is worked in five
/// steps, one tab each: **Picklist** (pick an article, whole) → **Picked**
/// (pack some of it into a koli, or take it back) → **Packed** (tick koli to
/// dispatch or unpack) → **In transit** → **Received**.
///
/// The shop sees goods, never HO's requests: no allotment numbers anywhere, and
/// no part of an article — what it does not pick stays on the Picklist. Every
/// koli goes to HO, so there is no store rail. The figures and the tab counts
/// come from one board read every ten seconds (`useReturnBoard`).
export function ReturnToHo() {
  const board = useReturnBoard()
  const client = useQueryClient()
  const [tab, setTab] = useState<Tab>("picklist")
  /// The node's sentences about the last press, shown over the tabs and again
  /// inside whichever sheet it was pressed in.
  const [notice, setNotice] = useState<readonly string[]>([])
  /// The article opened to its SKUs. Kept after the sheet closes so it does not
  /// empty while it slides away.
  const [view, setView] = useState<{
    article: ReturnArticle
    pickable: boolean
  } | null>(null)
  const [viewOpen, setViewOpen] = useState(false)
  const [packing, setPacking] = useState(false)
  const [dispatching, setDispatching] = useState(false)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [note, setNote] = useState("")

  // One key per press: a retry of the same press — a dropped answer, a second
  // tap — is the same act, and the next press is a new one.
  const keys = useRef(new Map<string, string>())
  const keyFor = (act: string) => {
    let key = keys.current.get(act)
    if (key === undefined) {
      key = idempotencyKey()
      keys.current.set(act, key)
    }
    return key
  }
  const spent = (act: string) => keys.current.delete(act)

  const data = board.data
  const ready = data !== undefined
  const toPick = useMemo(() => byArticle(data?.to_pick ?? []), [data])
  const picked = useMemo(() => byArticle(data?.picked ?? []), [data])
  const packed = data?.packed ?? []
  const trips = data?.trips ?? []
  const inTransit = trips.filter((trip) => trip.received_at === null)
  const received = trips.filter((trip) => trip.received_at !== null)
  const chosen = packed.filter((one) => ticked.has(one.koli.koli_id))

  const refresh = () => {
    void client.invalidateQueries({ queryKey: returnsKey() })
  }
  const failed = (error: unknown) => setNotice([describe(error)])

  const pick = useMutation({
    mutationFn: (article: ReturnArticle) =>
      pickArticles(
        [article.article_code],
        keyFor(`pick:${article.article_code}`),
      ),
    onMutate: () => setNotice([]),
    onSuccess: (result, article) => {
      spent(`pick:${article.article_code}`)
      setViewOpen(false)
      if (result.refused.length > 0) setNotice(result.refused)
      if (result.picked > 0)
        toast.success(`${article.name} · ${pcs(result.picked)} now in Picked`)
    },
    onError: failed,
    onSettled: refresh,
  })

  const unpick = useMutation({
    mutationFn: (articles: readonly ReturnArticle[]) => {
      const codes = articles.map((one) => one.article_code)
      return unpickArticles(codes, keyFor(`unpick:${codes.join(",")}`))
    },
    onMutate: () => setNotice([]),
    onSuccess: (_, articles) => {
      spent(`unpick:${articles.map((one) => one.article_code).join(",")}`)
      const [only] = articles
      toast.success(
        articles.length === 1 && only !== undefined
          ? `${only.name} back in Picklist`
          : `${pcs(sumOf(articles))} back in Picklist`,
      )
    },
    onError: failed,
    onSettled: refresh,
  })

  const pack = useMutation({
    mutationFn: (codes: string[]) =>
      packArticles(codes, keyFor(`pack:${[...codes].sort().join(",")}`)),
    onMutate: () => setNotice([]),
    onSuccess: (result, codes) => {
      spent(`pack:${[...codes].sort().join(",")}`)
      setPacking(false)
      const sealed = result.koli.map((one) => one.koli)
      toast.success(
        `Koli ${sealed.map((one) => one.koli_number).join(", ")} sealed · ${pcs(
          sealed.reduce((sum, one) => sum + one.unit_count, 0),
        )}`,
      )
    },
    onError: failed,
    onSettled: refresh,
  })

  const unpack = useMutation({
    mutationFn: async (koli: readonly ReturnKoli[]) => {
      // One at a time; a koli done before a failure is not asked twice on the
      // retry, because its key is the same.
      for (const one of koli) {
        await unpackKoli(one.koli.koli_id, keyFor(`unpack:${one.koli.koli_id}`))
        spent(`unpack:${one.koli.koli_id}`)
      }
    },
    onMutate: () => setNotice([]),
    onSuccess: (_, koli) => {
      setTicked(new Set())
      toast.success(`${count(koli.length)} koli unpacked · back in Picked`)
    },
    onError: failed,
    onSettled: refresh,
  })

  const dispatch = useMutation({
    mutationFn: (koli: readonly ReturnKoli[]) => {
      const ids = koli.map((one) => one.koli.koli_id)
      return dispatchKoli(
        ids,
        note.trim(),
        keyFor(`dispatch:${ids.join(",")}:${note.trim()}`),
      )
    },
    onMutate: () => setNotice([]),
    onSuccess: (result, koli) => {
      const ids = koli.map((one) => one.koli.koli_id)
      spent(`dispatch:${ids.join(",")}:${note.trim()}`)
      setDispatching(false)
      setTicked(new Set())
      setNote("")
      setTab("transit")
      toast.success(
        `${result.dispatch_number} · ${pcs(result.quantity)} on the way to HO`,
      )
    },
    onError: failed,
    onSettled: refresh,
  })

  const open = (article: ReturnArticle, pickable: boolean) => {
    setNotice([])
    setView({ article, pickable })
    setViewOpen(true)
  }

  async function backToPicklist() {
    const ok = await confirm({
      title: "Back to Picklist?",
      body: `${many(picked.length, "article")} · ${pcs(sumOf(picked))}`,
      action: "Back to Picklist",
      destructive: true,
    })
    if (ok) unpick.mutate(picked)
  }

  async function unpackChosen() {
    const ok = await confirm({
      title: "Unpack?",
      body: `${count(chosen.length)} koli · back in Picked`,
      action: "Unpack",
      destructive: true,
    })
    if (ok) unpack.mutate(chosen)
  }

  const toggle = (koliId: string) =>
    setTicked((was) => {
      const next = new Set(was)
      if (next.has(koliId)) next.delete(koliId)
      else next.add(koliId)
      return next
    })

  const tabs: readonly TabSpec[] = [
    {
      id: "picklist",
      label: "Picklist",
      icon: ClipboardList,
      n: toPick.length,
    },
    { id: "picked", label: "Picked", icon: ShoppingBag, n: picked.length },
    { id: "packed", label: "Packed", icon: Package, n: packed.length },
    { id: "transit", label: "In transit", icon: Truck, n: inTransit.length },
    {
      id: "received",
      label: "Received",
      icon: PackageCheck,
      n: received.length,
    },
  ]

  return (
    <Screen counter>
      <KpiStrip className="md:grid-cols-4 xl:grid-cols-4">
        <Kpi label="To pick" value={ready ? pcs(sumOf(toPick)) : "—"} />
        <Kpi label="Picked" value={ready ? pcs(sumOf(picked)) : "—"} />
        <Kpi
          label="Packed"
          value={ready ? `${count(packed.length)} koli` : "—"}
        />
        <Kpi
          label="In transit"
          value={
            ready
              ? `${count(inTransit.reduce((sum, trip) => sum + trip.koli_count, 0))} koli`
              : "—"
          }
        />
      </KpiStrip>

      {queryState(board, {
        loading: "Reading the return board…",
        render: () => (
          <>
            <Tabs
              tabs={tabs}
              value={tab}
              onChange={(next) => {
                setNotice([])
                setTab(next)
              }}
            />
            <Notice lines={viewOpen || packing || dispatching ? [] : notice} />

            {tab === "picklist" && (
              <PicklistTable
                articles={toPick}
                pending={pick.isPending ? pick.variables.article_code : null}
                onPick={(article) => pick.mutate(article)}
                onOpen={(article) => open(article, true)}
              />
            )}

            {tab === "picked" && (
              <>
                <Bar>
                  <Button
                    variant="primary"
                    className={RED}
                    disabled={picked.length === 0}
                    pending={unpick.isPending}
                    onClick={backToPicklist}
                  >
                    Back to Picklist
                  </Button>
                  <Button
                    variant="primary"
                    disabled={picked.length === 0}
                    onClick={() => {
                      setNotice([])
                      setPacking(true)
                    }}
                  >
                    Pack
                  </Button>
                </Bar>
                <PickedTable
                  articles={picked}
                  busy={unpick.isPending}
                  onUnpick={(article) => unpick.mutate([article])}
                  onOpen={(article) => open(article, false)}
                />
              </>
            )}

            {tab === "packed" && (
              <>
                <Bar>
                  <Button
                    variant="primary"
                    className={RED}
                    disabled={chosen.length === 0}
                    pending={unpack.isPending}
                    onClick={unpackChosen}
                  >
                    Unpack
                  </Button>
                  <Button
                    variant="primary"
                    disabled={chosen.length === 0}
                    onClick={() => {
                      setNotice([])
                      setDispatching(true)
                    }}
                  >
                    {chosen.length === 0
                      ? "Dispatch"
                      : `Dispatch ${count(chosen.length)} koli`}
                  </Button>
                </Bar>
                <PackedTable
                  koli={packed}
                  ticked={ticked}
                  onToggle={toggle}
                  onToggleAll={(on) =>
                    setTicked(
                      on
                        ? new Set(packed.map((one) => one.koli.koli_id))
                        : new Set(),
                    )
                  }
                />
              </>
            )}

            {tab === "transit" && <TripTable trips={inTransit} />}
            {tab === "received" && <TripTable trips={received} />}
          </>
        ),
      })}

      {view !== null && (
        <ArticleSheet
          article={view.article}
          open={viewOpen}
          pending={view.pickable ? pick.isPending : null}
          notice={notice}
          onPick={() => pick.mutate(view.article)}
          onClose={() => setViewOpen(false)}
        />
      )}

      <PackSheet
        articles={picked}
        open={packing}
        pending={pack.isPending}
        notice={notice}
        onDone={(codes) => pack.mutate(codes)}
        onClose={() => setPacking(false)}
      />

      <DispatchDialog
        open={dispatching}
        koli={chosen}
        note={note}
        pending={dispatch.isPending}
        notice={notice}
        onNote={setNote}
        onSend={() => dispatch.mutate(chosen)}
        onClose={() => setDispatching(false)}
      />
    </Screen>
  )
}

/// The bar of verbs above a table, right-aligned; on a phone each takes half.
function Bar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mb-3.5 flex flex-wrap items-center justify-end gap-2",
        "max-md:[&>button]:flex-1",
      )}
    >
      {children}
    </div>
  )
}
