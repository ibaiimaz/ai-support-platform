/** Only complete references in the original description are eligible, in first-seen order. */
export function extractIncidentReferences(description: string): string[] {
  const matches = description.matchAll(
    /(?<![\p{L}\p{M}\p{N}_-])inc-[1-9][0-9]{0,5}(?![\p{L}\p{M}\p{N}_-])/giu,
  );
  return [...new Set(Array.from(matches, (match) => match[0].replace(/^inc-/i, 'INC-')))];
}
