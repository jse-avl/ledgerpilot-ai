import {
  type DecimalParts,
  type Money,
  decimalToRational,
  divRoundHalfEven,
  minorUnitDigits,
  money,
  normalizeCurrency,
} from "./money";
import { isIsoDate } from "./dates";

export interface FxRate {
  readonly base: string;
  readonly quote: string;
  readonly rate: DecimalParts;
  readonly asOf: string;
  readonly source: string;
}

export type FxErrorCode = "INVALID_RATE" | "MISSING_RATE" | "CURRENCY_MISMATCH" | "INVALID_DATE";

export class FxError extends Error {
  readonly code: FxErrorCode;

  constructor(code: FxErrorCode, message: string) {
    super(message);
    this.name = "FxError";
    this.code = code;
  }
}

export function parseRate(input: string | number): DecimalParts {
  if (typeof input === "number" && !Number.isFinite(input)) {
    throw new FxError("INVALID_RATE", `Rate must be finite: ${input}`);
  }
  let parsed: DecimalParts;
  try {
    parsed = decimalToRational(input);
  } catch {
    throw new FxError("INVALID_RATE", `Not a decimal rate: "${String(input)}"`);
  }
  if (parsed.numerator <= 0n) {
    throw new FxError("INVALID_RATE", `Rate must be positive: ${String(input)}`);
  }
  return parsed;
}

export function fxRate(input: {
  base: string;
  quote: string;
  rate: string | number;
  asOf: string;
  source?: string;
}): FxRate {
  if (!isIsoDate(input.asOf)) {
    throw new FxError("INVALID_DATE", `asOf must be YYYY-MM-DD, received "${input.asOf}"`);
  }
  const base = normalizeCurrency(input.base);
  const quote = normalizeCurrency(input.quote);
  if (base === quote) {
    throw new FxError("INVALID_RATE", "A rate must relate two different currencies");
  }
  return Object.freeze({
    base,
    quote,
    rate: parseRate(input.rate),
    asOf: input.asOf,
    source: input.source ?? "manual",
  });
}

export function invert(rate: FxRate): FxRate {
  return Object.freeze({
    base: rate.quote,
    quote: rate.base,
    rate: { numerator: rate.rate.denominator, denominator: rate.rate.numerator },
    asOf: rate.asOf,
    source: `${rate.source}:inverted`,
  });
}

/**
 * Converts an amount using an exact rational rate and half-to-even rounding.
 * Accounts for currencies with different minor-unit exponents (USD 2 vs JPY 0).
 */
export function convert(amount: Money, rate: FxRate): Money {
  if (amount.currency !== rate.base) {
    throw new FxError(
      "CURRENCY_MISMATCH",
      `Rate ${rate.base}/${rate.quote} cannot convert ${amount.currency}`,
    );
  }
  const fromDigits = minorUnitDigits(rate.base);
  const toDigits = minorUnitDigits(rate.quote);
  const numerator =
    BigInt(amount.amount) * rate.rate.numerator * 10n ** BigInt(toDigits);
  const denominator = rate.rate.denominator * 10n ** BigInt(fromDigits);
  const converted = divRoundHalfEven(numerator, denominator);
  return money(Number(converted), rate.quote);
}

/**
 * In-memory rate table with as-of lookup. For Phase 0 this is enough; the
 * production implementation reads `fx_rates` from Postgres and falls back here.
 */
export class RateTable {
  readonly #rates: FxRate[];

  constructor(rates: readonly FxRate[] = []) {
    this.#rates = [...rates];
  }

  add(rate: FxRate): void {
    this.#rates.push(rate);
  }

  lookup(base: string, quote: string, asOf: string): FxRate | null {
    const from = normalizeCurrency(base);
    const to = normalizeCurrency(quote);
    if (from === to) {
      return {
        base: from,
        quote: to,
        rate: { numerator: 1n, denominator: 1n },
        asOf,
        source: "identity",
      };
    }

    const direct = this.#latest((rate) => rate.base === from && rate.quote === to, asOf);
    if (direct) return direct;

    const inverse = this.#latest((rate) => rate.base === to && rate.quote === from, asOf);
    return inverse ? invert(inverse) : null;
  }

  convert(amount: Money, quote: string, asOf: string): Money {
    const rate = this.lookup(amount.currency, quote, asOf);
    if (!rate) {
      throw new FxError(
        "MISSING_RATE",
        `No ${amount.currency}/${quote} rate available on or before ${asOf}`,
      );
    }
    if (rate.base === rate.quote) return money(amount.amount, quote);
    return convert(amount, rate);
  }

  #latest(predicate: (rate: FxRate) => boolean, asOf: string): FxRate | null {
    let best: FxRate | null = null;
    for (const rate of this.#rates) {
      if (!predicate(rate)) continue;
      if (rate.asOf > asOf) continue;
      if (best === null || rate.asOf > best.asOf) best = rate;
    }
    return best;
  }
}

export function convertOrThrow(amount: Money, rate: FxRate): Money {
  if (amount.currency === rate.quote) return money(amount.amount, rate.quote);
  return convert(amount, rate);
}
