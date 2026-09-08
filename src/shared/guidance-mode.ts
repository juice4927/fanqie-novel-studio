import { type ChapterFunction, GUIDANCE_MODES, type GuidanceMode } from "./types";

export type { GuidanceMode };
export { GUIDANCE_MODES };

export const DEFAULT_GUIDANCE_MODE: GuidanceMode = "均衡";

export interface GuidanceLevel {
  mode: GuidanceMode;
  /** 是否按信号检索题材商业知识；默认不注入，命中信号才取。 */
  retrieval: boolean;
  /** 是否注入按章功能推导的节拍建议。 */
  beatSuggestion: boolean;
  /** 是否注入完整题材参考（阶段规则、规划检查等）。 */
  fullReference: boolean;
  /** 正文长度软区间，相对目标字数的比例。 */
  wordRatio: { minimum: number; maximum: number };
}

const LEVELS: Record<GuidanceMode, GuidanceLevel> = {
  自由: {
    mode: "自由",
    retrieval: false,
    beatSuggestion: false,
    fullReference: false,
    wordRatio: { minimum: 0.45, maximum: 2.2 },
  },
  均衡: {
    mode: "均衡",
    retrieval: true,
    beatSuggestion: true,
    fullReference: false,
    wordRatio: { minimum: 0.6, maximum: 1.6 },
  },
  严谨: {
    mode: "严谨",
    retrieval: false,
    beatSuggestion: true,
    fullReference: true,
    wordRatio: { minimum: 0.68, maximum: 1.35 },
  },
};

export function normalizeGuidanceMode(value?: string | null): GuidanceMode {
  return (GUIDANCE_MODES as readonly string[]).includes(value ?? "") ? (value as GuidanceMode) : DEFAULT_GUIDANCE_MODE;
}

export function resolveGuidanceLevel(mode?: string | null): GuidanceLevel {
  return LEVELS[normalizeGuidanceMode(mode)];
}

/** 写作任务的采样温度：越自由越高。其他任务仍走固定低温。 */
export function guidanceTemperature(mode?: string | null): number {
  switch (normalizeGuidanceMode(mode)) {
    case "自由":
      return 0.95;
    case "严谨":
      return 0.7;
    default:
      return 0.85;
  }
}

export function compileGuidanceModeInstruction(mode?: string | null): string {
  switch (normalizeGuidanceMode(mode)) {
    case "自由":
      return "作者选择了「自由」档：只给出本章任务与硬边界，场景结构、推进方式和文风由你判断；在不触碰硬边界的前提下，优先选择你认为最有表现力的写法。";
    case "严谨":
      return "作者选择了「严谨」档：下面的阶段规则与检查项是本书的写作基准，请优先满足；如确有更好的处理方式，可以在不违背硬边界的前提下偏离。";
    default:
      return "作者选择了「均衡」档：下面的推进建议用来降低跑偏概率，是参考而不是清单，不必逐条完成；你可以在完成本章任务的前提下自由调整场景结构与写法。";
  }
}

export function guidanceCharacterWindow(targetCharacters: number, mode?: string | null) {
  const { wordRatio } = resolveGuidanceLevel(mode);
  return {
    // 下限不低于结构校验的硬下限，避免提示词给出的区间被 schema 拒绝。
    minimum: Math.max(800, Math.round(targetCharacters * wordRatio.minimum)),
    maximum: Math.min(6000, Math.round(targetCharacters * wordRatio.maximum)),
  };
}

/** 不同章节功能对应的推进节拍，按需选用，不构成必须逐条完成的清单。 */
const BEAT_LIBRARY: Record<ChapterFunction, string[]> = {
  行动: ["目标", "阻碍", "选择", "代价或收益", "局势变化"],
  生存: ["威胁迫近", "资源或时间受限", "一次关键选择", "付出的代价", "生存状态改变"],
  经营: ["现有盘子", "机会或漏洞", "投入与风险", "回报落地", "新的经营压力"],
  训练: ["明确目标或短板", "重复与挫败", "方法上的调整", "可验证的进步", "新的挑战"],
  揭秘: ["一个被遮蔽的事实", "线索指向", "揭示的代价或阻力", "真相揭开", "真相带来的新处境"],
  高潮: ["此前积累的压力", "正面对抗", "代价明确的抉择", "结果兑现", "代价与余波"],
  调查: ["线索", "假设", "验证或推翻", "认知更新", "新问题"],
  关系: ["期待或错位", "试探", "冲突或靠近", "关系位移", "余波"],
  群像: ["一个具体场景", "不同立场的反应", "信息增量", "一个微小但真实的变化", "未解之处"],
  氛围: ["进入场景", "感官与情绪细节", "一处不协调", "氛围转向", "留下未解之处"],
  过渡: ["承接上一章", "一个真实的变化", "为新阶段埋下条件", "读者更想知道接下来"],
};

export function compileBeatSuggestion(chapterFunction: ChapterFunction): string {
  const beats = BEAT_LIBRARY[chapterFunction];
  return `这类章节常见的推进方式：${beats.join(" → ")}。不必逐拍走完，以完成本章任务为准。`;
}

/** 章节强度参考：阶段目标已由题材引导的"节奏参考/当前阶段"一行给出，这里只区分关键章与普通章。 */
export function compileIntensityHint(isKeyChapter: boolean): string {
  if (isKeyChapter) return "本章是关键章：值得让局势发生明确变化，并让代价或收获落到实处。";
  return "本章不必强行制造大冲突：一个真实的变化、一次认知更新或一段关系位移都可以是有效推进。";
}
