import { describe, expect, it } from "vitest";
import { JsonPathStreamExtractor, parseJsonPath } from "../src/shared/ai/stream-json";

function collect(path: string, chunks: string[]) {
  let output = "";
  const extractor = new JsonPathStreamExtractor(path, (delta) => {
    output += delta;
  });
  for (const chunk of chunks) extractor.push(chunk);
  return output;
}

describe("流式 JSON 路径提取", () => {
  it("顶层字段可跨任意分片解码", () => {
    const value = '正文带"引号"和\\反斜杠\n换行';
    const raw = JSON.stringify({ title: "标题", content: value });
    expect(collect("content", [raw])).toBe(value);
    expect(collect("content", [...raw])).toBe(value);
    expect(collect("content", [raw.slice(0, 7), raw.slice(7)])).toBe(value);
  });

  it("键名不会误匹配成值", () => {
    expect(collect("content", [JSON.stringify({ contentName: "x", content: "y" })])).toBe("y");
  });

  it("支持数组元素字段", () => {
    const raw = JSON.stringify({
      chapters: [
        { ordinal: 1, content: "第一章" },
        { ordinal: 2, content: "第二章" },
      ],
    });
    expect(collect("chapters[].content", [raw])).toBe("第一章");
  });

  it("支持嵌套对象路径与 unicode 转义", () => {
    expect(collect("a.b.content", [JSON.stringify({ a: { b: { content: "深层" } } })])).toBe("深层");
    expect(collect("content", ['{"content":"\\u4f60\\u597d"}'])).toBe("你好");
  });

  it("目标值缺失时返回空串", () => {
    expect(collect("content", [JSON.stringify({ title: "只有标题" })])).toBe("");
    expect(collect("chapters[].content", [JSON.stringify({ chapters: [] })])).toBe("");
  });

  it("parseJsonPath 解析并拒绝非法下标", () => {
    expect(parseJsonPath("content")).toEqual(["content"]);
    expect(parseJsonPath("chapters[].content")).toEqual(["chapters", "[]", "content"]);
    expect(() => parseJsonPath("chapters[0].content")).toThrow(/下标/);
    expect(() => parseJsonPath("")).toThrow(/不能为空/);
  });
});
