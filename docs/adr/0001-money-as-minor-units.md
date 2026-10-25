# 0001 — Money as integer minor units

- **Status:** Accepted
- **Date:** 2026-06
- **Applies to:** `packages/core/src/money.ts`, `packages/core/src/fx.ts`, all tables

*Resumen (ES):* los importes se guardan como enteros en unidades menores más una
moneda; nunca como flotantes. La aritmética racional usa `bigint` y redondeo
bancario, la base de datos usa `bigint` y el formato se aplica solo al mostrar.

## Context

Accounts payable is mostly arithmetic, and arithmetic is where financial
software quietly breaks. A cent lost by a float is a reconciliation exception; a
cent gained is a fraud signal. The usual failure modes are:

- storing `0.1 + 0.2` as `0.30000000000000004`;
- dividing an amount into three parts and losing two cents;
- converting currency twice and rounding at each step;
- assuming every currency has two decimals.

## Decision

1. **A monetary value is `{ amount: number, currency: string }`** where `amount`
   is an integer count of minor units (cents, centavos, yen).
2. **The currency registry owns the exponent.** `minorUnitDigits("JPY")` is `0`,
   `"USD"` is `2`; nothing hard-codes `100`.
3. **All intermediate math is exact.** Division and multiplication go through
   `bigint` rationals (`divRoundHalfEven`, `multiply`, `allocate`). Rounding is
   banker's rounding, applied once, at the point where an exact value must
   become a stored amount.
4. **Allocation is remainder-aware.** `allocate(total, weights)` and
   `splitEvenly(total, parts)` distribute leftovers deterministically, so the
   parts always sum back to the total.
5. **Parsing rejects what it cannot know.** `parseAmount` accepts `1,234.56`,
   `1.234,56`, parentheses and currency symbols; it throws on conflicting
   separators instead of picking one.
6. **Persistence uses `bigint` columns** (`subtotal_minor`, `total_minor`, …).
   JSON exposes numbers, which are safe well beyond any realistic invoice.
7. **FX is an exact rational** (`numerator` / `denominator`) with an as-of date
   and a source. `convert` rounds once, after multiplying.

## Consequences

- Adding two different currencies throws instead of silently coercing. The type
  system does not encode the currency, so this is a runtime guard — covered by
  tests, and the reason every call site carries the currency explicitly.
- Formatting happens only at the edge (`format`, `toMajorString`). The UI never
  receives a float and re-parses it.
- The database and the domain agree on integer semantics, which keeps
  `db:verify`, the seed and the evals comparable.
- Slightly more ceremony when writing code: a bare `number` is not money. That is
  the point.
