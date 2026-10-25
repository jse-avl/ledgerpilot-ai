/**
 * Money is stored as an integer number of minor units plus an ISO-4217 currency.
 * Floats never touch an amount: they only appear as decimal *rates*, and those are
 * converted to exact rationals before any arithmetic (see fx.ts).
 *
 * `number` is safe here because Number.MAX_SAFE_INTEGER (9.007e15) in minor units
 * is ~90 trillion USD with 2 decimals. Values outside that range are rejected
 * instead of being silently rounded.
 */

export type MoneyErrorCode =
  | "INVALID_AMOUNT"
  | "INVALID_CURRENCY"
  | "CURRENCY_MISMATCH"
  | "EMPTY_AMOUNT"
  | "MALFORMED_AMOUNT"
  | "AMBIGUOUS_AMOUNT"
  | "TOO_MANY_DECIMALS"
  | "AMOUNT_OUT_OF_RANGE"
  | "INVALID_WEIGHT"
  | "INVALID_DIVISOR";

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

export interface Money {
  readonly amount: number;
  readonly currency: string;
}

/**
 * Minor-unit exponents for currencies we expect in LATAM/global AP flows.
 * Unknown but well-formed codes default to 2, which is the ISO-4217 norm.
 */
const CURRENCY_DIGITS: Readonly<Record<string, number>> = {
  USD: 2,
  EUR: 2,
  GBP: 2,
  CHF: 2,
  CAD: 2,
  AUD: 2,
  PAB: 2,
  MXN: 2,
  CNY: 2,
  BRL: 2,
  COP: 2,
  PEN: 2,
  ARS: 2,
  CLP: 0,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  TND: 3,
};

const CURRENCY_RE = /^[A-Z]{3}$/;

export function normalizeCurrency(currency: string): string {
  const code = currency.trim().toUpperCase();
  if (!CURRENCY_RE.test(code)) {
    throw new MoneyError("INVALID_CURRENCY", `Invalid ISO-4217 currency: "${currency}"`);
  }
  return code;
}

export function minorUnitDigits(currency: string): number {
  return CURRENCY_DIGITS[normalizeCurrency(currency)] ?? 2;
}

export function money(amount: number, currency: string): Money {
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new MoneyError(
      "INVALID_AMOUNT",
      `Money must be an integer number of minor units, received ${String(amount)}`,
    );
  }
  if (!Number.isSafeInteger(amount)) {
    throw new MoneyError("AMOUNT_OUT_OF_RANGE", `Amount ${amount} exceeds safe integer range`);
  }
  return Object.freeze({ amount, currency: normalizeCurrency(currency) });
}

export function zero(currency: string): Money {
  return money(0, currency);
}

export function isMoney(value: unknown): value is Money {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { amount?: unknown; currency?: unknown };
  return (
    typeof candidate.amount === "number" &&
    Number.isSafeInteger(candidate.amount) &&
    typeof candidate.currency === "string" &&
    CURRENCY_RE.test(candidate.currency)
  );
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new MoneyError(
      "CURRENCY_MISMATCH",
      `Cannot combine ${a.currency} with ${b.currency}; convert explicitly first`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function negate(a: Money): Money {
  return money(-a.amount, a.currency);
}

export function abs(a: Money): Money {
  return money(Math.abs(a.amount), a.currency);
}

export function sum(amounts: readonly Money[], currency?: string): Money {
  if (amounts.length === 0) {
    if (!currency) {
      throw new MoneyError("INVALID_CURRENCY", "sum() of an empty list requires a currency");
    }
    return zero(currency);
  }
  const [first, ...rest] = amounts;
  if (!first) return zero(currency ?? "USD");
  let total = first;
  for (const item of rest) total = add(total, item);
  return total;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amount < b.amount) return -1;
  if (a.amount > b.amount) return 1;
  return 0;
}

export function equals(a: Money, b: Money): boolean {
  return a.currency === b.currency && a.amount === b.amount;
}

export function isZero(a: Money): boolean {
  return a.amount === 0;
}

export function isNegative(a: Money): boolean {
  return a.amount < 0;
}

/**
 * Banker's rounding (half to even) on an exact rational. Financial reporting
 * standards prefer this over half-up because it avoids systematic upward bias.
 */
export function divRoundHalfEven(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) {
    throw new MoneyError("INVALID_DIVISOR", "Division by zero");
  }
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const quotient = n / d;
  const remainder = n % d;
  const doubled = remainder * 2n;
  let result = quotient;
  if (doubled > d || (doubled === d && quotient % 2n === 1n)) {
    result = quotient + 1n;
  }
  return negative ? -result : result;
}

