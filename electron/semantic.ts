export const HASH_BIGRAM_PROVIDER_ID = "local-bigram-v1";

export interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(texts: readonly string[]): readonly number[][];
}

export class HashBigramEmbeddingProvider implements EmbeddingProvider {
  readonly id = HASH_BIGRAM_PROVIDER_ID;

  constructor(readonly dimensions = 192) {
    if (!Number.isInteger(dimensions) || dimensions <= 0)
      throw new Error("嵌入向量维度必须是正整数");
  }

  embed(texts: readonly string[]) {
    return texts.map((text) => {
      const vector = new Array<number>(this.dimensions).fill(0);
      const normalized = text.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
      for (let index = 0; index < normalized.length - 1; index += 1) {
        const token = normalized.slice(index, index + 2);
        let hash = 2166136261;
        for (const char of token) {
          hash ^= char.codePointAt(0) ?? 0;
          hash = Math.imul(hash, 16777619);
        }
        vector[(hash >>> 0) % this.dimensions] += 1;
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0)) || 1;
      return vector.map((value) => value / norm);
    });
  }
}

export function validateEmbeddingVector(provider: EmbeddingProvider, vector: readonly number[]) {
  if (vector.length !== provider.dimensions)
    throw new Error(`嵌入向量维度不匹配：${provider.id} 应为 ${provider.dimensions} 维，实际为 ${vector.length} 维`);
  if (vector.some((value) => !Number.isFinite(value)))
    throw new Error(`嵌入向量包含无效数值：${provider.id}`);
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length)
    throw new Error(`不能比较不同维度的向量：${left.length} 与 ${right.length}`);
  let score = 0;
  for (let index = 0; index < left.length; index += 1) score += left[index] * right[index];
  return score;
}
