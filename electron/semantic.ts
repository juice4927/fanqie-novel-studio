export function localEmbedding(text: string, dimensions = 192) {
  const vector = new Array<number>(dimensions).fill(0);
  const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const token = normalized.slice(index, index + 2);
    let hash = 2166136261;
    for (const char of token) {
      hash ^= char.codePointAt(0) ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    vector[Math.abs(hash) % dimensions] += 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
  return vector.map((value) => value / norm);
}

export function cosineSimilarity(left: number[], right: number[]) {
  const length = Math.min(left.length, right.length);
  let score = 0;
  for (let index = 0; index < length; index += 1) score += left[index] * right[index];
  return score;
}
