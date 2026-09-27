import { Trash2 } from "lucide-react"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { EmptyState, Problem } from "@/components/ui/states"
import {
  useGlossary,
  useRemoveGlossaryEntry,
  useSaveGlossaryEntry,
  type GlossaryEntry,
} from "@/lib/queries/assistant"
import { queryState } from "@/lib/query-state"
import { useIdentity } from "@/lib/session"
import { Grid, Td, Th } from "@/screens/finance-final/parts"

/// The words this business uses, and what they mean here.
///
/// Every entry is put in front of the assistant's model with every question
/// (`cloud/http/assistant.rs`, migration 0501), so "omzet" and "C003" are read
/// the way the people asking mean them. A smaller model gains the most from
/// this: it knows retail, not this retailer.
///
/// Readable by everybody signed in — somebody wondering why an answer read a
/// word the way it did should be able to see why — and kept by head office,
/// whose writes the node alone decides (`role_permission`).
export function AssistantGlossary() {
  const list = useGlossary()
  const identity = useIdentity()
  const keeper = identity.data?.role === "ADMIN"

  return (
    <PageContent>
      <PageHeader
        crumb="Assistant · Glossary"
        title="Glossary"
        sub="The business's own words and what they mean here. The assistant reads every question with these meanings."
      />
      {keeper && <NewEntry />}
      <Card className="overflow-hidden">
        {queryState(list, {
          loading: "Reading the glossary…",
          render: (entries) =>
            entries.length === 0 ? (
              <EmptyState>
                No words yet. Start with the ones an outsider would read
                wrongly: shop codes, omzet, kodi.
              </EmptyState>
            ) : (
              <Grid>
                <thead>
                  <tr>
                    <Th width="14rem">Word</Th>
                    <Th>What it means here</Th>
                    {keeper && <Th width="11rem" />}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} keeper={keeper} />
                  ))}
                </tbody>
              </Grid>
            ),
        })}
      </Card>
    </PageContent>
  )
}

/// A new word, above the list it joins.
function NewEntry() {
  const save = useSaveGlossaryEntry()
  const [term, setTerm] = useState("")
  const [meaning, setMeaning] = useState("")
  const ready = term.trim() !== "" && meaning.trim() !== ""

  const add = () => {
    if (!ready) return
    save.mutate(
      { term: term.trim(), meaning: meaning.trim() },
      {
        onSuccess: () => {
          setTerm("")
          setMeaning("")
        },
      }
    )
  }

  return (
    <Card className="mb-4 p-4">
      <div className="flex flex-wrap items-start gap-2">
        <Input
          value={term}
          maxLength={80}
          placeholder="Word, e.g. C003"
          aria-label="Word"
          className="h-control w-44"
          onChange={(event) => setTerm(event.target.value)}
        />
        <Input
          value={meaning}
          maxLength={400}
          placeholder="What it means here, e.g. the Purbalingga shop"
          aria-label="What it means here"
          className="h-control min-w-0 flex-1"
          onChange={(event) => setMeaning(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") add()
          }}
        />
        <Button
          variant={ready ? "primary" : "quiet"}
          disabled={!ready}
          pending={save.isPending}
          onClick={add}
        >
          {save.isPending ? "Adding…" : "Add"}
        </Button>
      </div>
      <Problem error={save.error} className="mt-1.5" />
    </Card>
  )
}

/// One word: read as a row, edited in place by head office.
function EntryRow({
  entry,
  keeper,
}: {
  entry: GlossaryEntry
  keeper: boolean
}) {
  const save = useSaveGlossaryEntry()
  const remove = useRemoveGlossaryEntry()
  const [editing, setEditing] = useState(false)
  const [term, setTerm] = useState(entry.term)
  const [meaning, setMeaning] = useState(entry.meaning)

  if (editing) {
    const changed =
      term.trim() !== "" &&
      meaning.trim() !== "" &&
      (term.trim() !== entry.term || meaning.trim() !== entry.meaning)
    return (
      <tr>
        <Td>
          <Input
            value={term}
            maxLength={80}
            aria-label="Word"
            className="h-8"
            onChange={(event) => setTerm(event.target.value)}
          />
        </Td>
        <Td>
          <Input
            value={meaning}
            maxLength={400}
            aria-label="What it means here"
            className="h-8"
            onChange={(event) => setMeaning(event.target.value)}
          />
          <Problem error={save.error} className="mt-1.5" />
        </Td>
        <Td align="right">
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant={changed ? "primary" : "quiet"}
              disabled={!changed}
              pending={save.isPending}
              onClick={() =>
                save.mutate(
                  { id: entry.id, term: term.trim(), meaning: meaning.trim() },
                  { onSuccess: () => setEditing(false) }
                )
              }
            >
              {save.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </Td>
      </tr>
    )
  }

  return (
    <tr>
      <Td>
        <span className="font-medium text-ink">{entry.term}</span>
      </Td>
      <Td>
        <span className="text-body">{entry.meaning}</span>
        <Problem error={remove.error} className="mt-1.5" />
      </Td>
      {keeper && (
        <Td align="right">
          <div className="flex justify-end gap-1">
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                // From what the row says now, not from when it first drew.
                setTerm(entry.term)
                setMeaning(entry.meaning)
                setEditing(true)
              }}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="quiet"
              aria-label={`Remove ${entry.term}`}
              title="Remove"
              pending={remove.isPending}
              onClick={() => remove.mutate(entry.id)}
            >
              <Trash2 />
            </Button>
          </div>
        </Td>
      )}
    </tr>
  )
}
