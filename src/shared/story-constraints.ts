import type { Chapter, LedgerFact } from "./types";

export interface StoryConstraintFinding {
  id: string;
  severity: "硬性" | "警告";
  category: "状态冲突" | "资源守恒" | "知识边界";
  message: string;
  evidence: string;
  factIds: string[];
}

const compact = (value: string) => value.replace(/\s+/g, "");
const activeAt = (fact: LedgerFact, chapterNumber: number) =>
  fact.validFromChapter <= chapterNumber && (fact.validToChapter === null || fact.validToChapter >= chapterNumber);

const CHINESE_DIGITS: Record<string, number> = {
  零: 0,
  〇: 0,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

export function parseStoryNumber(value: string): number | null {
  const arabic = value.match(/\d+(?:\.\d+)?\s*([十百千万亿])?/);
  if (arabic) {
    const multiplier = { 十: 10, 百: 100, 千: 1_000, 万: 10_000, 亿: 100_000_000 }[arabic[1] ?? ""] ?? 1;
    return Number(arabic[0].match(/\d+(?:\.\d+)?/)![0]) * multiplier;
  }
  const text = value.match(/[零〇一二两三四五六七八九十百千万]+/)?.[0];
  if (!text) return null;
  let total = 0;
  let section = 0;
  let digit = 0;
  for (const char of text) {
    if (char in CHINESE_DIGITS) digit = CHINESE_DIGITS[char];
    else if (char === "十" || char === "百" || char === "千") {
      const unit = char === "十" ? 10 : char === "百" ? 100 : 1000;
      section += (digit || 1) * unit;
      digit = 0;
    } else if (char === "万") {
      total += (section + digit || 1) * 10_000;
      section = 0;
      digit = 0;
    }
  }
  const omittedTail = text.match(/万([一二两三四五六七八九])$/);
  if (omittedTail && !text.includes("零")) return total + section + CHINESE_DIGITS[omittedTail[1]] * 1_000;
  return total + section + digit;
}

function resourceLabel(fact: LedgerFact) {
  const clean = (value: string) =>
    compact(value)
      .replace(/[零〇一二两三四五六七八九十百千万\d.,，.]/g, "")
      .replace(/余额|数量|库存|剩余|现有|持有|当前|仅|共|为/g, "")
      .replace(/枚|块|个|份|张|瓶|斤|两|元/g, "");
  return clean(fact.predicate) || clean(fact.value);
}

export function evaluateStoryConstraints(
  facts: readonly LedgerFact[],
  chapter: Pick<Chapter, "number" | "outline">,
): StoryConstraintFinding[] {
  const active = facts.filter((fact) => activeAt(fact, chapter.number));
  const findings: StoryConstraintFinding[] = [];
  const seen = new Set<string>();
  const add = (finding: StoryConstraintFinding) => {
    const key = `${finding.category}:${finding.factIds.slice().sort().join(",")}:${finding.message}`;
    if (!seen.has(key)) {
      seen.add(key);
      findings.push(finding);
    }
  };

  for (const fact of active.filter((item) => item.confidence === "有冲突")) {
    add({
      id: `conflict:${fact.id}`,
      severity: "硬性",
      category: "状态冲突",
      message: `${fact.subject} 的“${fact.predicate}”存在未解决冲突`,
      evidence: `${fact.value}（证据第${fact.evidenceChapter}章）`,
      factIds: [fact.id],
    });
  }

  const confirmed = active.filter((fact) => fact.confidence === "已确认");
  const propertyGroups = new Map<string, LedgerFact[]>();
  for (const fact of confirmed) {
    const key = `${fact.subject}\u0000${fact.predicate}`;
    propertyGroups.set(key, [...(propertyGroups.get(key) ?? []), fact]);
  }
  for (const group of propertyGroups.values()) {
    const values = new Set(group.map((fact) => compact(fact.value)));
    if (values.size <= 1) continue;
    add({
      id: `overlap:${group
        .map((fact) => fact.id)
        .sort()
        .join(":")}`,
      severity: "硬性",
      category: "状态冲突",
      message: `${group[0].subject} 的“${group[0].predicate}”在第${chapter.number}章同时存在多个已确认值`,
      evidence: group.map((fact) => `${fact.value}（第${fact.evidenceChapter}章）`).join("；"),
      factIds: group.map((fact) => fact.id),
    });
  }

  const spendPattern =
    /(?:消耗|支付|花费|交出|用掉|扣除)(?:了)?([零〇一二两三四五六七八九十百千万\d.]+)(枚|块|个|份|张|瓶|斤|两|元)?([\p{Script=Han}]{1,10})?/gu;
  const spends = [...chapter.outline.matchAll(spendPattern)];
  for (const fact of confirmed.filter((item) => item.kind === "资源")) {
    const available = parseStoryNumber(fact.value);
    const label = resourceLabel(fact);
    if (available === null || !label) continue;
    for (const spend of spends) {
      const amount = parseStoryNumber(spend[1]);
      const describedResource = compact(`${spend[2] ?? ""}${spend[3] ?? ""}`);
      if (
        amount === null ||
        amount <= available ||
        (!describedResource.includes(label) && !label.includes(describedResource))
      )
        continue;
      add({
        id: `resource:${fact.id}:${spend.index}`,
        severity: "硬性",
        category: "资源守恒",
        message: `${fact.subject} 计划支出 ${amount}，超过当前可用数量 ${available}`,
        evidence: `${fact.subject}｜${fact.predicate}｜${fact.value}（证据第${fact.evidenceChapter}章）`,
        factIds: [fact.id],
      });
    }
  }

  for (const fact of confirmed.filter(
    (item) => item.kind === "秘密" && item.knowledgeScope.trim() && !/公开|所有人/.test(item.knowledgeScope),
  )) {
    const secret = compact(fact.value);
    if (secret.length < 2 || !compact(chapter.outline).includes(secret)) continue;
    add({
      id: `knowledge:${fact.id}`,
      severity: "警告",
      category: "知识边界",
      message: `章纲涉及受限秘密“${fact.subject}”，生成时必须遵守知情范围`,
      evidence: `${fact.value}；当前知情范围：${fact.knowledgeScope}`,
      factIds: [fact.id],
    });
  }

  return findings;
}

export function assertNoHardStoryConstraint(findings: readonly StoryConstraintFinding[]) {
  const hard = findings.filter((finding) => finding.severity === "硬性");
  if (!hard.length) return;
  throw new Error(`写前状态约束未通过：${hard.map((finding) => finding.message).join("；")}`);
}
