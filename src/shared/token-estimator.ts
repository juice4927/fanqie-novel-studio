export const TOKEN_ESTIMATE_WARNING = "粗略估算，误差可能超过 ±50%";
export const STRUCTURED_REQUEST_OVERHEAD_TOKENS = 320;

const CJK_CHARACTER = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const LATIN_OR_DIGIT = /[\p{Script=Latin}\p{Number}_]/u;

export function estimateTextTokens(text: string) {
  let cjkCharacters = 0;
  let latinCharacters = 0;
  let otherCharacters = 0;
  for (const character of text.normalize("NFKC")) {
    if (/\s/u.test(character)) continue;
    if (CJK_CHARACTER.test(character)) cjkCharacters += 1;
    else if (LATIN_OR_DIGIT.test(character)) latinCharacters += 1;
    else otherCharacters += 1;
  }
  const estimate = cjkCharacters + Math.ceil(latinCharacters / 4) + Math.ceil(otherCharacters / 3);
  return text.trim() ? Math.max(1, estimate) : 0;
}

export function estimateCjkTextTokens(characterCount: number) {
  return Number.isFinite(characterCount) ? Math.max(0, Math.ceil(characterCount)) : 0;
}

export function estimateStructuredRequestTokens(
  textParts: readonly string[],
  overheadTokens = STRUCTURED_REQUEST_OVERHEAD_TOKENS,
) {
  return Math.max(0, Math.ceil(overheadTokens)) + textParts.reduce((sum, part) => sum + estimateTextTokens(part), 0);
}

export function estimateChapterOutputTokens(targetCharacters: number) {
  const characters = Number.isFinite(targetCharacters) ? Math.max(0, Math.ceil(targetCharacters)) : 0;
  return characters + 80;
}
