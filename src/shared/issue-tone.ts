export function issueTone(value: string): "danger" | "warning" | "neutral" {
  return value === "硬性" ? "danger" : value === "警告" ? "warning" : "neutral";
}
