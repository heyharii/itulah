/// What each SKU is called and what it is, for the lines of a list: its
/// photograph, division, tags, colour and size.
///
/// The store's book carries no colour or size field, but every name is the
/// article, then the colour, then the size — the rule `till.tsx` reads Warna and
/// Ukuran with. Here the same rule splits a name into what the line says first
/// ("Andeska STL Koko TPJ") and what it says under it ("Navy · 10/12").
///
/// The price book is read once, as the till reads it. A garment with no price
/// is not in it — a delivery can carry such a garment — so a SKU the book does
/// not name is asked of the node's identity table, which holds every SKU.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import * as api from "@/api"
import { divisionName } from "@/division"

/// One SKU as a list draws it.
export type Item = {
  /// The article, without its colour and size when they could be told apart.
  readonly name: string
  /// "Navy"; empty when the name did not split.
  readonly colour: string
  /// "10/12"; empty when the name did not split.
  readonly size: string
  /// "Pria · BORDIR, KOKO": the division and the tags, under the name.
  readonly sub: string
  /// The node holds a photograph for it.
  readonly photo: boolean
  /// The article's code and this SKU's barcode, for the card.
  readonly article: string | null
  readonly barcode: string | null
  /// The division and tags on their own, for the card.
  readonly division: string
  readonly tags: readonly string[]
}

/// What the book and the identity table say of a SKU beside its name.
type Facts = {
  readonly name: string
  readonly division: string | null
  readonly tags: readonly string[]
  readonly photo: boolean
  readonly article: string | null
  readonly barcode: string | null
}

/// The node's own ceiling on one identity read (`catalog_identities`).
const IDENTITY_PAGE = 500

/// Colour and size out of a name's tail, once `shared` words of its front are
/// known to be the article's.
function shape(words: readonly string[], shared: number): { name: string; colour: string; size: string } {
  const rest = words.slice(shared)
  let size = ""
  const tail = rest.slice(-2).join(" ").toUpperCase()
  if (/^(ALL|FREE) SIZE$/.test(tail) || /^(EU|UK|US) \d{1,2}([.,]5)?$/.test(tail)) {
    size = rest.splice(-2).join(" ")
  } else if (rest.length > 0 && /^(XXXL|XXL|XL|L|M|S|XS|\d{1,2}([/-]\d{1,2})?)$/i.test(rest[rest.length - 1] ?? "")) {
    size = rest.splice(-1).join(" ")
  }
  // Every SKU of the article the same colour ("… Lengan Panjang NAVY M",
  // "… NAVY L"): the colour is in the shared part, the capitals at its end
  // after the article's own mixed-case words.
  let front = words.slice(0, shared)
  if (rest.length === 0 && size !== "") {
    let at = front.length
    while (at > 0 && /^[A-Z][A-Z-]+$/.test(front[at - 1] ?? "")) at -= 1
    if (at > 0 && at < front.length && /[a-z]/.test(front.slice(0, at).join(" "))) {
      rest.push(...front.slice(at))
      front = front.slice(0, at)
    }
  }
  const colour = rest.join(" ")
  const name = front.join(" ")
  // A name that did not split reads whole, with nothing under it.
  return name === "" || (colour === "" && size === "")
    ? { name: words.join(" "), colour: "", size: "" }
    : { name, colour, size }
}

/// Every known SKU, shaped. The article part is what an article's SKUs share
/// (`till.tsx`, `variants`).
function build(facts: ReadonlyMap<string, Facts>): ReadonlyMap<string, Item> {
  const names = new Map([...facts].map(([sku, one]) => [sku, one.name] as const))
  const byArticle = new Map<string, string[][]>()
  for (const [sku, name] of names) {
    const article = sku.slice(0, 8)
    byArticle.set(article, [...(byArticle.get(article) ?? []), name.trim().split(/\s+/)])
  }
  const out = new Map<string, Item>()
  for (const [sku, name] of names) {
    const words = name.trim().split(/\s+/)
    const siblings = (byArticle.get(sku.slice(0, 8)) ?? []).filter((other) => other.join(" ") !== words.join(" "))
    let shared = siblings.length === 0 ? Math.max(0, words.length - 3) : words.length
    for (const other of siblings) {
      let at = 0
      while (at < words.length && at < other.length && words[at] === other[at]) at += 1
      shared = Math.min(shared, at)
    }
    const one = facts.get(sku)
    const sub = [one?.division ? divisionName(one.division) : "", (one?.tags ?? []).join(", ")]
      .filter((part) => part !== "")
      .join(" · ")
    out.set(sku, {
      ...shape(words, shared),
      sub,
      photo: one?.photo === true,
      article: one?.article ?? null,
      barcode: one?.barcode ?? null,
      division: one?.division ? divisionName(one.division) : "",
      tags: one?.tags ?? [],
    })
  }
  return out
}

export type Book = {
  readonly items: ReadonlyMap<string, Item>
  /// Learn the names of SKUs the book lacks; resolves once the node has
  /// answered. A SKU the node does not know stays unknown (`knows` is false).
  readonly learn: (skus: readonly string[]) => Promise<void>
  /// Whether a name is known for the SKU now.
  readonly knows: (sku: string) => boolean
}

export function useBook(): Book {
  const names = useRef(new Map<string, Facts>())
  // SKUs the identity table has already been asked about, so an unknown code
  // is asked once and not on every poll.
  const asked = useRef(new Set<string>())
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let alive = true
    void api.takeCatalogue().then((book) => {
      if (!alive || !book.ok) return
      for (const row of book.rows) {
        names.current.set(row.sku_code, {
          name: row.name,
          division: row.division_code ?? null,
          tags: row.tags ?? [],
          photo: row.has_image === true,
          article: row.article_code ?? null,
          barcode: row.barcode,
        })
      }
      setVersion((was) => was + 1)
    })
    return () => {
      alive = false
    }
  }, [])

  const learn = useCallback(async (skus: readonly string[]) => {
    const wanted = [...new Set(skus)].filter((sku) => !names.current.has(sku) && !asked.current.has(sku))
    if (wanted.length === 0) return
    for (const sku of wanted) asked.current.add(sku)
    for (let at = 0; at < wanted.length; at += IDENTITY_PAGE) {
      const reply = await api.catalogIdentities(wanted.slice(at, at + IDENTITY_PAGE))
      if (!reply.ok) continue
      for (const one of reply.body?.items ?? []) {
        names.current.set(one.sku_code, {
          name: one.name,
          division: one.division_code,
          tags: one.tags,
          photo: (one.image_url ?? "") !== "",
          article: one.article_code,
          barcode: one.barcode ?? null,
        })
      }
    }
    setVersion((was) => was + 1)
  }, [])

  const knows = useCallback((sku: string) => names.current.has(sku), [])
  // `version` is what says the names changed; the map itself is mutated.
  const items = useMemo(() => build(names.current), [version])
  return { items, learn, knows }
}
