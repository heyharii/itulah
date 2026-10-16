import { createHash } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises"
import path from "node:path"

const DEFAULTS = {
  memoryBytes: 128 * 1024 * 1024,
  diskBytes: 1024 * 1024 * 1024,
  maxEntryBytes: 2 * 1024 * 1024,
  freshMs: 700,
  staleMs: 1600,
}

function jsonSize(value) {
  return Buffer.byteLength(JSON.stringify(value))
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex")
}

async function listFiles(root) {
  let names = []
  try {
    names = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const found = []
  for (const item of names) {
    const full = path.join(root, item.name)
    if (item.isDirectory()) found.push(...(await listFiles(full)))
    else if (item.isFile() && item.name.endsWith(".json")) found.push(full)
  }
  return found
}

export class SnapshotCache {
  constructor({
    directory = process.env.ITULAH_NEXT_CACHE_DIR ?? path.resolve(".next-snapshot-cache"),
    memoryBytes = Number(process.env.ITULAH_NEXT_CACHE_RAM_BYTES ?? DEFAULTS.memoryBytes),
    diskBytes = Number(process.env.ITULAH_NEXT_CACHE_DISK_BYTES ?? DEFAULTS.diskBytes),
    maxEntryBytes = Number(process.env.ITULAH_NEXT_CACHE_ENTRY_BYTES ?? DEFAULTS.maxEntryBytes),
    freshMs = Number(process.env.ITULAH_NEXT_CACHE_FRESH_MS ?? DEFAULTS.freshMs),
    staleMs = Number(process.env.ITULAH_NEXT_CACHE_STALE_MS ?? DEFAULTS.staleMs),
  } = {}) {
    this.directory = directory
    this.memoryBytes = Math.max(0, memoryBytes)
    this.diskBytes = Math.max(0, diskBytes)
    this.maxEntryBytes = Math.max(1024, maxEntryBytes)
    this.freshMs = Math.max(1, freshMs)
    this.staleMs = Math.max(this.freshMs, staleMs)
    this.memory = new Map()
    this.inflight = new Map()
    this.memoryUsed = 0
    this.diskUsed = null
    this.counters = { hit: 0, miss: 0, stale: 0, expired: 0, evicted: 0, bypassed: 0, writeError: 0, fenced: 0 }
    // A process-wide generation is intentionally conservative: an invalidation
    // fences every loader that was already in flight, without keeping an
    // unbounded per-user generation map alive for every login session.
    this.generation = 0
    this.invalidatingOwners = new Set()
  }

  key(namespace, ownerHash, query) {
    return digest(`${namespace}\n${ownerHash}\n${JSON.stringify(query)}`)
  }

  async ensureDirectory() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    if (this.diskUsed === null) {
      const files = await listFiles(this.directory)
      let total = 0
      for (const file of files) {
        try { total += (await stat(file)).size } catch { /* concurrently evicted */ }
      }
      this.diskUsed = total
    }
  }

  entryPath(key) {
    return path.join(this.directory, key.slice(0, 2), `${key}.json`)
  }

  remember(key, record, bytes) {
    const previous = this.memory.get(key)
    if (previous) {
      this.memory.delete(key)
      this.memoryUsed -= previous.bytes
    }
    if (bytes <= this.memoryBytes) {
      this.memory.delete(key)
      this.memory.set(key, { record, bytes })
      this.memoryUsed += bytes
      this.evictMemory()
    }
  }

  evictMemory() {
    while (this.memoryUsed > this.memoryBytes && this.memory.size > 0) {
      const [key, value] = this.memory.entries().next().value
      this.memory.delete(key)
      this.memoryUsed -= value.bytes
      this.counters.evicted += 1
    }
  }

  async read(key) {
    const hot = this.memory.get(key)
    if (hot) {
      this.memory.delete(key)
      this.memory.set(key, hot)
      return hot.record
    }
    await this.ensureDirectory()
    const file = this.entryPath(key)
    try {
      const raw = await readFile(file)
      const record = JSON.parse(raw.toString("utf8"))
      if (!record || !Number.isFinite(record.createdAt) || !Number.isFinite(record.staleUntil) || !("data" in record))
        throw new Error("invalid cache record")
      this.remember(key, record, raw.byteLength)
      void utimes(file, new Date(), new Date()).catch(() => {})
      return record
    } catch (error) {
      if (error?.code !== "ENOENT") {
        await rm(file, { force: true }).catch(() => {})
        this.counters.writeError += 1
      }
      return undefined
    }
  }

  async write(key, record) {
    const raw = Buffer.from(JSON.stringify(record))
    if (raw.byteLength > this.maxEntryBytes || this.diskBytes === 0) {
      this.counters.bypassed += 1
      return
    }
    await this.ensureDirectory()
    const file = this.entryPath(key)
    const parent = path.dirname(file)
    await mkdir(parent, { recursive: true, mode: 0o700 })
    const temp = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
    try {
      let oldSize = 0
      try { oldSize = (await stat(file)).size } catch { /* first write */ }
      await writeFile(temp, raw, { mode: 0o600, flag: "wx" })
      await rename(temp, file)
      this.diskUsed = Math.max(0, (this.diskUsed ?? 0) - oldSize + raw.byteLength)
      this.remember(key, record, raw.byteLength)
      await this.evictDisk()
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      this.counters.writeError += 1
      // A disk failure never blocks a read. Retain the bounded RAM copy.
      this.remember(key, record, raw.byteLength)
      if (process.env.NODE_ENV !== "test") console.error("snapshot-cache write failed", error?.code ?? error?.name)
    }
  }

  async evictDisk() {
    if ((this.diskUsed ?? 0) <= this.diskBytes) return
    const files = await listFiles(this.directory)
    const entries = []
    for (const file of files) {
      try {
        const info = await stat(file)
        entries.push({ file, size: info.size, mtimeMs: info.mtimeMs })
      } catch { /* concurrently evicted */ }
    }
    entries.sort((a, b) => a.mtimeMs - b.mtimeMs)
    for (const entry of entries) {
      if ((this.diskUsed ?? 0) <= this.diskBytes) break
      await rm(entry.file, { force: true }).catch(() => {})
      this.diskUsed = Math.max(0, (this.diskUsed ?? 0) - entry.size)
      this.counters.evicted += 1
    }
  }

  async refresh(key, loader, namespace, ownerHash, query) {
    const generation = this.generation
    const inflightKey = `${key}:${generation}`
    const pending = this.inflight.get(inflightKey)
    if (pending) return pending
    const work = (async () => {
      const data = await loader()
      const now = Date.now()
      const record = {
        namespace,
        ownerHash,
        query,
        createdAt: now,
        freshUntil: now + this.freshMs,
        staleUntil: now + this.staleMs,
        data,
      }
      if (generation === this.generation) await this.write(key, record)
      else this.counters.fenced += 1
      return record
    })().finally(() => this.inflight.delete(inflightKey))
    this.inflight.set(inflightKey, work)
    return work
  }

  async getOrLoad(namespace, ownerHash, query, loader) {
    const key = this.key(namespace, ownerHash, query)
    const generation = this.generation
    const invalidating = this.invalidatingOwners.has(ownerHash)
    const existing = invalidating ? undefined : await this.read(key)
    // Invalidation can start while a disk read is in progress. In that case
    // ignore the pre-invalidation record and load from the origin.
    const canUseExisting = generation === this.generation && !this.invalidatingOwners.has(ownerHash)
    const now = Date.now()
    if (existing && canUseExisting && now <= existing.freshUntil) {
      this.counters.hit += 1
      return { data: existing.data, createdAt: existing.createdAt, state: "hit", version: digest(JSON.stringify(existing.data)) }
    }
    if (existing && canUseExisting && now <= existing.staleUntil) {
      this.counters.stale += 1
      void this.refresh(key, loader, namespace, ownerHash, query).catch(() => {})
      return { data: existing.data, createdAt: existing.createdAt, state: "stale", version: digest(JSON.stringify(existing.data)) }
    }
    if (existing && canUseExisting) {
      this.counters.expired += 1
      await this.removeKey(key)
    }
    this.counters.miss += 1
    const fresh = await this.refresh(key, loader, namespace, ownerHash, query)
    return { data: fresh.data, createdAt: fresh.createdAt, state: "miss", version: digest(JSON.stringify(fresh.data)) }
  }

  async removeKey(key) {
    const hot = this.memory.get(key)
    if (hot) {
      this.memory.delete(key)
      this.memoryUsed -= hot.bytes
    }
    const file = this.entryPath(key)
    try {
      const bytes = (await stat(file)).size
      await rm(file, { force: true })
      this.diskUsed = Math.max(0, (this.diskUsed ?? bytes) - bytes)
    } catch { /* absent */ }
  }

  async invalidateOwner(ownerHash, namespaces = []) {
    const selected = new Set(namespaces)
    // Fence old loaders before the first await. New requests also bypass this
    // owner's entries until both RAM and disk invalidation has completed.
    this.generation += 1
    this.invalidatingOwners.add(ownerHash)
    for (const [key, entry] of this.memory) {
      if (entry.record.ownerHash === ownerHash && (selected.size === 0 || selected.has(entry.record.namespace))) {
        this.memory.delete(key)
        this.memoryUsed -= entry.bytes
      }
    }
    try {
      await this.ensureDirectory()
      const files = await listFiles(this.directory)
      for (const file of files) {
        try {
          const record = JSON.parse(await readFile(file, "utf8"))
          if (record.ownerHash !== ownerHash) continue
          if (selected.size > 0 && !selected.has(record.namespace)) continue
          const key = path.basename(file, ".json")
          await this.removeKey(key)
        } catch { /* corrupt entries are ignored and pruned on next lookup */ }
      }
    } finally {
      this.invalidatingOwners.delete(ownerHash)
    }
  }

  async clear() {
    this.generation += 1
    this.memory.clear()
    this.memoryUsed = 0
    this.diskUsed = 0
    await rm(this.directory, { recursive: true, force: true })
  }

  async stats() {
    await this.ensureDirectory()
    return {
      ...this.counters,
      memoryBytes: this.memoryUsed,
      memoryLimitBytes: this.memoryBytes,
      diskBytes: this.diskUsed,
      diskLimitBytes: this.diskBytes,
      entryLimitBytes: this.maxEntryBytes,
      freshMs: this.freshMs,
      staleMs: this.staleMs,
      entriesInMemory: this.memory.size,
    }
  }
}

export const snapshotCache = new SnapshotCache()
