const INJECTION_PATTERNS: readonly { pattern: RegExp; label: string }[] = [
  { pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/i, label: "ignore_instructions" },
  { pattern: /disregard\s+(the\s+)?(system|previous|above)/i, label: "disregard_instructions" },
  { pattern: /ignora\s+(las\s+)?instrucciones/i, label: "ignore_instructions_es" },
  { pattern: /olvida\s+(las\s+)?instrucciones/i, label: "ignore_instructions_es" },
  { pattern: /you\s+are\s+now\s+(a|an|the)\b/i, label: "role_override" },
  { pattern: /system\s+prompt/i, label: "system_prompt_probe" },
  { pattern: /<\/?\s*(system|assistant|developer)\s*>/i, label: "fake_role_tag" },
  {
    pattern: /(approve|pay|execute|transfer)\s+(this|the)\s+(invoice|payment|transfer)\s+(immediately|now|without)/i,
    label: "forced_action",
  },
  {
    pattern: /no\s+requiere\s+aprobaci[oó]n|skip\s+(the\s+)?approval/i,
    label: "approval_bypass",
  },
];

/**
 * Document text is data, never instructions. This scan surfaces attempts to
 * steer the agent and is used to (a) flag the document, (b) force human review
 * and (c) deny any write proposal, regardless of what the text asks for.
 */
export function scanForInjection(text: string): {
  riskFlags: string[];
  matches: string[];
} {
  const matches: string[] = [];
  const flags = new Set<string>();

  for (const { pattern, label } of INJECTION_PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      flags.add("untrusted_instruction");
      matches.push(`${label}: "${match[0]}"`);
    }
  }

  return { riskFlags: [...flags], matches };
}
