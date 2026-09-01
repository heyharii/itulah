/**
 * `useInfiniteRows` had never executed before this file existed.
 *
 * It was written, exported, documented and described to the user as "infinite
 * scroll" while being wired to exactly zero screens. Code that has never run is
 * not a feature, so these tests run it — against the response shapes the hub
 * actually returns, including the ambiguous one that the whole list contract
 * exists to survive.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

import { useInfiniteRows } from "./use-infinite-rows"

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

/** A hub that pages `total` rows, `limit` at a time, the way /audit does. */
function pagingHub(total: number) {
  return vi.fn(async ({ offset, limit }: { offset: number; limit: number }) => {
    const items = Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, i) => ({ id: `row-${offset + i}` }),
    )
    return { count: items.length, items, total }
  })
}

describe("useInfiniteRows", () => {
  it("loads the first page and reports what the server says exists", async () => {
    const fetchPage = pagingHub(72)
    const { result } = renderHook(
      () => useInfiniteRows<{ id: string }>({ queryKey: ["t", 1], fetchPage, pageSize: 20 }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.rows).toHaveLength(20)
    expect(result.current.total).toBe(72)
    expect(result.current.hasNextPage).toBe(true)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it("accumulates pages rather than replacing them", async () => {
    const fetchPage = pagingHub(72)
    const { result } = renderHook(
      () => useInfiniteRows<{ id: string }>({ queryKey: ["t", 2], fetchPage, pageSize: 20 }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.rows).toHaveLength(20))
    result.current.fetchNextPage()
    await waitFor(() => expect(result.current.rows).toHaveLength(40))

    /* The rows must be in order and not duplicated — the failure mode of an
     * offset that is computed from the wrong number. */
    expect(result.current.rows[0].id).toBe("row-0")
    expect(result.current.rows[20].id).toBe("row-20")
    expect(new Set(result.current.rows.map((r) => r.id)).size).toBe(40)
  })

  it("asks the hub for the offset it already holds", async () => {
    const fetchPage = pagingHub(72)
    const { result } = renderHook(
      () => useInfiniteRows<{ id: string }>({ queryKey: ["t", 3], fetchPage, pageSize: 20 }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.rows).toHaveLength(20))
    result.current.fetchNextPage()
    await waitFor(() => expect(fetchPage).toHaveBeenCalledTimes(2))

    expect(fetchPage.mock.calls[0][0]).toMatchObject({ offset: 0, cursor: null })
    expect(fetchPage.mock.calls[1][0]).toMatchObject({ offset: 20, cursor: "20" })
  })

  it("stops at the end instead of paging forever", async () => {
    const fetchPage = pagingHub(45)
    const { result } = renderHook(
      () => useInfiniteRows<{ id: string }>({ queryKey: ["t", 4], fetchPage, pageSize: 20 }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.rows).toHaveLength(20))
    result.current.fetchNextPage()
    await waitFor(() => expect(result.current.rows).toHaveLength(40))
    result.current.fetchNextPage()
    await waitFor(() => expect(result.current.rows).toHaveLength(45))

    expect(result.current.hasNextPage).toBe(false)
  })

  it("follows an opaque cursor without inspecting it", async () => {
    /* procurement and masterdata return a base64 keyset cursor. The hook must
     * hand it straight back, never parse it. */
    const fetchPage = vi.fn(async ({ cursor }: { cursor: string | null }) => {
      if (cursor === null) {
        return { items: [{ id: "a" }], total: 2, next_cursor: "eyJsYXN0IjoiYSJ9" }
      }
      expect(cursor).toBe("eyJsYXN0IjoiYSJ9")
      return { items: [{ id: "b" }], total: 2 }
    })

    const { result } = renderHook(
      () => useInfiniteRows<{ id: string }>({ queryKey: ["t", 5], fetchPage }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.rows).toHaveLength(1))
    result.current.fetchNextPage()
    await waitFor(() => expect(result.current.rows).toHaveLength(2))
    expect(result.current.hasNextPage).toBe(false)
  })

  it("does not page against a total it cannot trust", async () => {
    /* `total === items.length` is the ambiguous shape: it may mean "that was
     * everything" or "that was one page of many". Paging on it would loop
     * against a number the client invented. */
    const fetchPage = vi.fn(async () => ({ items: [{ id: "x" }, { id: "y" }], total: 2 }))
    const { result } = renderHook(
      () => useInfiniteRows<{ id: string }>({ queryKey: ["t", 6], fetchPage }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.rows).toHaveLength(2)
    expect(result.current.total).toBeUndefined()
    expect(result.current.hasNextPage).toBe(false)
    expect(fetchPage).toHaveBeenCalledTimes(1)
  })

  it("surfaces a refusal as a sentence rather than throwing", async () => {
    const fetchPage = vi.fn(async () => {
      throw new Error("the hub refused")
    })
    const { result } = renderHook(
      () => useInfiniteRows<{ id: string }>({ queryKey: ["t", 7], fetchPage }),
      { wrapper: wrapper() },
    )

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.errorMessage).toContain("refused")
    expect(result.current.rows).toEqual([])
  })

  it("does not fetch while disabled", async () => {
    const fetchPage = pagingHub(72)
    renderHook(
      () => useInfiniteRows<{ id: string }>({ queryKey: ["t", 8], fetchPage, enabled: false }),
      { wrapper: wrapper() },
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(fetchPage).not.toHaveBeenCalled()
  })
})
