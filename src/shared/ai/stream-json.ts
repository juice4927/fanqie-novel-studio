/**
 * 把 "content" / "chapters[].content" 这样的路径展开成段序列，
 * 数组元素用 "[]" 表示。不支持下标数字与通配符。
 */
export function parseJsonPath(path: string): string[] {
  const segments: string[] = [];
  let current = "";
  for (let index = 0; index < path.length; index += 1) {
    const char = path[index];
    if (char === "[") {
      if (current.trim()) {
        segments.push(current.trim());
        current = "";
      }
      if (path[index + 1] !== "]") throw new Error(`不支持的路径下标：${path}`);
      segments.push("[]");
      index += 1;
    } else if (char === ".") {
      if (current.trim()) {
        segments.push(current.trim());
        current = "";
      }
    } else current += char;
  }
  if (current.trim()) segments.push(current.trim());
  if (!segments.length) throw new Error("流式字段路径不能为空");
  return segments;
}

const STRING_ESCAPES: Record<string, string> = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * 从流式 JSON 里增量抽取任意路径的字符串值：
 * - 顶层字段：`content`
 * - 数组元素字段：`chapters[].content`（取第一个匹配元素）
 * 只做增量扫描，不缓存完整文档；键字符串不会被误当成值。
 */
export class JsonPathStreamExtractor {
  private readonly target: string[];
  private readonly onValue: (delta: string) => void;
  private expect: "key" | "value" | "none" = "none";
  private readonly stack: Array<{ array: boolean; key: string | null }> = [];
  private pendingKey: string | null = null;
  private inString = false;
  private stringIsValue = false;
  private escaped = false;
  private unicode: string | null = null;
  private decodedKey = "";
  private capturing = false;
  private pending = "";
  private finished = false;

  constructor(path: string, onValue: (delta: string) => void) {
    this.target = parseJsonPath(path);
    this.onValue = onValue;
  }

  push(fragment: string) {
    if (this.finished || !fragment) return;
    for (const char of fragment) {
      if (this.finished) break;
      this.step(char);
    }
  }

  private currentPath() {
    const path: string[] = [];
    for (const entry of this.stack) {
      if (entry.key !== null) path.push(entry.key);
      if (entry.array) path.push("[]");
    }
    if (this.pendingKey !== null) path.push(this.pendingKey);
    return path;
  }

  private matchesTarget() {
    const path = this.currentPath();
    return path.length === this.target.length && path.every((segment, index) => segment === this.target[index]);
  }

  private flush() {
    if (!this.pending) return;
    const delta = this.pending;
    this.pending = "";
    this.onValue(delta);
  }

  private emit(value: string) {
    if (!this.capturing) return;
    this.pending += value;
    if (this.pending.length >= 64) this.flush();
  }

  private step(char: string) {
    if (this.inString) {
      this.readStringChar(char);
      return;
    }
    if (char === '"') {
      if (this.expect === "value") {
        this.inString = true;
        this.stringIsValue = true;
        this.capturing = this.matchesTarget();
        this.escaped = false;
        this.unicode = null;
        return;
      }
      this.inString = true;
      this.stringIsValue = false;
      this.decodedKey = "";
      this.escaped = false;
      this.unicode = null;
      return;
    }
    if (char === "{" || char === "[") {
      this.stack.push({ array: char === "[", key: this.pendingKey });
      this.pendingKey = null;
      this.expect = char === "{" ? "key" : "value";
      return;
    }
    if (char === "}" || char === "]") {
      this.stack.pop();
      this.pendingKey = null;
      this.expect = "none";
      return;
    }
    if (char === ":") {
      this.expect = "value";
      return;
    }
    if (char === ",") {
      this.expect = this.stack.at(-1)?.array ? "value" : "key";
      this.pendingKey = null;
      return;
    }
    if (this.expect === "value" && !/\s/.test(char)) this.expect = "none";
  }

  private readStringChar(char: string) {
    if (this.unicode !== null) {
      this.unicode += char;
      if (this.unicode.length === 4) {
        this.emit(String.fromCharCode(Number.parseInt(this.unicode, 16)));
        this.unicode = null;
      }
      return;
    }
    if (this.escaped) {
      this.escaped = false;
      if (char === "u") {
        this.unicode = "";
        return;
      }
      this.emitOrDecode(STRING_ESCAPES[char] ?? char);
      return;
    }
    if (char === "\\") {
      this.escaped = true;
      return;
    }
    if (char === '"') {
      this.inString = false;
      if (this.stringIsValue) {
        this.flush();
        if (this.capturing) this.finished = true;
        this.capturing = false;
        this.expect = "none";
      } else {
        this.pendingKey = this.decodedKey;
        this.decodedKey = "";
        this.expect = "none";
      }
      return;
    }
    this.emitOrDecode(char);
  }

  private emitOrDecode(char: string) {
    if (this.stringIsValue) this.emit(char);
    else this.decodedKey += char;
  }
}
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
