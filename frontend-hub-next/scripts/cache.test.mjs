import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import test from "node:test"

import { SnapshotCache } from "../src/server/snapshot-cache.mjs"

async function temporaryCache(options = {}) {
  const directory = await mkdtemp(path.join("/private/tmp", "hub-next-cache-"))
  const cache = new SnapshotCache({ directory, ...options })
  return {
    cache,
    directory,
    async close() { await rm(directory, { recursive: true, force: true }) },
  }
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test("fresh entries are reused without another origin load", async () => {
  const temp = await temporaryCache({ freshMs: 100, staleMs: 200 })
  try {
    let calls = 0
    const load = async () => ({ call: ++calls })
    const first = await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    const second = await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    assert.equal(first.state, "miss")
    assert.equal(second.state, "hit")
    assert.deepEqual(second.data, { call: 1 })
    assert.equal(calls, 1)
  } finally { await temp.close() }
})

test("stale entries return immediately and refresh once in the background", async () => {
  const temp = await temporaryCache({ freshMs: 15, staleMs: 200 })
  try {
    let calls = 0
    const load = async () => ({ call: ++calls })
    await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    await pause(25)
    const stale = await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    assert.equal(stale.state, "stale")
    assert.deepEqual(stale.data, { call: 1 })
    const key = temp.cache.key("po-list", "owner-a", "all")
    const inflightKey = () => [...temp.cache.inflight.keys()].find((candidate) => candidate.startsWith(`${key}:`))
    for (let attempt = 0; attempt < 30 && !inflightKey(); attempt++) await pause(5)
    await temp.cache.inflight.get(inflightKey())
    const refreshed = await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    assert.deepEqual(refreshed.data, { call: 2 })
    assert.equal(calls, 2)
  } finally { await temp.close() }
})

test("expired entries block on a fresh load", async () => {
  const temp = await temporaryCache({ freshMs: 10, staleMs: 25 })
  try {
    let calls = 0
    const load = async () => ({ call: ++calls })
    await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    await pause(35)
    const fresh = await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    assert.equal(fresh.state, "miss")
    assert.deepEqual(fresh.data, { call: 2 })
    assert.equal(calls, 2)
    assert.equal((await temp.cache.stats()).expired, 1)
  } finally { await temp.close() }
})

test("concurrent misses share a single origin request", async () => {
  const temp = await temporaryCache()
  try {
    let calls = 0
    const load = async () => { calls++; await pause(20); return { rows: [1, 2] } }
    const results = await Promise.all(Array.from({ length: 24 }, () =>
      temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    ))
    assert.equal(calls, 1)
    assert.ok(results.every((result) => result.version === results[0].version))
  } finally { await temp.close() }
})

test("owner hashes isolate data and owner invalidation removes RAM and disk entries", async () => {
  const temp = await temporaryCache()
  try {
    let calls = 0
    const load = async () => ({ value: ++calls })
    await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    await temp.cache.getOrLoad("po-list", "owner-b", "all", load)
    await temp.cache.getOrLoad("po-detail", "owner-a", "one", load)
    await temp.cache.invalidateOwner("owner-a", ["po-list"])
    const a = await temp.cache.getOrLoad("po-list", "owner-a", "all", load)
    const b = await temp.cache.getOrLoad("po-list", "owner-b", "all", load)
    const detail = await temp.cache.getOrLoad("po-detail", "owner-a", "one", load)
    assert.equal(a.state, "miss")
    assert.equal(b.state, "hit")
    assert.equal(detail.state, "hit")
    assert.equal(calls, 4)
  } finally { await temp.close() }
})

test("owner invalidation fences an older in-flight load from repopulating the cache", async () => {
  const temp = await temporaryCache()
  try {
    let releaseOld
    let startedOld
    const oldStarted = new Promise((resolve) => { startedOld = resolve })
    const oldLoad = temp.cache.getOrLoad("po-list", "owner-a", "all", async () => {
      startedOld()
      return new Promise((resolve) => { releaseOld = resolve })
    })
    await oldStarted
    await temp.cache.invalidateOwner("owner-a", ["po-list"])
    releaseOld({ version: "before-write" })
    await oldLoad

    const current = await temp.cache.getOrLoad("po-list", "owner-a", "all", async () => ({ version: "after-write" }))
    assert.equal(current.state, "miss")
    assert.deepEqual(current.data, { version: "after-write" })
    assert.equal((await temp.cache.stats()).fenced, 1)
  } finally { await temp.close() }
})

test("serialized JSON snapshots survive a process restart", async () => {
  const temp = await temporaryCache({ freshMs: 10000, staleMs: 15000 })
  try {
    await temp.cache.getOrLoad("receiving-work", "owner-a", "all", async () => ({ rows: ["synthetic"] }))
    const restarted = new SnapshotCache({ directory: temp.directory, freshMs: 10000, staleMs: 15000 })
    const loaded = await restarted.getOrLoad("receiving-work", "owner-a", "all", async () => {
      throw new Error("restart should read the durable snapshot")
    })
    assert.equal(loaded.state, "hit")
    assert.deepEqual(loaded.data, { rows: ["synthetic"] })
  } finally { await temp.close() }
})

test("RAM and disk stay under configured bounds through LRU eviction", async () => {
  const temp = await temporaryCache({
    memoryBytes: 2200,
    diskBytes: 5000,
    maxEntryBytes: 4000,
    freshMs: 10000,
    staleMs: 15000,
  })
  try {
    for (let i = 0; i < 12; i++) {
      await temp.cache.getOrLoad(`namespace-${i}`, "owner-a", "all", async () => ({ text: String(i).repeat(800) }))
    }
    const stats = await temp.cache.stats()
    assert.ok(stats.memoryBytes <= stats.memoryLimitBytes)
    assert.ok(stats.diskBytes <= stats.diskLimitBytes)
    assert.ok(stats.evicted > 0)
  } finally { await temp.close() }
})
