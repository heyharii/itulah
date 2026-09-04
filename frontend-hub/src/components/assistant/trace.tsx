import { ChevronDown, Sparkles } from "lucide-react"
import { useState } from "react"

import type { Exchange } from "@/components/assistant/state"
import { useAssistantCapabilities } from "@/lib/queries/assistant"
import type { ToolRun } from "@/lib/queries/assistant"
import { cn } from "@/lib/utils"

/// What the model did before it answered.
///
/// It is collapsed by default and expands while the turn runs, then settles
/// back to one line. That order matters: a person watching wants to see that
/// something is happening, and a person reading the answer afterwards wants
/// the reasoning out of the way — but still there, because "which reads is
/// this built on" is the first question anybody asks of a figure they did not
/// fetch themselves.

/// The chip's own words, from the server's catalogue, so a tool renamed in
/// Rust is renamed here without touching this file.
function useToolTitle() {
  const { data } = useAssistantCapabilities()
  return (name: string) =>
    data?.tools.find((tool) => tool.name === name)?.title ?? name
}

/// The arguments a call was made with, in a few words.
///
/// Not the JSON: `{"site_id":"store-07","date":"2026-09-03"}` is three tokens
/// of punctuation around two facts, and the two facts are the only part
/// anybody reads.
function summarise(input: Record<string, unknown>): string {
  const parts = Object.entries(input)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== ""
    )
    .map(([key, value]) => (key === "q" ? String(value) : `${key} ${value}`))
  return parts.join(" · ")
}

function Chip({ run, title }: { run: ToolRun; title: string }) {
  const detail = summarise(run.input)
  return (
    <div
      className="flex min-h-6 items-center gap-2"
      style={{ animation: "assistant-rise 260ms var(--ease-out) both" }}
    >
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          run.ok === undefined && "bg-mute",
          run.ok === true && "bg-ok",
          run.ok === false && "bg-bad"
        )}
      />
      <span className="shrink-0 text-meta text-ink">{title}</span>
      {detail && (
        <span className="min-w-0 truncate rounded-inner bg-soft px-1.5 py-px font-mono text-id text-body">
          {detail}
        </span>
      )}
    </div>
  )
}

export function Trace({ exchange }: { exchange: Exchange }) {
  const titleOf = useToolTitle()
  const [manual, setManual] = useState<boolean | null>(null)
  const working = exchange.streaming
  // Open while it runs, closed once there is an answer to read — unless
  // somebody has said otherwise, and then it stays where they put it.
  const expanded = manual ?? working

  if (exchange.runs.length === 0 && !exchange.thinking && !working) {
    return null
  }

  const label = working
    ? exchange.runs.length > 0
      ? `Reading ${titleOf(exchange.runs[exchange.runs.length - 1].name).toLowerCase()}…`
      : "Thinking…"
    : exchange.runs.length === 0
      ? "Answered without a read"
      : `Read ${exchange.runs.length} ${exchange.runs.length === 1 ? "source" : "sources"}`

  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setManual(!expanded)}
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-inner px-1.5 py-1 transition-colors hover:bg-soft-2"
      >
        <Sparkles
          className={cn("size-3.5", working ? "text-accent" : "text-mute")}
        />
        {working ? (
          // The sweep is the label itself, clipped to the glyphs — a spinner
          // beside the words would be a second thing saying the same thing.
          <span
            className="bg-clip-text text-meta font-medium text-transparent"
            style={{
              backgroundImage:
                "linear-gradient(90deg, var(--mute) 35%, var(--ink) 50%, var(--mute) 65%)",
              backgroundSize: "200% 100%",
              animation: "assistant-shimmer 1.4s linear infinite",
            }}
          >
            {label}
          </span>
        ) : (
          <span className="text-meta font-medium text-body">{label}</span>
        )}
        <ChevronDown
          className={cn(
            "size-3.5 text-line-ico transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-300"
        style={{
          gridTemplateRows: expanded ? "1fr" : "0fr",
          opacity: expanded ? 1 : 0,
          transitionTimingFunction: "var(--ease-out)",
        }}
      >
        <div className="overflow-hidden">
          <div className="mt-1 ml-[0.4375rem] flex flex-col gap-1 border-l border-hairline-2 py-1 pl-3">
            {exchange.thinking && (
              <p className="mb-1 text-meta leading-relaxed whitespace-pre-wrap text-body">
                {exchange.thinking}
              </p>
            )}
            {exchange.runs.map((run) => (
              <Chip key={run.id} run={run} title={titleOf(run.name)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
