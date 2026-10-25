import { describe, expect, it } from "vitest";
import { money } from "../src/money";
import { FxError, RateTable, convert, fxRate, invert, parseRate } from "../src/fx";

describe("fx rates", () => {
  const usdEur = fxRate({
    base: "USD",
    quote: "EUR",
    rate: "0.92",
    asOf: "2026-03-01",
    source: "test",
  });

  it("converts between currencies with different minor units", () => {
    expect(convert(money(10_000, "USD"), usdEur).amount).toBe(9200);
    expect(convert(money(10_000, "USD"), usdEur).currency).toBe("EUR");
  });

  it("handles zero-decimal currencies", () => {
    const jpyUsd = fxRate({ base: "JPY", quote: "USD", rate: "0.0067", asOf: "2026-03-01" });
    expect(convert(money(10_000, "JPY"), jpyUsd).amount).toBe(6700);
  });

  it("inverts exactly", () => {
    const eurUsd = invert(usdEur);
    expect(convert(money(9200, "EUR"), eurUsd).amount).toBe(10_000);
  });

  it("rejects converting through the wrong base", () => {
    expect(() => convert(money(100, "GBP"), usdEur)).toThrow(FxError);
  });

  it("rejects non-positive rates", () => {
    expect(() => parseRate("0")).toThrow(FxError);
    expect(() => parseRate("-1.2")).toThrow(FxError);
    expect(() => parseRate("abc")).toThrow(FxError);
  });
});

describe("RateTable", () => {
  const table = new RateTable([
    fxRate({ base: "USD", quote: "EUR", rate: "0.90", asOf: "2026-01-01" }),
    fxRate({ base: "USD", quote: "EUR", rate: "0.95", asOf: "2026-02-01" }),
  ]);

  it("uses the latest rate on or before the requested date", () => {
    const january = table.lookup("USD", "EUR", "2026-01-15");
    expect(january?.rate).toEqual({ numerator: 90n, denominator: 100n });

    const march = table.lookup("USD", "EUR", "2026-03-10");
    expect(march?.rate).toEqual({ numerator: 95n, denominator: 100n });
  });

  it("returns null when there is no rate yet", () => {
    expect(table.lookup("USD", "EUR", "2025-12-31")).toBeNull();
  });

  it("inverts when only the opposite pair exists", () => {
    const converted = table.convert(money(95_00, "EUR"), "USD", "2026-03-01");
    expect(converted.amount).toBe(100_00);
  });

  it("throws a typed error instead of guessing", () => {
    expect(() => table.convert(money(100, "USD"), "EUR", "2025-01-01")).toThrow(
      /MISSING_RATE|No USD\/EUR/,
    );
  });

  it("is identity for the same currency", () => {
    expect(table.convert(money(1234, "USD"), "USD", "2026-03-01").amount).toBe(1234);
  });
});