export interface DecimalParts {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/**
 * Parses a decimal string/number into an exact rational. Exponent notation is
 * rejected so that a rate can never be silently reinterpreted.
 */
export function decimalToRational(value: string | number): DecimalParts {
  const raw = typeof value === "number" ? String(value) : value.trim();
  if (raw === "" || !/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new MoneyError("MALFORMED_AMOUNT", `Not a plain decimal: "${raw}"`);
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
  const denominator = 10n ** BigInt(fractionPart.length);
  const numerator = BigInt(integerPart + fractionPart);
  return {
    numerator: negative ? -numerator : numerator,
    denominator,
  };
}

/**
 * Multiplies an amount by a decimal factor, rounding half-to-even.
 * Used for tax rates, FX and quantity pricing.
 */
export function multiply(a: Money, factor: string | number): Money {
  const rate = decimalToRational(factor);
  const result = divRoundHalfEven(BigInt(a.amount) * rate.numerator, rate.denominator);
  return money(Number(result), a.currency);
}

/**
 * Distributes `total` across integer weights so the parts sum exactly to the
 * total. Uses the largest-remainder method with deterministic tie-breaking.
 * Negative totals are supported: the sign is applied after allocation.
 */
export function allocate(total: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) {
    throw new MoneyError("INVALID_WEIGHT", "allocate() requires at least one weight");
  }
  if (total.amount === 0) return weights.map(() => zero(total.currency));
  if (total.amount < 0) {
    return allocate(negate(total), weights).map(negate);
  }

  const scaled = weights.map((weight) => {
    if (!Number.isFinite(weight) || weight < 0) {
      throw new MoneyError("INVALID_WEIGHT", `Weight must be a finite non-negative number: ${weight}`);
    }
    return BigInt(Math.round(weight * 1_000_000));
  });
  const totalWeight = scaled.reduce((acc, weight) => acc + weight, 0n);
  if (totalWeight === 0n) {
    throw new MoneyError("INVALID_WEIGHT", "Weights must not sum to zero");
  }

  const totalMinor = BigInt(total.amount);
  const base = scaled.map((weight) => (totalMinor * weight) / totalWeight);
  const remainders = scaled.map((weight, index) => ({
    index,
    remainder: (totalMinor * weight) % totalWeight,
  }));

  let assigned = base.reduce((acc, part) => acc + part, 0n);
  const order = [...remainders].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });

  const parts = [...base];
  for (const { index } of order) {
    if (assigned >= totalMinor) break;
    parts[index] = (parts[index] ?? 0n) + 1n;
    assigned += 1n;
  }

  return parts.map((part) => money(Number(part), total.currency));
}

export function splitEvenly(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError("INVALID_DIVISOR", `parts must be a positive integer, received ${parts}`);
  }
  return allocate(
    total,
    Array.from({ length: parts }, () => 1),
  );
}

/**
 * Parses a human-entered amount ("$1,234.56", "1.234,56 €", "(45.00)", "12.5")
 * into exact minor units. Separator ambiguity is resolved conservatively and
 * anything genuinely ambiguous throws instead of guessing.
 */
