import { appendFile, mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { monitorEventLoopDelay } from "node:perf_hooks"

const file = process.env.ITULAH_NEXT_METRICS_FILE ?? path.resolve(".next-prototype-metrics.ndjson")
const loop = monitorEventLoopDelay({ resolution: 20 })
loop.enable()
let lastCpu = process.cpuUsage()
let lastAt = process.hrtime.bigint()
const recent = []
const MAX_RECENT = 10000

export async function recordBrowserMetrics({ metrics, scenario, runId, route }) {
  if (!Array.isArray(metrics) || metrics.length > 16) throw new Error("invalid metric batch")
  const safeScenario = typeof scenario === "string" ? scenario.slice(0, 80) : "unspecified"
  const safeRunId = typeof runId === "string" && /^[A-Za-z0-9._-]{1,96}$/.test(runId) ? runId : "unspecified"
  const safeRoute = typeof route === "string" && /^\/[A-Za-z0-9/_-]{1,120}$/.test(route) ? route : "/"
  const accepted = metrics.flatMap((metric) => {
    if (!metric || !["TTFB", "FCP", "LCP", "CLS", "INP", "SPA"].includes(metric.name)) return []
    if (!Number.isFinite(metric.value) || !Number.isFinite(metric.delta)) return []
    if (!/^[A-Za-z0-9._-]{1,96}$/.test(metric.id ?? "")) return []
    return [{
      receivedAt: new Date().toISOString(),
      runId: safeRunId,
      scenario: safeScenario,
      route: safeRoute,
      name: metric.name,
      value: metric.value,
      delta: metric.delta,
      rating: ["good", "needs-improvement", "poor"].includes(metric.rating) ? metric.rating : "unknown",
      id: metric.id,
      navigationType: typeof metric.navigationType === "string" ? metric.navigationType.slice(0, 32) : "unknown",
    }]
  })
  if (accepted.length === 0) return 0
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  await appendFile(file, accepted.map((row) => JSON.stringify(row)).join("\n") + "\n", { mode: 0o600 })
  recent.push(...accepted)
  if (recent.length > MAX_RECENT) recent.splice(0, recent.length - MAX_RECENT)
  return accepted.length
}

export function processMetrics() {
  const now = process.hrtime.bigint()
  const cpu = process.cpuUsage()
  const elapsedUs = Number(now - lastAt) / 1000
  const usedUs = (cpu.user - lastCpu.user) + (cpu.system - lastCpu.system)
  lastAt = now
  lastCpu = cpu
  const memory = process.memoryUsage()
  const p95 = loop.percentile(95)
  const result = {
    sampledAt: new Date().toISOString(),
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    cpuPercentOfOneCore: elapsedUs > 0 ? Math.round((usedUs / elapsedUs) * 1000) / 10 : null,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    hostMemoryTotalBytes: os.totalmem(),
    hostLoadAverage: os.loadavg(),
    eventLoopDelayP95Ms: Number.isFinite(p95) ? Math.round((p95 / 1e6) * 10) / 10 : 0,
    browserMetricSamplesBuffered: recent.length,
  }
  loop.reset()
  return result
}

export function recentBrowserMetrics(limit = 1000) {
  return recent.slice(-Math.max(0, Math.min(5000, limit)))
}
