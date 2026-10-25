import { describe, expect, it } from "vitest";
import {
  MoneyError,
  add,
  allocate,
  divRoundHalfEven,
  format,
  money,
  multiply,
  parseAmount,
  splitEvenly,
  subtract,
  sum,
  toMajorString,
  zero,
} from "../src/money";

describe("money", () => {
  it("rejects non-integer minor units", () => {
    expect(() => money(12.5, "USD")).toThrow(MoneyError);
    expect(() => money(Number.NaN, "USD")).toThrow(MoneyError);
  });

  it("rejects invalid currency codes", () => {
    expect(() => money(100, "US")).toThrow(MoneyError);
    expect(() => money(100, "dollars")).toThrow(MoneyError);
  });

  it("normalizes currency casing", () => {
    expect(money(100, "usd").currency).toBe("USD");
  });

  it("refuses to mix currencies", () => {
    expect(() => add(money(100, "USD"), money(100, "EUR"))).toThrow(/CURRENCY_MISMATCH|Cannot combine/);
  });

  it("adds and subtracts exactly", () => {
    expect(add(money(1999, "USD"), money(1, "USD")).amount).toBe(2000);
    expect(subtract(money(2000, "USD"), money(1, "USD")).amount).toBe(1999);
  });

  it("sums an empty list only with an explicit currency", () => {
    expect(sum([], "USD")).toEqual(zero("USD"));
    expect(() => sum([])).toThrow(MoneyError);
  });
});

describe("parseAmount", () => {
  it.each([
    ["$1,234.56", "USD", 123456],
    ["1.234,56", "EUR", 123456],
    ["(45.00)", "USD", -4500],
    ["12.5", "USD", 1250],
    ["1,234", "USD", 123400],
    ["1.234", "EUR", 123400],
    ["1.234.567", "USD", 123456700],
    ["1,234", "JPY", 1234],
    ["0", "USD", 0],
    ["-0.01", "USD", -1],
  ])("parses %s in %s", (input, currency, expected) => {
    expect(parseAmount(input, currency).amount).toBe(expected);
  });

  it("rejects too many decimals instead of rounding silently", () => {
    expect(() => parseAmount("0.123", "USD")).toThrow(MoneyError);
  });

  it("rejects empty input", () => {
    expect(() => parseAmount("   ", "USD")).toThrow(MoneyError);
  });

  it("round-trips through toMajorString", () => {
    expect(toMajorString(money(123456, "USD"))).toBe("1234.56");
    expect(toMajorString(money(1234, "JPY"))).toBe("1234");
    expect(toMajorString(money(-5, "USD"))).toBe("-0.05");
  });
});

describe("rounding", () => {
  it("uses banker's rounding", () => {
    expect(divRoundHalfEven(5n, 2n)).toBe(2n);
    expect(divRoundHalfEven(7n, 2n)).toBe(4n);
    expect(divRoundHalfEven(-5n, 2n)).toBe(-2n);
    expect(divRoundHalfEven(-7n, 2n)).toBe(-4n);
    expect(divRoundHalfEven(1n, 3n)).toBe(0n);
  });

  it("multiplies by decimal rates", () => {
    expect(multiply(money(10_000, "USD"), "0.19").amount).toBe(1900);
    expect(multiply(money(333, "USD"), "1.5").amount).toBe(500);
  });
});

describe("allocate", () => {
  it("distributes cents without losing any", () => {
    expect(splitEvenly(money(5, "USD"), 3).map((part) => part.amount)).toEqual([2, 2, 1]);
  });

  it("preserves the total for arbitrary weights", () => {
    const parts = allocate(money(10_000, "USD"), [1, 2, 3]);
    expect(parts.map((part) => part.amount)).toEqual([1667, 3333, 5000]);
  });

  it("handles negative totals symmetrically", () => {
    const parts = allocate(money(-5, "USD"), [1, 1, 1]);
    expect(parts.map((part) => part.amount)).toEqual([-2, -2, -1]);
    expect(parts.reduce((acc, part) => acc + part.amount, 0)).toBe(-5);
  });

  it("rejects empty or zero-sum weights", () => {
    expect(() => allocate(money(100, "USD"), [])).toThrow(MoneyError);
    expect(() => allocate(money(100, "USD"), [0, 0])).toThrow(MoneyError);
    expect(() => allocate(money(100, "USD"), [-1])).toThrow(MoneyError);
  });
});

describe("format", () => {
  it("renders using the currency minor units", () => {
    expect(format(money(123456, "USD"))).toBe("$1,234.56");
    expect(format(money(1234, "JPY"), "en-US")).toBe("¥1,234");
  });
});
