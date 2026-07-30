export interface ParagraphDiffEntry {
  kind: "未变" | "新增" | "删除";
  text: string;
}

const paragraphs = (value: string) => value.split(/\n+/).map((item) => item.trim()).filter(Boolean);

export function diffParagraphs(before: string, after: string): ParagraphDiffEntry[] {
  const left = paragraphs(before);
  const right = paragraphs(after);
  const rows = left.length + 1;
  const columns = right.length + 1;
  const table = Array.from({ length: rows }, () => new Uint16Array(columns));
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      table[row][column] = left[row] === right[column]
        ? table[row + 1][column + 1] + 1
        : Math.max(table[row + 1][column], table[row][column + 1]);
    }
  }
  const result: ParagraphDiffEntry[] = [];
  let row = 0;
  let column = 0;
  while (row < left.length || column < right.length) {
    if (row < left.length && column < right.length && left[row] === right[column]) {
      result.push({ kind: "未变", text: left[row] });
      row += 1;
      column += 1;
    } else if (column < right.length && (row >= left.length || table[row][column + 1] >= table[row + 1][column])) {
      result.push({ kind: "新增", text: right[column] });
      column += 1;
    } else {
      result.push({ kind: "删除", text: left[row] });
      row += 1;
    }
  }
  return result;
}
