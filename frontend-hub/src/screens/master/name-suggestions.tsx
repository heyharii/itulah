import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { ConfirmButton } from "@/components/ui/dialog"
import { Input } from "@/components/ui/field"
import { Switch } from "@/components/ui/form"
import { PageHeader } from "@/components/ui/page-header"
import { Banner, EmptyState } from "@/components/ui/states"
import { problemOf } from "@/lib/problem"
import { queryState } from "@/lib/query-state"
import {
  createNameSuggestion,
  deleteNameSuggestion,
  listNameSuggestions,
  nameSuggestionKeys,
  updateNameSuggestion,
  type NameSuggestion,
} from "@/lib/queries/name-suggestions"

/// **Name suggestions** — the names the Name box of New articles offers as it
/// is typed ("Kemeja", "Kaos", "Celana"). A master of its own, kept here
/// (owner, 2026-10-05), and not the articles that already exist. The box stays
/// free text; a suggestion is only a shortcut. Nothing points at a row, so a
/// name can be added, retired or deleted at any time.
export function NameSuggestions() {
  const client = useQueryClient()
  const [typed, setTyped] = useState("")
  const book = useQuery({
    queryKey: nameSuggestionKeys.master(),
    queryFn: ({ signal }) => listNameSuggestions(signal),
  })
  const changed = () =>
    client.invalidateQueries({ queryKey: nameSuggestionKeys.all })
  const add = useMutation({
    mutationFn: (name: string) => createNameSuggestion(name),
    onSuccess: () => {
      setTyped("")
      void changed()
    },
  })
  const toggle = useMutation({
    mutationFn: (row: NameSuggestion) =>
      updateNameSuggestion(row.suggestion_id, { active: !row.active }),
    onSuccess: () => void changed(),
  })
  const remove = useMutation({
    mutationFn: (row: NameSuggestion) =>
      deleteNameSuggestion(row.suggestion_id),
    onSuccess: () => void changed(),
  })

  const submit = () => {
    if (typed.trim() === "" || add.isPending) return
    add.mutate(typed)
  }
  const refused = add.error ?? toggle.error ?? remove.error

  return (
    <PageContent>
      <PageHeader title="Name Suggestions" small />
      <form
        className="mb-4 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <Input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Add a name"
          aria-label="Add a name"
          className="h-11 max-w-sm"
        />
        <Button
          variant="primary"
          type="submit"
          pending={add.isPending}
          disabled={typed.trim() === ""}
        >
          Add
        </Button>
      </form>
      {refused && <Banner tone="bad">{problemOf(refused)}</Banner>}
      {queryState(book, {
        loading: "Reading the names…",
        render: (rows) =>
          rows.length === 0 ? (
            <EmptyState>
              No names yet. Add the ones New articles should suggest.
            </EmptyState>
          ) : (
            <Card className="overflow-hidden">
              <ul>
                {rows.map((row) => (
                  <li
                    key={row.suggestion_id}
                    className="flex min-h-14 items-center gap-4 border-b border-hairline px-4 last:border-b-0"
                  >
                    <span
                      className={
                        row.active
                          ? "min-w-0 flex-1 truncate text-ink"
                          : "min-w-0 flex-1 truncate text-mute"
                      }
                    >
                      {row.name}
                    </span>
                    <span className="flex items-center gap-2 text-body">
                      Active
                      <Switch
                        on={row.active}
                        busy={toggle.isPending && toggle.variables === row}
                        label={`${row.name} is offered`}
                        onToggle={() => toggle.mutate(row)}
                      />
                    </span>
                    <ConfirmButton
                      label="Delete"
                      variant="quiet"
                      tone="danger"
                      title={`Delete ${row.name}?`}
                      description="It stops being suggested. No article is touched."
                      confirmLabel="Delete"
                      pending={remove.isPending && remove.variables === row}
                      onConfirm={() => remove.mutateAsync(row)}
                    />
                  </li>
                ))}
              </ul>
            </Card>
          ),
      })}
    </PageContent>
  )
}
