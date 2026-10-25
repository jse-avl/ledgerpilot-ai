export type ExtractionMethod = "heuristic" | "ocr" | "llm";

export interface ExtractedField<T> {
  readonly value: T | null;
  /** Confidence in basis points (0-10000). */
  readonly confidenceBp: number;
  readonly snippet: string | null;
  readonly page: number | null;
  readonly method: ExtractionMethod;
}

export interface ExtractedMoney {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface ExtractedLine {
  readonly description: string;
  readonly quantityMilli: number | null;
  readonly unitPriceMinor: number | null;
  readonly totalMinor: number | null;
  readonly confidenceBp: number;
}

export interface InvoiceExtraction {
  readonly method: ExtractionMethod;
  readonly fields: {
    readonly invoiceNumber: ExtractedField<string>;
    readonly vendorName: ExtractedField<string>;
    readonly issueDate: ExtractedField<string>;
    readonly dueDate: ExtractedField<string>;
    readonly currency: ExtractedField<string>;
    readonly subtotal: ExtractedField<ExtractedMoney>;
    readonly tax: ExtractedField<ExtractedMoney>;
    readonly total: ExtractedField<ExtractedMoney>;
  };
  readonly lines: readonly ExtractedLine[];
  readonly warnings: readonly string[];
  /** Security signals. Never instructions to follow. */
  readonly riskFlags: readonly string[];
  readonly injectionMatches: readonly string[];
}

export interface InjectionScan {
  readonly riskFlags: readonly string[];
  readonly matches: readonly string[];
}
