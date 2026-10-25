import { createHash, randomUUID } from "node:crypto";

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

/**
 * Deterministic JSON used for hashing and signing. Object keys are sorted,
 * `undefined` is dropped from objects (like JSON.stringify) but rejected in
 * arrays, and every number must be finite.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, new Set());
}

function serialize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";

  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "number": {
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(`Non-finite number is not serializable: ${value}`);
      }
      return JSON.stringify(value);
    }
    case "bigint":
      throw new CanonicalJsonError("bigint is not supported in canonical JSON; pass a string");
    case "undefined":
      throw new CanonicalJsonError("undefined is not supported in canonical JSON");
    case "function":
    case "symbol":
      throw new CanonicalJsonError(`${typeof value} is not supported in canonical JSON`);
    case "object":
      break;
    default:
      throw new CanonicalJsonError(`Unsupported type: ${typeof value}`);
  }

  if (seen.has(value as object)) {
    throw new CanonicalJsonError("Circular reference detected");
  }
  seen.add(value as object);

  let output: string;
  if (Array.isArray(value)) {
    output = `[${value.map((item) => serialize(item, seen)).join(",")}]`;
  } else {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    output = `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${serialize(item, seen)}`)
      .join(",")}}`;
  }

  seen.delete(value as object);
  return output;
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

export function newNonce(): string {
  return randomUUID();
}

export function shortHash(hash: string): string {
  return hash.slice(0, 12);
}
