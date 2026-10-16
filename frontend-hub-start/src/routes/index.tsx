import { Suspense } from "react"
import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { brief, briefKey, type Brief } from "~/lib/cloud"

export const Route = createFileRoute("/")({
  // The gate runs server-side on the first paint (the server fn reads the
  // request's cookie in-process) and as an RPC on every later navigation.
  beforeLoad: async () => {
    const me = await whoAmI()
    if (!me) throw redirect({ to: "/login" })
  },
  component: Morning,
})

import { whoAmI } from "~/lib/cloud"

/// The morning brief — the first screen `/` lands on, as frontend-hub draws
/// it. The figures are read by a server function, so the first HTML already
/// carries them; the Suspense boundary is what the stream can split on.
function Morning() {
  return (
    <Suspense fallback={<p className="loading">Reading the night's figures…</p>}>
      <BriefBody />
    </Suspense>
  )
}

function BriefBody() {
  const { data } = useSuspenseQuery({
    queryKey: briefKey,
    queryFn: brief,
    // A morning brief is a morning's worth of news (frontend-hub's policy).
    staleTime: 60_000,
  })

  const change = data.trade.today_minor - data.trade.yesterday_minor
  const share =
    data.trade.yesterday_minor > 0
      ? Math.round((change / data.trade.yesterday_minor) * 100)
      : null

  return (
    <main className="page">
      <h1 className="greeting">
        {greetings[data.greeting]} <span className="mute">{data.who}</span>
      </h1>
      <p className="sub">Here is how things are going.</p>

      <div className="cards">
        <Card
          title="Trade today"
          body={
            share === null ? (
              <>
                The fleet has taken{" "}
                <b className="figure">{rupiah.format(data.trade.today_minor)}</b>{" "}
                so far today.
              </>
            ) : (
              <>
                The fleet has taken{" "}
                <b className="figure">
                  {rupiah.format(data.trade.today_minor)}
                </b>{" "}
                today,{" "}
                <b className="figure">
                  {share >= 0 ? "+" : ""}
                  {share}%
                </b>{" "}
                against yesterday's {rupiah.format(data.trade.yesterday_minor)}.
              </>
            )
          }
        />
        <Card
          title="Stock"
          body={
            <>
              <b className="figure">{count(data.stock.on_hand)}</b> pieces on hand across{" "}
              <b className="figure">{count(data.stock.sites)}</b> sites;{" "}
              <b className="figure">{count(data.stock.missing)}</b> missing.
            </>
          }
        />
        <Card
          title="Missing"
          body={
            data.missing.count === 0 ? (
              <>Nothing is missing right now.</>
            ) : (
              <>
                <b className="figure">{count(data.missing.count)}</b> lines,{" "}
                <b className="figure">{count(data.missing.quantity)}</b> pieces; the oldest has
                been missing for <b className="figure">{count(data.missing.oldest_hours ?? 0)}h</b>.
              </>
            )
          }
        />
        <Card
          title="Price book"
          body={
            <>
              <b className="figure">{count(data.commercial.shop_count)}</b> shops on version{" "}
              <b className="figure">
                {data.commercial.published_version === null
                  ? "—"
                  : count(data.commercial.published_version)}
              </b>
              ; <b className="figure">{count(data.commercial.behind)}</b> behind.
            </>
          }
        />
      </div>

      {data.prompts.length > 0 && (
        <ul className="prompts">
          {data.prompts.map((prompt) => (
            <li key={prompt}>{prompt}</li>
          ))}
        </ul>
      )}
    </main>
  )
}

const greetings: Record<Brief["greeting"], string> = {
  morning: "Good morning,",
  afternoon: "Good afternoon,",
  evening: "Good evening,",
  night: "Working late,",
}

function Card({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <p>{body}</p>
    </section>
  )
}

/// minor is the whole rupiah figure — frontend-hub's `money` rounds to whole
/// rupiah and prefixes Rp; this surface needs only that much of it, formatted
/// once and used inline.
const rupiah = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
})

function count(value: number): string {
  return new Intl.NumberFormat("id-ID").format(value)
}
