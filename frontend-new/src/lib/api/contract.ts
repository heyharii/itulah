/**
 * Checking that a response is actually shaped the way the calling code
 * believes it is.
 *
 * Until now `request<T>` ended in `return payload as T` — a cast, which is a
 * promise the compiler cannot check and the backend never made. If cloud-hub
 * renames a field, drops one, or sends `null` where a number was expected,
 * nothing fails here. It fails several layers away, inside a component, as
 * `undefined is not an object` on a line that has nothing to do with the
 * change. The stack trace points at the victim, not the cause.
 *
 * Schemas are declared with zod but consumed through **Standard Schema**, the
 * shared interface zod 4, valibot and arktype all implement. The form layer
 * already validates this way, so there is one validation vocabulary in the
 * codebase rather than one per layer.
 *
 * ## Why a mismatch does not throw in production
 *
 * A schema is a second description of the backend, written by hand, from a
 * frontend that cannot see the Go structs. Some of these schemas will be
 * wrong — too strict about an optional field, or missing a variant that only
 * appears for one tenant. If a wrong schema threw, the result would be a
 * screen that worked yesterday going blank today because of a description of
 * the data rather than the data itself. That is a worse failure than the one
 * being prevented.
 *
 * So the behaviour is split:
 *
 * - **dev and test** — throw. That is where a wrong schema is cheap to find
 *   and someone is present to fix it.
 * - **production** — report once per endpoint, then return the payload
 *   unchanged. The screen behaves exactly as it did before this file existed.
 *
 * The value of the production path is not blocking bad data; it is *knowing*.
 * A count of contract violations per endpoint is the thing this codebase has
 * never had.
 */

import type { StandardSchemaV1 } from "@standard-schema/spec"

export interface ContractViolation {
  path: string
  issues: readonly StandardSchemaV1.Issue[]
  payload: unknown
}

/** Swapped in tests, and by anything that wants violations sent somewhere. */
let report: (violation: ContractViolation) => void = defaultReport

export function onContractViolation(
  handler: (violation: ContractViolation) => void
): void {
  report = handler
}

/* One report per endpoint per session. A list screen that refetches on every
 * keystroke would otherwise turn a single wrong schema into a flood, and the
 * hundredth copy of a violation says nothing the first did not.
 *
 * The gate lives here rather than inside `defaultReport`, so a handler that
 * ships violations somewhere gets the same guarantee — a test caught that it
 * did not, which is exactly the kind of promise a docstring makes and the
 * code quietly declines to keep. */
const reported = new Set<string>()

/* The gate is keyed by schema *and* route, not route alone.
 *
 * Three domains each describe `/v1/masterdata/suppliers` with their own schema
 * — finance, dashboard and sourcing. Once route labels were normalised they
 * collapsed onto one key, and a route-only gate would let the first domain to
 * report silence the other two: a genuinely wrong schema in sourcing would
 * never be heard because finance had already spoken for that route.
 *
 * A WeakMap keeps the identity without holding the schema alive. */
const schemaIds = new WeakMap<object, number>()
let nextSchemaId = 0

function gateKey(schema: object, path: string): string {
  let id = schemaIds.get(schema)
  if (id === undefined) {
    id = nextSchemaId
    nextSchemaId += 1
    schemaIds.set(schema, id)
  }
  return `${id}@${path}`
}

function defaultReport({ path, issues, payload }: ContractViolation): void {
  console.warn(
    `[contract] ${path} did not match its schema — using the response as-is.`,
    { issues, payload }
  )
}

export class ContractError extends Error {
  readonly path: string
  readonly issues: readonly StandardSchemaV1.Issue[]
  readonly payload: unknown

  constructor(violation: ContractViolation) {
    super(
      `${violation.path} did not match its schema: ${formatIssues(violation.issues)}`
    )
    this.name = "ContractError"
    this.path = violation.path
    this.issues = violation.issues
    this.payload = violation.payload
  }
}

function formatIssues(issues: readonly StandardSchemaV1.Issue[]): string {
  return (
    issues
      .slice(0, 4)
      .map((issue) => {
        const where = issue.path
          ?.map((segment) =>
            typeof segment === "object" ? String(segment.key) : String(segment)
          )
          .join(".")
        return where ? `${where}: ${issue.message}` : issue.message
      })
      .join("; ") + (issues.length > 4 ? ` (+${issues.length - 4} more)` : "")
  )
}

/**
 * Validate a payload against a schema.
 *
 * Returns the schema's *output*, so a schema may also normalise — trimming, a
 * default, a `null` folded to `undefined`. That is deliberate: the place that
 * knows a field is unreliable is the same place that should fix it, rather
 * than every consumer doing it again.
 *
 * Synchronous only. An async Standard Schema validator would make every API
 * call await a second microtask queue for no benefit here, and none of the
 * schemas in this codebase need it — so it is a contract failure, not a case
 * to support.
 */
