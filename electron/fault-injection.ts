export type FaultPoint = "disk-full" | "power-loss-before-commit" | "credential-unavailable";

export function injectFault(point: FaultPoint) {
  if (process.env.NODE_ENV !== "test") return;
  const enabled = new Set((process.env.NOVEL_STUDIO_FAULTS ?? "").split(",").map((item) => item.trim()));
  if (!enabled.has(point)) return;
  if (point === "disk-full") throw Object.assign(new Error("ENOSPC: injected disk full"), { code: "ENOSPC" });
  if (point === "power-loss-before-commit") throw new Error("injected power loss before commit");
  throw new Error("injected credential service unavailable");
}
