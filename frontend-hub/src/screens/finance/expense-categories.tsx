import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"

import { PageContent } from "@/components/shell/app-shell"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox, Field, Input } from "@/components/ui/field"
import { PageHeader } from "@/components/ui/page-header"
import { Pill } from "@/components/ui/pill"
import { Toolbar } from "@/components/ui/segmented"
import { EmptyState, Problem } from "@/components/ui/states"
import { count } from "@/lib/format"
import { financeKeys, saveExpenseCategory } from "@/lib/queries/finance"
import { queryState } from "@/lib/query-state"
import { Code, Grid, Td, Th } from "@/screens/finance-final/parts"
import { useExpenseCategories } from "@/screens/finance/master-data"
import {
  EditorCard,
  LinkAccountsButton,
  MasterLayout,
  Reach,
  YesNo,
} from "@/screens/finance/master-parts"
import type { ExpenseCategory } from "@itulah/contract"

/// The kinds of cost a shop or an employee files under (ERPNext Expense
/// Claim Type, and a store's petty-cash heads).
///
/// A category is a name and two doors — shops, claims — and nothing else. Where
/// its cost lands is an account link (role `expense`, source the category), so
/// the account is set on Account links, per scope, like every other decision
/// about where money goes. A category with no link is refused at posting, by
/// name, which is why the reach column is the one to watch.
export function ExpenseCategories() {
  const list = useExpenseCategories()
  const [editing, setEditing] = useState<ExpenseCategory | "new" | null>(null)
  const [needle, setNeedle] = useState("")
  const [inactive, setInactive] = useState(false)

  const rows = useMemo(() => {
    const text = needle.trim().toLowerCase()
    return (list.data ?? []).filter(
      (row) =>
        (inactive || row.is_active) &&
        (text === "" ||
          row.code.toLowerCase().includes(text) ||
          row.name.toLowerCase().includes(text))
    )
  }, [list.data, needle, inactive])

  const unlinked = (list.data ?? []).filter(
    (row) => row.is_active && row.linked_sites === 0
  ).length

  return (
    <PageContent>
      <PageHeader
        crumb="Finance · Setup"
        title="Expense categories"
        sub="What a shop's expense or an employee's claim is filed under. The account each lands on is an account link."
        actions={
          <>
            <Input
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder="Search"
              className="h-8 w-48"
            />
            <Button variant="primary" onClick={() => setEditing("new")}>
              New category
            </Button>
          </>
        }
      />

      <Toolbar>
        <Checkbox
          label="Show inactive"
          checked={inactive}
          onChange={setInactive}
        />
        <Toolbar.Spacer />
        <span className="text-[0.875rem] text-mute">
          {count(rows.length)} categories
          {unlinked > 0 && ` · ${count(unlinked)} with no account yet`}
        </span>
      </Toolbar>

      <MasterLayout
        list={
          <Card className="overflow-hidden">
            {queryState(list, {
              loading: "Reading the categories…",
              render: () =>
                rows.length === 0 ? (
                  <EmptyState>
                    {needle.trim() === ""
                      ? "No expense category yet. Nothing can be filed by a shop or claimed by an employee until one exists."
                      : "No category matches the search."}
                  </EmptyState>
                ) : (
                  <Grid>
                    <thead>
                      <tr>
                        <Th>Code</Th>
                        <Th>Name</Th>
                        <Th align="center">Shops</Th>
                        <Th align="center">Claims</Th>
                        <Th>Account</Th>
                        <Th />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr
                          key={row.code}
                          onClick={() => setEditing(row)}
                          className="cursor-pointer hover:bg-soft"
                        >
                          <Td>
                            <Code>{row.code}</Code>
                          </Td>
                          <Td>
                            <span className="text-ink">{row.name}</span>
                            {!row.is_active && (
                              <Pill tone="neutral" className="ml-2">
                                Inactive
                              </Pill>
                            )}
                            {row.note && (
                              <div className="text-mute">{row.note}</div>
                            )}
                          </Td>
                          <Td align="center">
                            <YesNo on={row.for_stores} />
                          </Td>
                          <Td align="center">
                            <YesNo on={row.for_claims} />
                          </Td>
                          <Td>
                            <Reach sites={row.linked_sites} />
                          </Td>
                          <Td align="right">
                            <LinkAccountsButton
                              role="expense"
                              sourceType="EXPENSE_CATEGORY"
                              sourceId={row.code}
                            />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Grid>
                ),
            })}
          </Card>
        }
        editor={
          editing !== null && (
            <CategoryForm
              key={editing === "new" ? "new" : editing.code}
              category={editing === "new" ? null : editing}
              onDone={() => setEditing(null)}
            />
          )
        }
      />
    </PageContent>
  )
}

function CategoryForm({
  category,
  onDone,
}: {
  category: ExpenseCategory | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const [code, setCode] = useState(category?.code ?? "")
  const [name, setName] = useState(category?.name ?? "")
  const [forStores, setForStores] = useState(category?.for_stores ?? true)
  const [forClaims, setForClaims] = useState(category?.for_claims ?? false)
  const [active, setActive] = useState(category?.is_active ?? true)
  const [note, setNote] = useState(category?.note ?? "")

  const save = useMutation({
    mutationFn: () =>
      saveExpenseCategory({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        for_stores: forStores,
        for_claims: forClaims,
        is_active: active,
        note: note.trim() === "" ? null : note.trim(),
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: financeKeys.expenseCategories(),
      })
      onDone()
    },
  })

  return (
    <EditorCard
      title={category === null ? "New category" : `Edit ${category.code}`}
      onClose={onDone}
    >
      <Problem error={save.error} />
      <Field
        label="Code"
        required
        aside={category === null ? "Never changes" : undefined}
      >
        <Input
          value={code}
          disabled={category !== null}
          onChange={(event) => setCode(event.target.value)}
          placeholder="ELECTRICITY"
        />
      </Field>
      <Field label="Name" required>
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Biaya listrik"
        />
      </Field>
      <Checkbox
        label="Shops can file under it"
        checked={forStores}
        onChange={setForStores}
      />
      <Checkbox
        label="Employees can claim under it"
        hint="A claim type in HR is filed under a category that allows claims."
        checked={forClaims}
        onChange={setForClaims}
      />
      <Checkbox label="Active" checked={active} onChange={setActive} />
      <Field label="Note">
        <Input value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <div className="flex items-center justify-end gap-2">
        {category !== null && (
          <LinkAccountsButton
            role="expense"
            sourceType="EXPENSE_CATEGORY"
            sourceId={category.code}
          />
        )}
        <Button
          variant="primary"
          pending={save.isPending}
          disabled={code.trim() === "" || name.trim() === ""}
          onClick={() => save.mutate()}
        >
          {save.isPending ? "Saving…" : "Save category"}
        </Button>
      </div>
    </EditorCard>
  )
}
