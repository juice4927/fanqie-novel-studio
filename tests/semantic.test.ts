import { describe, expect, it } from "vitest";
import {
  cosineSimilarity,
  HashBigramEmbeddingProvider,
  validateEmbeddingVector,
  type EmbeddingProvider,
} from "../electron/semantic";

describe("embedding providers", () => {
  it("creates deterministic normalized vectors through the default provider", () => {
    const provider = new HashBigramEmbeddingProvider(32);
    const [first, second] = provider.embed(["北仓控制方", "北仓控制方"]);

    expect(provider.id).toBe("local-bigram-v1");
    expect(first).toHaveLength(32);
    expect(second).toEqual(first);
    expect(Math.sqrt(first.reduce((sum, value) => sum + value * value, 0))).toBeCloseTo(1);
  });

  it("rejects provider output and similarity comparisons with mismatched dimensions", () => {
    const provider: EmbeddingProvider = { id: "broken-v1", dimensions: 3, embed: () => [[1, 0]] };
    expect(() => validateEmbeddingVector(provider, provider.embed(["test"])[0])).toThrow("维度不匹配");
    expect(() => cosineSimilarity([1, 0, 0], [1, 0])).toThrow("不同维度");
  });
});
