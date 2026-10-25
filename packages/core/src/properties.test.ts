import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { add, allocate, money, parseAmount, splitEvenly, subtract, toMajorString } from "../src/money";
import { convert, fxRate } from "../src/fx";

const amount = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });
const weights = fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 6 });

describe("money properties", () => {
  it("addition then subtraction is the identity", () => {
    fc.assert(
      fc.property(amount, amount, (a, b) => {
        const result = subtract(add(money(a, "USD"), money(b, "USD")), money(b, "USD"));
        expect(result.amount).toBe(a);
      }),
    );
  });

  it("allocation never loses or invents minor units", () => {
    fc.assert(
      fc.property(amount, weights, (total, parts) => {
        const allocated = allocate(money(total, "USD"), parts);
        const sum = allocated.reduce((acc, part) => acc + part.amount, 0);
        expect(sum).toBe(total);
        expect(allocated).toHaveLength(parts.length);
      }),
    );
  });

  it("even splits differ by at most one minor unit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100_000 }), fc.integer({ min: 1, max: 12 }), (total, parts) => {
        const allocated = splitEvenly(money(total, "USD"), parts);
        const amounts = allocated.map((part) => part.amount);
        expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(1);
        expect(amounts.reduce((acc, value) => acc + value, 0)).toBe(total);
      }),
    );
  });

  it("round-trips through the major-unit representation", () => {
    fc.assert(
      fc.property(amount, (value) => {
        expect(parseAmount(toMajorString(money(value, "USD")), "USD").amount).toBe(value);
      }),
    );
  });
});

describe("fx properties", () => {
  const rate = fxRate({ base: "USD", quote: "EUR", rate: "0.9237", asOf: "2026-03-01" });

  it("is monotonic in the source amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000_000 }),
        fc.integer({ min: 0, max: 1_000_000_000 }),
        (a, b) => {
          const [low, high] = a <= b ? [a, b] : [b, a];
          expect(convert(money(low, "USD"), rate).amount).toBeLessThanOrEqual(
            convert(money(high, "USD"), rate).amount,
          );
        },
      ),
    );
  });

  it("keeps the destination currency", () => {
    fc.assert(
      fc.property(amount, (value) => {
        expect(convert(money(value, "USD"), rate).currency).toBe("EUR");
      }),
    );
  });
});
