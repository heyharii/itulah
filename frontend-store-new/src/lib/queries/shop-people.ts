import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"

import { hrKeys, teamAt, useCloudIdentity, useReach } from "@/lib/queries/hr"
import { useIdentity, useNodeIdentity } from "@/lib/session"

/// Who works at this shop, as a list to choose from and a way to turn a login
/// into a name.
///
/// The money screens record who did a thing by LOGIN — `claimed_by`,
/// `counted_by` — and the owner's rule is that a person is always shown by their
/// full name. The team list is head office's, read through the relay under the
/// same key the People screens use, so a shop that has opened one of them has
/// already paid for this.
///
/// It is a convenience, never a condition: a session the relay will not serve
/// (a local break-glass login) leaves `ready` false, `people` holds only the
/// person signed in, and a login the list does not know is shown as it is.

export interface ShopPerson {
  /// The login when there is one, else the employee id — what a `<Select>`
  /// holds. Never shown.
  readonly key: string
  readonly name: string
  readonly login: string | null
  readonly position: string | null
}

export interface ShopPeople {
  /// Active staff, the person signed in first.
  readonly people: readonly ShopPerson[]
  /// The person signed in, by name — even when the list could not be read.
  readonly me: ShopPerson | null
  /// A record's login as a full name; the login itself when nobody has it.
  readonly nameOf: (login: string | null | undefined) => string
  /// Whether head office's list arrived.
  readonly ready: boolean
}

export function useShopPeople(): ShopPeople {
  const identity = useIdentity()
  const where = useNodeIdentity()
  const session = useCloudIdentity()
  const reach = useReach(
    (where.data?.site_id ?? null) !== null && session.data !== null,
  )
  const unit = reach.data?.scope === "ONE_UNIT" ? reach.data.unit_id : null
  const team = useQuery({
    queryKey: hrKeys.team(unit ?? ""),
    queryFn: ({ signal }) => teamAt(unit ?? "", signal),
    enabled: unit !== null,
  })

  const login = identity.data?.username ?? null
  const display = identity.data?.display_name ?? null

  return useMemo(() => {
    const rows = team.data?.rows ?? []
    const named = new Map<string, ShopPerson>()
    for (const row of rows) {
      if (row.status !== "ACTIVE") continue
      const name = row.full_name ?? row.employee_code
      const person: ShopPerson = {
        key: row.username ?? row.employee_id,
        name,
        login: row.username,
        position: row.position,
      }
      named.set(person.key, person)
    }
    const known =
      login === null ? undefined : rows.find((row) => row.username === login)
    const me: ShopPerson | null =
      login === null
        ? null
        : {
            key: login,
            name: known?.full_name ?? display ?? login,
            login,
            position: known?.position ?? null,
          }
    const people = [
      ...(me === null ? [] : [me]),
      ...[...named.values()].filter((person) => person.login !== login),
    ]
    const nameOf = (who: string | null | undefined) => {
      if (who === null || who === undefined || who === "") return "—"
      if (who === login) return me?.name ?? who
      return rows.find((row) => row.username === who)?.full_name ?? who
    }
    return { people, me, nameOf, ready: team.data !== undefined }
  }, [team.data, login, display])
}
