/// What the node and the reader say now: the stock in the three rooms, and the
/// Chainway R3 on the desk.
///
/// Both are read the way the till reads them — the stock again every ten
/// seconds (every table in the product polls, 11 Oct 2026), the reader's state
/// every five without touching it, so an unplugged cable shows without a read.

import { useCallback, useEffect, useRef, useState } from "react"

import * as api from "@/gudang/api"
import { type PadRead, readerStatus, readRfidPad, type ReaderStatus } from "@/edge"

const STOCK_MS = 10_000
const READER_MS = 5_000

export type Stock = {
  /// By SKU; null until the node has answered once.
  readonly stock: ReadonlyMap<string, api.Held> | null
  /// Whether the last read got through; null before the first.
  readonly online: boolean | null
  /// Read again now: after a save, so the figures on screen are the node's.
  readonly refresh: () => void
}

export function useStock(): Stock {
  const [stock, setStock] = useState<ReadonlyMap<string, api.Held> | null>(null)
  const [online, setOnline] = useState<boolean | null>(null)
  const alive = useRef(true)
  const read = useCallback(async () => {
    const reply = await api.takeStock()
    if (!alive.current) return
    if (!reply.ok) {
      setOnline(false)
      return
    }
    setStock(new Map((reply.body?.items ?? []).map((row) => [row.sku_code, row] as const)))
    setOnline(true)
  }, [])
  useEffect(() => {
    alive.current = true
    void read()
    const timer = window.setInterval(() => void read(), STOCK_MS)
    return () => {
      alive.current = false
      window.clearInterval(timer)
    }
  }, [read])
  return { stock, online, refresh: () => void read() }
}

export type Reader = {
  /// Null while the shell has not answered.
  readonly status: ReaderStatus | null
  readonly reading: boolean
  /// Read every tag on the pad. Throws a `ReaderFault` with the cashier's
  /// sentence; the state is read again afterwards either way.
  readonly read: () => Promise<PadRead>
}

export function useReader(): Reader {
  const [status, setStatus] = useState<ReaderStatus | null>(null)
  const [reading, setReading] = useState(false)
  const readingNow = useRef(false)
  useEffect(() => {
    let alive = true
    let timer: number | undefined
    void readerStatus(true).then((first) => {
      if (!alive) return
      setStatus(first)
      timer = window.setInterval(() => {
        if (readingNow.current) return
        void readerStatus(false).then((now) => {
          if (alive && !readingNow.current) setStatus(now)
        })
      }, READER_MS)
    })
    return () => {
      alive = false
      if (timer !== undefined) window.clearInterval(timer)
    }
  }, [])
  const read = useCallback(async () => {
    setReading(true)
    readingNow.current = true
    try {
      return await readRfidPad()
    } finally {
      // The chip says what the shell now holds about the reader, this read
      // included.
      const now = await readerStatus(false)
      readingNow.current = false
      setStatus(now)
      setReading(false)
    }
  }, [])
  return { status, reading, read }
}