export function validateContract<S extends StandardSchemaV1>(
  schema: S,
  payload: unknown,
  path: string
): StandardSchemaV1.InferOutput<S> {
  const result = schema["~standard"].validate(payload)

  if (result instanceof Promise) {
    throw new TypeError(
      `${path} was given an async schema; response contracts must be synchronous.`
    )
  }

  if (result.issues === undefined) return result.value

  const violation: ContractViolation = {
    path,
    issues: result.issues,
    payload,
  }

  if (import.meta.env.DEV || import.meta.env.MODE === "test") {
    throw new ContractError(violation)
  }

  const key = gateKey(schema, path)
  if (!reported.has(key)) {
    reported.add(key)
    report(violation)
  }
  return payload as StandardSchemaV1.InferOutput<S>
}

/**
 * Strict counterpart for security-sensitive envelopes (identity, token and
 * capability responses). Unlike `validateContract`, this never falls back to
 * the unparsed payload in production: callers cannot safely continue when the
 * response that establishes a session is malformed.
 */
export function parseContract<S extends StandardSchemaV1>(
  schema: S,
  payload: unknown,
  path: string,
): StandardSchemaV1.InferOutput<S> {
  const result = schema["~standard"].validate(payload)

  if (result instanceof Promise) {
    throw new TypeError(
      `${path} was given an async schema; response contracts must be synchronous.`,
    )
  }

  if (result.issues !== undefined) {
    throw new ContractError({ path, issues: result.issues, payload })
  }

  return result.value
}

/**
 * Collapse the record ids out of a request URL, so a route reports once rather
 * than once per record.
 *
 * `request()` has only the real URL to hand — `/v1/records/8f3a…` — and using
 * it verbatim makes the dedup key unique per record, which is the exact flood
 * the gate exists to prevent. The convention this restores is the one written
 * down for `checkContract` in `docs/recipe-response-contracts.md`: a label
 * names the *route*, not the row.
 *
 * The test for "is this segment an id" is deliberately crude — a UUID, a
 * number, or a long opaque token — and it is wrong in one known direction: a
 * numeric segment that is really a route word gets collapsed too. The
 * customer-360 route becomes `/v1/customer/admin/:id/:id`, because nothing
 * here can tell `360` the view from `482` the order.
 *
 * That is accepted rather than fixed. The label only has to be *stable* and
 * *unique to the route*, and a doubly-collapsed one still is; the cost is a
 * slightly uglier string in a warning. Teaching this function the estate's
 * route vocabulary would trade a cosmetic flaw for a list that goes stale.
 */
export function routeLabel(path: string): string {
  const [route] = path.split("?")
  return (route ?? path)
    .split("/")
    .map((segment) => (looksLikeId(segment) ? ":id" : segment))
    .join("/")
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function looksLikeId(segment: string): boolean {
  let value: string
  try {
    value = decodeURIComponent(segment)
  } catch {
    /* A malformed escape is still a route segment. It must not make contract
     * reporting itself throw while handling an otherwise valid HTTP response. */
    value = segment
  }
  if (value === "") return false
  if (UUID.test(value)) return true
  if (/^\d+$/.test(value)) return true
  /* An opaque token: long, and mixing cases or digits in a way route words do
   * not. `purchase-orders` and `member-program` must survive this. */
  return value.length >= 16 && /\d/.test(value) && !value.includes("-")
}

/** Test-only: forget which endpoints have already reported. */
export function resetContractReports(): void {
  reported.clear()
  report = defaultReport
}

/**
 * Validate the rows of a list whose envelope has already been unwrapped.
 *
 * Four domains fetch as `api.get<unknown>` and then hand the payload to a
 * helper that accepts several envelope shapes — a bare array, `{items}`,
 * `{data}`, `{rows}` — before mapping each row defensively. Attaching a schema
 * at `api.get` would mean describing that union of envelopes, which is a
 * description of this codebase's tolerance rather than of the backend.
 *
 * So the seam moves one step later: unwrap as before, then check the rows.
 *
 * These rows are *already* handled defensively downstream — a bad row maps to
 * `undefined` and is filtered out. That is why this reports rather than
 * discards even in dev: the screen was never going to break, and the thing
 * worth having is the knowledge that rows are being silently dropped, which
 * today happens with no trace at all.
 */
export function checkContract<S extends StandardSchemaV1>(
  schema: S,
  rows: unknown[],
  rawPath: string
): void {
  /* Normalised here rather than trusted from the caller. Thirteen domains
   * write these labels by hand, and the first live violation arrived under
   * `/v1/masterdata/suppliers?limit=200` — a query string that varies per
   * screen would split one endpoint's reports across several keys. */
  const path = routeLabel(rawPath)

  for (const row of rows) {
    const result = schema["~standard"].validate(row)
    if (result instanceof Promise) {
      throw new TypeError(
        `${path} was given an async schema; response contracts must be synchronous.`
      )
    }
    if (result.issues === undefined) continue

    /* First offending row only. A backend that renamed a field renamed it in
     * all two hundred rows, and two hundred identical reports is noise. */
    const key = gateKey(schema, path)
    if (!reported.has(key)) {
      reported.add(key)
      report({ path, issues: result.issues, payload: row })
    }
    return
  }
}
