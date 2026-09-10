import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as aiDefinitions from "../electron/ai-definitions";
import { toStrictJsonSchema } from "../src/shared/ai/strict-json-schema";

/** 严格模式要求：每个对象的 required 覆盖全部属性，且 additionalProperties 为 false。 */
function strictIssues(schema: unknown, path = "$"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => strictIssues(item, `${path}[${index}]`));
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Record<string, unknown>;
  const issues: string[] = [];
  if (typeof node.properties === "object" && node.properties !== null && !Array.isArray(node.properties)) {
    const keys = Object.keys(node.properties as Record<string, unknown>);
    const required = Array.isArray(node.required) ? (node.required as string[]) : [];
    const missing = keys.filter((key) => !required.includes(key));
    if (missing.length) issues.push(`${path}: required 缺少 ${missing.join(", ")}`);
    if (node.additionalProperties !== false) issues.push(`${path}: additionalProperties 必须是 false`);
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" || key === "$defs" || key === "definitions") {
      for (const [name, sub] of Object.entries(value as Record<string, unknown>))
        issues.push(...strictIssues(sub, `${path}.${key}.${name}`));
      continue;
    }
    if (["items", "anyOf", "oneOf", "allOf", "prefixItems", "not", "contains"].includes(key))
      issues.push(...strictIssues(value, `${path}.${key}`));
  }
  return issues;
}

function strictify(schema: z.ZodType) {
  const { $schema: _metaSchema, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return toStrictJsonSchema(rest) as Record<string, unknown>;
}

const exportedSchemas = Object.entries(aiDefinitions).filter(
  (entry): entry is [string, z.ZodType] =>
    typeof (entry[1] as { safeParse?: unknown } | undefined)?.safeParse === "function",
);

describe("toStrictJsonSchema", () => {
  it("把可选字段补进 required 并固定 additionalProperties", () => {
    const schema = z.toJSONSchema(
      z.object({
        requiredField: z.string(),
        optionalField: z.string().optional(),
      }),
    ) as Record<string, unknown>;
    const normalized = toStrictJsonSchema(schema) as {
      required: string[];
      additionalProperties: boolean;
    };
    expect(normalized.required).toEqual(["requiredField", "optionalField"]);
    expect(normalized.additionalProperties).toBe(false);
  });

  it("递归处理嵌套对象与对象数组", () => {
    const schema = z.toJSONSchema(
      z.object({
        sections: z.array(z.object({ label: z.string(), items: z.array(z.string()).optional() })).optional(),
      }),
    ) as Record<string, unknown>;
    expect(strictIssues(toStrictJsonSchema(schema))).toEqual([]);
  });

  it("拒绝无法表示为 strict schema 的 record 动态键", () => {
    const schema = z.toJSONSchema(z.record(z.string(), z.string())) as Record<string, unknown>;
    expect(() => toStrictJsonSchema(schema)).toThrow(/动态对象键/);
  });

  it("递归处理 nullable anyOf 分支与 $defs 引用目标", () => {
    const Entry = z.object({ label: z.string(), note: z.string().optional() });
    const schema = z.toJSONSchema(z.object({ entry: Entry.nullable(), duplicate: Entry }), { reused: "ref" }) as Record<
      string,
      unknown
    >;
    const normalized = toStrictJsonSchema(schema) as {
      properties: { entry: { anyOf: Array<{ $ref?: string } | { type?: string }> } };
      $defs: { __schema0: { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean } };
    };
    expect(normalized.properties.entry.anyOf.some((item) => item.$ref === "#/$defs/__schema0")).toBe(true);
    expect(normalized.$defs.__schema0.required).toEqual(Object.keys(normalized.$defs.__schema0.properties));
    expect(normalized.$defs.__schema0.additionalProperties).toBe(false);
    expect(strictIssues(normalized)).toEqual([]);
  });

  it("拒绝根级 nullable 或 union，避免 Responses API 的 strict 400", () => {
    const schema = z.toJSONSchema(z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]));
    expect(() => toStrictJsonSchema(schema)).toThrow(/根 schema 必须是对象/);
  });

  it("可重复归一化", () => {
    const schema = z.toJSONSchema(z.object({ a: z.string().optional() })) as Record<string, unknown>;
    const once = toStrictJsonSchema(schema);
    expect(toStrictJsonSchema(once)).toEqual(once);
  });
});

describe("结构化输出 schema 的严格模式兼容性", () => {
  it("至少覆盖到已知 schema（防止枚举失效）", () => {
    expect(exportedSchemas.length).toBeGreaterThanOrEqual(10);
    expect(exportedSchemas.map(([name]) => name)).toContain("BookConceptSkeletonSchema");
  });

  it.each(exportedSchemas)("%s 归一化后满足严格模式", (_name, schema) => {
    expect(strictIssues(strictify(schema))).toEqual([]);
  });

  it("BookConceptSkeletonSchema 的可选栏目进入 required（400 回归）", () => {
    const normalized = strictify(aiDefinitions.BookConceptSkeletonSchema) as { required: string[] };
    expect(normalized.required).toContain("genreSpecificSections");
  });
});
