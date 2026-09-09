type SchemaNode = Record<string, unknown>;

function isSchemaNode(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 值是「schema 映射」的键（子 schema 以任意名字挂在其下）。 */
const SCHEMA_MAPS = new Set(["properties", "$defs", "definitions", "patternProperties", "dependentSchemas"]);
/** 值是「单个子 schema」的键。 */
const SCHEMA_SINGLES = new Set(["items", "contains", "not", "propertyNames", "if", "then", "else", "additionalItems"]);
/** 值是「子 schema 列表」的键。 */
const SCHEMA_LISTS = new Set(["anyOf", "oneOf", "allOf", "prefixItems"]);

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (!isSchemaNode(value)) return value;
  const next: SchemaNode = {};
  for (const [key, child] of Object.entries(value)) {
    if (SCHEMA_MAPS.has(key)) {
      next[key] = isSchemaNode(child)
        ? Object.fromEntries(Object.entries(child).map(([name, sub]) => [name, normalize(sub)]))
        : child;
      continue;
    }
    if (SCHEMA_SINGLES.has(key)) {
      next[key] = normalize(child);
      continue;
    }
    if (SCHEMA_LISTS.has(key)) {
      next[key] = Array.isArray(child) ? child.map(normalize) : child;
      continue;
    }
    next[key] = child;
  }
  if (isSchemaNode(next.properties)) {
    next.required = Object.keys(next.properties);
    next.additionalProperties = false;
  }
  return next;
}

/**
 * 把 JSON Schema 归一化成 OpenAI 严格结构化输出可接受的形态。
 *
 * 严格模式要求每个对象的 `required` 覆盖 `properties` 的全部键，而 zod 的 `.optional()`
 * 字段不会进入 `required`，直接发送会被接口以 400 拒绝（"Required properties must match
 * all properties in the object"）。归一化后可选字段在协议层变为必填，模型必须输出；
 * Zod 侧仍是可选，多出的字段不影响解析。
 */
export function toStrictJsonSchema(schema: unknown): unknown {
  return normalize(schema);
}