export function parseAmount(input: string, currency: string): Money {
  const digits = minorUnitDigits(currency);
  let text = input.trim();
  if (text === "") {
    throw new MoneyError("EMPTY_AMOUNT", "Empty amount");
  }

  let negative = false;
  const parenthesized = /^\((.*)\)$/.exec(text);
  if (parenthesized?.[1] !== undefined) {
    negative = true;
    text = parenthesized[1].trim();
  }

  text = text.replace(/[^\d.,+-]/g, "");
  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }
  if (text.includes("-") || text === "") {
    throw new MoneyError("MALFORMED_AMOUNT", `Malformed amount: "${input}"`);
  }

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  let decimalIndex = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalIndex = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const separator = lastDot >= 0 ? "." : ",";
    const occurrences = text.split(separator).length - 1;
    const fraction = text.slice(text.lastIndexOf(separator) + 1);
    const integerPart = text.slice(0, text.lastIndexOf(separator));

    if (occurrences > 1) {
      decimalIndex = -1;
    } else if (fraction === "") {
      throw new MoneyError("MALFORMED_AMOUNT", `Trailing separator in "${input}"`);
    } else if (digits === 0) {
      if (fraction.length === 3 && integerPart !== "0") decimalIndex = -1;
      else throw new MoneyError("TOO_MANY_DECIMALS", `"${input}" has decimals but ${currency} has none`);
    } else if (fraction.length === digits) {
      decimalIndex = lastDot >= 0 ? lastDot : lastComma;
    } else if (integerPart === "0" || fraction.length < digits) {
      decimalIndex = lastDot >= 0 ? lastDot : lastComma;
    } else if (fraction.length === 3 && integerPart.length <= 3) {
      // "1,234" / "1.234" -> thousands separator
      decimalIndex = -1;
    } else {
      throw new MoneyError(
        "AMBIGUOUS_AMOUNT",
        `Ambiguous separator in "${input}" for ${currency}`,
      );
    }
  }

  const integerRaw =
    decimalIndex >= 0 ? text.slice(0, decimalIndex).replace(/[.,]/g, "") : text.replace(/[.,]/g, "");
  const fractionRaw = decimalIndex >= 0 ? text.slice(decimalIndex + 1).replace(/[.,]/g, "") : "";

  if (integerRaw === "" && fractionRaw === "") {
    throw new MoneyError("MALFORMED_AMOUNT", `No digits found in "${input}"`);
  }
  if (!/^\d*$/.test(integerRaw) || !/^\d*$/.test(fractionRaw)) {
    throw new MoneyError("MALFORMED_AMOUNT", `Malformed amount: "${input}"`);
  }

  let fraction = fractionRaw;
  if (fraction.length > digits) {
    const extra = fraction.slice(digits);
    if (extra.replace(/0/g, "") !== "") {
      throw new MoneyError(
        "TOO_MANY_DECIMALS",
        `"${input}" has more than ${digits} decimal places for ${currency}`,
      );
    }
    fraction = fraction.slice(0, digits);
  }
  fraction = fraction.padEnd(digits, "0");

  const scale = 10n ** BigInt(digits);
  const minor =
    BigInt(integerRaw === "" ? "0" : integerRaw) * scale + BigInt(fraction === "" ? "0" : fraction);
  const signed = negative ? -minor : minor;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new MoneyError("AMOUNT_OUT_OF_RANGE", `Amount "${input}" is too large`);
  }
  return money(Number(signed), currency);
}

export function toMajorString(a: Money): string {
  const digits = minorUnitDigits(a.currency);
  const negative = a.amount < 0;
  const absolute = Math.abs(a.amount);
  if (digits === 0) return `${negative ? "-" : ""}${absolute}`;
  const scale = 10 ** digits;
  const integerPart = Math.floor(absolute / scale);
  const fractionPart = String(absolute % scale).padStart(digits, "0");
  return `${negative ? "-" : ""}${integerPart}.${fractionPart}`;
}

export function format(a: Money, locale = "en-US"): string {
  const digits = minorUnitDigits(a.currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: a.currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(a.amount / 10 ** digits);
  } catch {
    return `${toMajorString(a)} ${a.currency}`;
  }
}

export function toWire(a: Money): Money {
  return money(a.amount, a.currency);
}
