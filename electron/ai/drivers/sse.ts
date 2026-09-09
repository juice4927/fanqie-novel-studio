/**
 * 统一 SSE 换行：`\r\n` 与裸 `\r` 都归一为 `\n`；
 * 末尾孤立的 `\r` 留给下一块，避免把 `\r\n` 拆成两个事件。
 */
export function normalizeSseText(text: string) {
  const trailing = text.endsWith("\r") ? "\r" : "";
  const body = trailing ? text.slice(0, -1) : text;
  return `${body.replace(/\r\n/g, "\n").replace(/\r/g, "\n")}${trailing}`;
}

/**
 * 解析一个 SSE 事件块；兼容多行 data、被网络切开的 JSON 与 [DONE]。
 * 三级兜底：逐行独立解析 → 无分隔拼接（字符串中间被切开）→ 换行拼接（多行 JSON）。
 */
export function parseSseData(event: string) {
  const values = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    // 只按 SSE 规范去掉冒号后的一个空格；整体 trim 会吞掉被切开的 JSON 中间的空格。
    .map((line) => line.slice(5).replace(/^ /, ""))
    .filter((value) => value.trim() && value.trim() !== "[DONE]");
  if (!values.length) return [];
  const independentlyParsed: unknown[] = [];
  try {
    for (const value of values) independentlyParsed.push(JSON.parse(value));
    return independentlyParsed;
  } catch {
    /* 多行 data 属于同一个 JSON，继续尝试整体解析 */
  }
  try {
    return [JSON.parse(values.join(""))];
  } catch {
    return [JSON.parse(values.join("\n"))];
  }
}
