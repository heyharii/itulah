import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import type {
  SupplierBankAccount,
  SupplierContact,
  UpdateSupplierBankAccountRequest,
  UpdateSupplierContactRequest,
} from "@itulah/contract"

import { Button } from "@/components/ui/button"
import { Field, Input } from "@/components/ui/field"
import { Pill } from "@/components/ui/pill"
import { MiniTable } from "@/components/ui/rows"
import { Banner } from "@/components/ui/states"
import {
  createSupplierBankAccount,
  createSupplierContact,
  procurementKeys,
  supplierBankAccounts,
  supplierContacts,
  updateSupplierBankAccount,
  updateSupplierContact,
} from "@/lib/queries/procurement"
import { useIdempotencyKey } from "@/screens/procurement/shared"
import { queryState } from "@/lib/query-state"
import { cn } from "@/lib/utils"

/// The two panels a supplier's master carries on both screens that read it:
/// Buying's Suppliers and GA's Vendors. One record (0212), so one panel per
/// face of it — copied never, or the day one half learns the other's fix is
/// the day the fix is lost.
///
/// Both writes carry the row's `version` as `If-Match` and an idempotency
/// key, exactly as their endpoints ask: two people looking at the same stale
/// row cannot both write, and a double-click writes once.

/// Where a supplier's money lands.
///
/// Three facts fill in a bilyet giro — the bank, the number, and the name the
/// account is registered under — and the third is the one everybody assumes.
/// It is regularly not the trading name on the invoice: PT and CV forms, a
/// personal account for a small maker, an old name after a merger. A giro made
/// out to a name the bank does not recognise comes back.
///
/// Retired accounts are shown rather than filtered out. An account that paid a
/// giro last March is part of what that giro said, and a retirement nobody can
/// find is a retirement nobody can undo — the rule every master here follows.
///
/// Verification is SHOWN and never SET here, whichever screen mounts this
/// panel: a new number arrives `UNVERIFIED`, and the check that clears it is
/// Finance's act on the payment it is about to fund (0308). A master that
/// could verify its own account would be the fraud control signing itself
/// off.
export function SupplierBankAccountsPanel({
  supplierId,
}: {
  supplierId: string
}) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  // Whether the panel is open, not what is in it: a disclosure, so `useState`.
  const [adding, setAdding] = useState(false)

  const accounts = useQuery({
    queryKey: procurementKeys.supplierBankAccounts(supplierId),
    queryFn: ({ signal }) => supplierBankAccounts(supplierId, true, signal),
  })

  const settled = () => {
    void client.invalidateQueries({
      queryKey: procurementKeys.supplierBankAccounts(supplierId),
    })
    idempotency.rotate()
  }

  const add = useMutation({
    mutationFn: (draft: {
      bank: string
      number: string
      holder: string
      branch: string
    }) =>
      createSupplierBankAccount(
        supplierId,
        {
          bank_name: draft.bank.trim(),
          account_no: draft.number.trim(),
          account_holder: draft.holder.trim(),
          branch: blank(draft.branch),
        },
        idempotency.key
      ),
    onSuccess: () => {
      settled()
      setAdding(false)
      form.reset()
    },
  })

  /// Making one the default, retiring one and bringing one back are the same
  /// PATCH with a different field, so they are one mutation — and each carries
  /// the row's own version as its `If-Match`, exactly as the supplier does.
  const change = useMutation({
    mutationFn: ({
      account,
      patch,
    }: {
      account: SupplierBankAccount
      patch: UpdateSupplierBankAccountRequest
    }) =>
      updateSupplierBankAccount(
        supplierId,
        account.account_id,
        patch,
        account.version,
        idempotency.key
      ),
    onSuccess: settled,
  })

  const form = useForm({
    defaultValues: { bank: "", number: "", holder: "", branch: "" },
    onSubmit: ({ value }) => add.mutate(value),
  })

  const busy = add.isPending || change.isPending

  return (
    <div className="flex flex-col gap-3.5">
      {add.isError && <Banner tone="bad">{(add.error as Error).message}</Banner>}
      {change.isError && (
        <Banner tone="bad">{(change.error as Error).message}</Banner>
      )}

      {queryState(accounts, {
        loading: "Reading the accounts…",
        render: (rows) =>
          rows.length === 0 ? (
            <p className="text-meta text-mute">
              No account on file, so a giro to this supplier cannot be written.
            </p>
          ) : (
            <MiniTable head={["Account", "Registered to", ""]}>
              {rows.map((account) => (
                <tr
                  key={account.account_id}
                  className="border-t border-hairline"
                >
                  <td
                    className={cn("py-2 pr-2", account.retired && "text-mute")}
                  >
                    {account.bank_name}
                    {account.is_default && !account.retired && (
                      <Pill tone="ok" className="ml-2">
                        Default
                      </Pill>
                    )}
                    {account.retired && (
                      <Pill tone="neutral" className="ml-2">
                        Cancelled
                      </Pill>
                    )}
                    {account.verification_status !== null && (
                      <Pill
                        tone={VERIFICATION_TONE[account.verification_status]}
                        className="ml-2"
                      >
                        {VERIFICATION_LABEL[account.verification_status]}
                      </Pill>
                    )}
                    <span className="block font-mono text-[0.875rem] text-mute">
                      {account.account_no}
                      {account.branch !== null && ` · ${account.branch}`}
                    </span>
                  </td>
                  <td
                    className={cn("py-2 pr-2", account.retired && "text-mute")}
                  >
                    {account.account_holder}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {!account.retired && !account.is_default && (
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          change.mutate({
                            account,
                            patch: { is_default: true },
                          })
                        }
                      >
                        Make default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy}
                      onClick={() =>
                        change.mutate({
                          account,
                          patch: { retired: !account.retired },
                        })
                      }
                    >
                      {account.retired ? "Restore" : "Cancel"}
                    </Button>
                  </td>
                </tr>
              ))}
            </MiniTable>
          ),
      })}

      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            form.handleSubmit()
          }}
          className="flex flex-col gap-3 rounded-inner border border-hairline p-3.5"
        >
          <form.Field name="bank">
            {(field) => (
              <Field label="Bank" hint="As it will be printed — “Bank BCA”.">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="number">
            {(field) => (
              <Field
                label="Account number"
                hint="Group it the way the passbook does; the dashes are kept."
              >
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="holder">
            {(field) => (
              <Field
                label="Registered to"
                hint="The name the bank has, which is not always the supplier's."
              >
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <form.Field name="branch">
            {(field) => (
              <Field label="Branch" hint="Optional. Some banks want it.">
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                />
              </Field>
            )}
          </form.Field>
          <div className="flex gap-2">
            <form.Subscribe
              selector={(state) =>
                state.values.bank.trim() !== "" &&
                // Five digits is the server's floor, checked here so the
                // button says no before the request does.
                state.values.number.replace(/\D/g, "").length >= 5 &&
                state.values.holder.trim() !== ""
              }
            >
              {(ready) => (
                <Button
                  type="submit"
                  variant="soft"
                  className="flex-1"
                  pending={add.isPending}
                  disabled={!ready}
                >
                  {add.isPending ? "Adding…" : "Add it"}
                </Button>
              )}
            </form.Subscribe>
            <Button variant="quiet" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => setAdding(true)}>Add an account</Button>
      )}
    </div>
  )
}

/// The wire's three states and the word each wears. Absent means the column
/// predates the row — read as unverified, which is what it means.
const VERIFICATION_LABEL: Record<string, string> = {
  UNVERIFIED: "Unverified",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
}

const VERIFICATION_TONE: Record<string, "ok" | "warn" | "bad"> = {
  UNVERIFIED: "warn",
  VERIFIED: "ok",
  REJECTED: "bad",
}

/// The people at a supplier, and the ways to reach them.
///
/// The row is the fact "ask THIS person about THAT supplier": a name, what
/// they are for, and at least one of a phone or an email. Primary is a pick,
/// not a property — at most one per supplier among the live contacts — and
/// retired contacts stay readable, because the person who signed the delivery
/// last March is part of what that delivery said.
export function SupplierContactsPanel({ supplierId }: { supplierId: string }) {
  const client = useQueryClient()
  const idempotency = useIdempotencyKey()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ name: "", role: "", phone: "", email: "" })

  const contacts = useQuery({
    queryKey: procurementKeys.supplierContacts(supplierId),
    queryFn: ({ signal }) => supplierContacts(supplierId, true, signal),
  })

  const settled = () => {
    void client.invalidateQueries({
      queryKey: procurementKeys.supplierContacts(supplierId),
    })
    idempotency.rotate()
  }

  const add = useMutation({
    mutationFn: () =>
      createSupplierContact(
        supplierId,
        {
          name: draft.name.trim(),
          role: blank(draft.role),
          phone: blank(draft.phone),
          email: blank(draft.email),
        },
        idempotency.key
      ),
    onSuccess: () => {
      settled()
      setAdding(false)
      setDraft({ name: "", role: "", phone: "", email: "" })
    },
  })

  const change = useMutation({
    mutationFn: ({
      contact,
      patch,
    }: {
      contact: SupplierContact
      patch: UpdateSupplierContactRequest
    }) =>
      updateSupplierContact(
        supplierId,
        contact.contact_id,
        patch,
        contact.version,
        idempotency.key
      ),
    onSuccess: settled,
  })

  const busy = add.isPending || change.isPending
  const ready =
    draft.name.trim() !== "" &&
    (draft.phone.trim() !== "" || draft.email.trim() !== "")

  return (
    <div className="flex flex-col gap-3.5">
      {add.isError && (
        <Banner tone="bad">{(add.error as Error).message}</Banner>
      )}
      {change.isError && (
        <Banner tone="bad">{(change.error as Error).message}</Banner>
      )}

      {queryState(contacts, {
        loading: "Reading the contacts…",
        render: (rows) =>
          rows.length === 0 ? (
            <p className="text-meta text-mute">
              Nobody is on file here, so every call starts with the switchboard.
            </p>
          ) : (
            <MiniTable head={["Contact", "Reaches", ""]}>
              {rows.map((contact) => (
                <tr key={contact.contact_id} className="border-t border-hairline">
                  <td className={cn("py-2 pr-2", contact.retired && "text-mute")}>
                    {contact.name}
                    {contact.is_primary && !contact.retired && (
                      <Pill tone="ok" className="ml-2">
                        Primary
                      </Pill>
                    )}
                    {contact.retired && (
                      <Pill tone="neutral" className="ml-2">
                        Cancelled
                      </Pill>
                    )}
                    {contact.role !== null && (
                      <span className="block text-[0.875rem] text-mute">
                        {contact.role}
                      </span>
                    )}
                  </td>
                  <td className={cn("py-2 pr-2", contact.retired && "text-mute")}>
                    {contact.phone ?? "—"}
                    {contact.email !== null && (
                      <span className="block font-mono text-[0.875rem] text-mute">
                        {contact.email}
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right whitespace-nowrap">
                    {!contact.retired && !contact.is_primary && (
                      <Button
                        size="sm"
                        variant="quiet"
                        disabled={busy}
                        onClick={() =>
                          change.mutate({
                            contact,
                            patch: { is_primary: true },
                          })
                        }
                      >
                        Make primary
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="quiet"
                      disabled={busy}
                      onClick={() =>
                        change.mutate({
                          contact,
                          patch: { retired: !contact.retired },
                        })
                      }
                    >
                      {contact.retired ? "Restore" : "Cancel"}
                    </Button>
                  </td>
                </tr>
              ))}
            </MiniTable>
          ),
      })}

      {adding ? (
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) add.mutate()
          }}
          className="flex flex-col gap-3 rounded-inner border border-hairline p-3.5"
        >
          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
            />
          </Field>
          <Field label="Role" hint="Optional — “Sales”, “Admin”, “Gudang”.">
            <Input
              value={draft.role}
              onChange={(event) =>
                setDraft((current) => ({ ...current, role: event.target.value }))
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Phone">
              <Input
                value={draft.phone}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    phone: event.target.value,
                  }))
                }
              />
            </Field>
            <Field label="Email">
              <Input
                value={draft.email}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    email: event.target.value,
                  }))
                }
              />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button
              type="submit"
              variant="soft"
              className="flex-1"
              pending={add.isPending}
              disabled={!ready}
            >
              {add.isPending ? "Adding…" : "Add them"}
            </Button>
            <Button variant="quiet" onClick={() => setAdding(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : (
        <Button onClick={() => setAdding(true)}>Add a contact</Button>
      )}
    </div>
  )
}

/// An empty box means "nothing", and the endpoint spells nothing `null`.
function blank(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === "" ? null : trimmed
}
