/**
 * 从流式 JSON 文本中增量抽取某个字符串字段的值。
 * 迁移自 electron/ai-provider.ts，行为保持不变；P2 会泛化为任意字段/数组项。
 */
export class JsonStringFieldExtractor {
  private searchBuffer = "";
  private started = false;
  private finished = false;
  private escaped = false;
  private unicodeDigits: string | null = null;

  constructor(
    private readonly field: string,
    private readonly onValue: (delta: string) => void,
  ) {}

  push(fragment: string) {
    if (this.finished || !fragment) return;
    if (!this.started) {
      this.searchBuffer += fragment;
      const match = new RegExp(`"${this.field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*"`).exec(
        this.searchBuffer,
      );
      if (!match) {
        this.searchBuffer = this.searchBuffer.slice(-Math.max(256, this.field.length + 16));
        return;
      }
      this.started = true;
      fragment = this.searchBuffer.slice((match.index ?? 0) + match[0].length);
      this.searchBuffer = "";
    }

    let decoded = "";
    for (const character of fragment) {
      if (this.unicodeDigits !== null) {
        this.unicodeDigits += character;
        if (this.unicodeDigits.length === 4) {
          decoded += String.fromCharCode(Number.parseInt(this.unicodeDigits, 16));
          this.unicodeDigits = null;
        }
        continue;
      }
      if (this.escaped) {
        this.escaped = false;
        if (character === "u") this.unicodeDigits = "";
        else
          decoded +=
            ({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" } as Record<string, string>)[character] ?? character;
        continue;
      }
      if (character === "\\") this.escaped = true;
      else if (character === '"') {
        this.finished = true;
        break;
      } else decoded += character;
    }
    if (decoded) this.onValue(decoded);
  }
}
