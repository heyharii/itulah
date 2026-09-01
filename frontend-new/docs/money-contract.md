# The money contract

Status: **decided** — the representation is settled; the migration is not.
Date: 2026-08-27
Spans: `retail/internal` (Go) and `slowdown/vite-app` (React).

---

## The decision

**Money is an integer in minor units, plus an explicit currency. Never a float.**

This is not a new decision. The Rust tree already made it and wrote the
reasoning into the type — `Documents/fresh/crates/ledger-domain/src/lib.rs`:

```rust
/// An amount in integer minor units plus its currency. Never a float.
pub struct Money { amount_minor: i64, currency: Currency }
```

Two invariants come with it, and they are part of the decision:

- **`Money::new` refuses `amount_minor <= 0`.** Direction is carried by
  `JournalSide`, never by a sign. The comment in the Rust source is worth
  keeping: a negative amount is *"a side error wearing a disguise"*.
- **`Currency` is parsed, not a free string** — exactly three ASCII letters,
  upper-cased.

Per the standing rule, the Rust tree is reference material: port the **idea**
into Go idiom, do not port the code, and never propose rewriting in Rust.

---

## What the Go tree does today

Money fields are declared with four different types:

| Type | Fields |
|---|---|
| `int64` | 106 |
| `decimal.Decimal` | 81 |
| **`float64`** | **533 total, see below** |
| `string` | 24 |

The float count needs splitting, because not every float is wrong:

| Class | Count | Verdict |
|---|---|---|
| Ratios, scores, percentages — `growth_pct`, `gross_margin_pct`, `compliance_score`, `avg_items_per_tx` | 89 | **float is correct.** Leave them. |
| Averages *of money* — `aov`, `avg_basket`, `avg_txn_value` | 30 | Middle case, see below. |
| **Money** — `total_amount`, `unit_price`, `line_total`, `cash_variance`, `difference`, … | **284** | **Wrong. This is the migration.** |

> An earlier note in this project put the float-money count at 70. That was an
> undercount from a narrower grep; the real figure is 284.

### Where it is worst

| Package | Fields | Why it matters here specifically |
|---|---|---|
| ~~`cloud/salepayload/parse_v1.go`~~ | — | **ALREADY DONE — do not touch.** `parse_v1.go` is a *versioned wire format*, and its header says so: `// v1 payload structures (legacy). Prices are float64 in JSON.` The float is a faithful record of what was actually sent. `parse_v2.go` already exists with `Subtotal int64`, `DiscountAmount int64`, `TotalAmount int64`. Retyping v1 would reject or corrupt every historical event in the backbone. |
| `store/reconciliation/types.go` | `pos_amount`, `ocr_amount`, `bank_total`, **`difference`** | Reconciliation *is* the act of checking whether two money figures match. Computing `difference` between two floats is precisely where drift becomes a phantom discrepancy — or hides a real one. |
| `store/dailyrecon/types.go` | `total_cash_physical`, `total_cash_system`, **`cash_variance`**, `edc_variance` | Cash counting. Same failure, with a person's till at the end of it. |
| `cloud/pricemanagement/types.go` | `base_price`, `final_price`, `override_price` | Prices feed every downstream total. |
| `cloud/inventoryvaluation/types.go` | `avg_cost`, `total_value` | `avg_cost` is a division, then multiplied by quantity. Error compounds. |
| `cloud/analytics`, `cloud/kpireports`, `store/dashboard` | `revenue`, `total_cogs`, `gross_profit`, `total_sales`, `cash_amount` | Reported figures. Wrong here is wrong on a screen someone acts on. |

### Why float is the wrong type for money

`0.1 + 0.2 !== 0.3` holds in Go and in JavaScript alike. A financial report is
repeated addition, which is exactly the operation that accumulates the error.
The frontend inherits it: JSON numbers become IEEE-754 doubles, so a total that
drifted in Go arrives already drifted, and no amount of formatting recovers it.

---

## The target

### Go

```go
// Money is an amount in integer minor units with its currency.
// Direction is carried by the posting side, never by the sign.
type Money struct {
    AmountMinor int64
    Currency    Currency
}
```

- `decimal.Decimal` may stay where it is already load-bearing in `accounting` —
  it is exact, and swapping it buys nothing.
- `float64` is not acceptable for a money field anywhere.
- `int64` alone is not the target either: an amount without its currency is a
  number waiting to be added to the wrong thing.

### The wire

Integer minor units. For IDR the minor unit is the rupiah itself — sen is
obsolete — so no scaling is applied. **The field is still named for minor units**
so that adding a second currency does not silently reinterpret every stored row.

### Averages of money

`aov`, `avg_basket`, `avg_txn_value` are a division and cannot be exact. Compute
in integer minor units and round once, at the point of production. A displayed
average of `Rp 152.347,83` is meaningless in a currency with no sen — the
fractional part is noise that only exists because the type allowed it.

### Frontend

`shared/locale/formatIDR` takes one shape: an integer minor amount. It should
not accept a float, and it should not guess per field which of four
representations it was handed.

---

## Migration order

Ordered by what a wrong number costs, not by field count.

| Wave | Scope | Why here |
|---|---|---|
| 1 | `store/reconciliation`, `store/dailyrecon` | Cash-variance money. A drift here is a real discrepancy someone has to chase, or a real one that goes unseen. Both are internal domain types with no version split, no frontend consumer, and green tests — a contained change. |
| 2 | `pricemanagement`, `inventoryvaluation` | Prices and costs feed every total downstream. |
| 3 | `sales`, `customer`, `merchandising`, `commands` | Operational money. |
| 4 | `analytics`, `kpireports`, `dashboard` | Reported money. Wrong, but read rather than posted. |
| 5 | Averages → integer + round-once | Needs the wave-1 types to exist first. |
| — | Ratios and scores | **No change.** 89 fields where float is the right type. |

---

## The rule that `salepayload` teaches

**A versioned wire format is not a type to fix. It is a record of what was
sent.**

`parse_v1.go` keeps `float64` because v1 payloads really did carry floats, and
the parser's job is to read them faithfully. The migration there was done the
right way — a `parse_v2.go` alongside it, with `int64` — not by retyping the old
one.

So before changing any money field, ask which of the two it is:

| Kind | Treatment |
|---|---|
| **Wire format, versioned** (`parse_vN.go`, event payloads, frozen store↔cloud routes) | Leave it. Add the next version beside it. Convert to `Money` at the boundary, immediately, and never let the float travel inward. |
| **Internal domain type** (`reconciliation`, `dailyrecon`, service structs) | Retype it. |

An earlier draft of this document put `salepayload` at the top of wave 1. That
was wrong, and it would have broken the event backbone.

---

## What this contract does not do

- It does not replace `decimal.Decimal` in accounting. Exact is exact.
- It does not change ratios, percentages or scores to integers.
- It does not scale IDR by 100. The minor unit is the rupiah; the naming is what
  carries the future currency, not a phantom multiplier.
- It does not retype a versioned wire format. See the rule above.
- It does not allow a sign to mean direction. That is what the posting side is
  for, and it is the invariant most likely to be quietly dropped in a port.
