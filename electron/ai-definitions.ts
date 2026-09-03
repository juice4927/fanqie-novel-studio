import { createHash } from "node:crypto";
import { z } from "zod";
import { NARRATIVE_GENRES } from "../src/shared/genre-composition";
import { GENRE_STAGES } from "../src/shared/genre-plugins";
import type { BookConceptInput, ChapterDraftStreamEvent } from "../src/shared/types";
import { CHAPTER_FUNCTIONS } from "../src/shared/types";

export function abortableDelay(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("任务已取消"));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("任务已取消"));
      },
      { once: true },
    );
  });
}

export const InsightSchema = z.object({
  audienceNeed: z.string(),
  openingPromise: z.string(),
  conflictEngine: z.string(),
  emotionalRhythm: z.string(),
  retentionDevices: z.string(),
  longFormEngine: z.string(),
  marketGap: z.string(),
  risks: z.string(),
  confidence: z.enum(["低", "中", "高"]),
});

export const BatchAnalysisSchema = z.object({
  chapters: z.array(
    z.object({
      ordinal: z.number(),
      finding: z.string(),
      conflict: z.string(),
      hook: z.string(),
      stateChange: z.string(),
      risk: z.string(),
      enteringExpectation: z.string(),
      protagonistGoal: z.string(),
      coreInterest: z.string(),
      emotionalPayoff: z.string(),
      payoffImpact: z.string(),
      nextExpectation: z.string(),
    }),
  ),
  synthesis: InsightSchema,
});

export const CandidateSchema = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string(),
        oneLinePitch: z.string(),
        audience: z.string(),
        coreConflict: z.string(),
        differentiation: z.string(),
        longFormCapacity: z.string(),
        originalityRisk: z.enum(["低", "中", "高"]),
      }),
    )
    .length(3),
});

export const BookConceptSchema = z.object({
  candidates: z
    .array(
      z.object({
        title: z.string().min(4).max(40),
        premise: z.string().min(20).max(500),
        genreSubtype: z.string().min(2).max(40),
        secondaryGenres: z.array(z.enum(NARRATIVE_GENRES)).min(1).max(3),
        genreElements: z.array(z.string().min(1).max(40)).max(8),
        openingMechanism: z.string().min(4).max(120),
        growthCarrier: z.string().min(4).max(120),
        primaryPayoff: z.string().min(4).max(120),
        protagonistDesire: z.string().min(8).max(200),
        readerPromise: z.string().min(10).max(300),
        coreEmotion: z.string().min(2).max(80),
        ending: z.string().min(10).max(300),
        immutableRules: z.array(z.string().min(2).max(120)).min(2).max(6),
        prohibitedPatterns: z.array(z.string().min(2).max(120)).min(2).max(6),
        audience: z.string().min(5).max(200),
        commercialHook: z.string().min(8).max(300),
        longFormEngine: z.string().min(10).max(400),
      }),
    )
    .length(3),
});

const distinctSkeletonList = (minimum: number, maximum: number) =>
  z
    .array(z.string().min(8).max(300))
    .min(minimum)
    .max(maximum)
    .refine((items) => new Set(items.map((item) => diversityKey(item))).size === items.length, "骨架条目不能重复");

export const BookConceptSkeletonSchema = z.object({
  protagonistArc: z.string().min(20).max(600),
  keyRelationships: distinctSkeletonList(2, 8),
  worldRules: distinctSkeletonList(2, 10),
  majorForces: distinctSkeletonList(2, 8),
  timelineAnchors: distinctSkeletonList(3, 10),
});

export type GeneratedBookConcept = z.infer<typeof BookConceptSchema>["candidates"][number];

const DEBT_ACCOUNTING_MOTIF =
  /欠(?:债|款|薪)|债(?:务|主|权|契)|负债|还债|偿债|讨债|追债|催收|顶债|背债|烂账|旧账|账本|账单|账目|亏损账|清算令/;
const DEBT_ACCOUNTING_REJECTION =
  /(?:不要|不写|不得|不允许|禁止|避免|拒绝|排除|别写|勿用|无)[^，。；\n]{0,16}(?:债|账|欠款|欠薪|催收|清算)/;
const DEBT_ACCOUNTING_REQUEST =
  /欠(?:债|款|薪)|债(?:务|主|权|契)|负债|还债|偿债|讨债|追债|催收|顶债|背债|账目(?:造假|调查|审计)|(?:查|核|做)账|会计(?:题材|主角|职业|调查)|审计(?:题材|主角|调查)/;

export function authorRequestsDebtAccounting(input: BookConceptInput) {
  const direction = [input.seed, input.customGenreDirection, ...(input.genreElements ?? [])].filter(Boolean).join("；");
  return DEBT_ACCOUNTING_REQUEST.test(direction) && !DEBT_ACCOUNTING_REJECTION.test(direction);
}

export function conceptDefaultMotifIssues(
  candidates: Array<
    Pick<
      GeneratedBookConcept,
      | "title"
      | "premise"
      | "genreElements"
      | "openingMechanism"
      | "growthCarrier"
      | "primaryPayoff"
      | "protagonistDesire"
      | "readerPromise"
      | "coreEmotion"
      | "ending"
      | "immutableRules"
      | "audience"
      | "commercialHook"
      | "longFormEngine"
    >
  >,
  allowDebtAccounting = false,
) {
  if (allowDebtAccounting) return [];
  return candidates.flatMap((candidate, index) => {
    const narrative = [
      candidate.title,
      candidate.premise,
      ...candidate.genreElements,
      candidate.openingMechanism,
      candidate.growthCarrier,
      candidate.primaryPayoff,
      candidate.protagonistDesire,
      candidate.readerPromise,
      candidate.coreEmotion,
      candidate.ending,
      ...candidate.immutableRules,
      candidate.audience,
      candidate.commercialHook,
      candidate.longFormEngine,
    ].join("；");
    return DEBT_ACCOUNTING_MOTIF.test(narrative)
      ? [`方案${index + 1}在作者未指定时使用了债务、欠款或账目清算母题`]
      : [];
  });
}

const diversityKey = (value: string) => value.toLowerCase().replace(/[\s，。、“”‘’：；！？,.!?:;\-_/]+/g, "");

const ngramSimilarity = (left: string, right: string, size = 2) => {
  const grams = (value: string) => {
    const normalized = diversityKey(value);
    if (normalized.length <= size) return new Set([normalized]);
    return new Set(
      Array.from({ length: normalized.length - size + 1 }, (_, index) => normalized.slice(index, index + size)),
    );
  };
  const leftGrams = grams(left);
  const rightGrams = grams(right);
  const smallest = Math.min(leftGrams.size, rightGrams.size);
  if (!smallest) return 0;
  return [...leftGrams].filter((gram) => rightGrams.has(gram)).length / smallest;
};

export function conceptDiversityIssues(
  candidates: Array<
    Pick<
      GeneratedBookConcept,
      | "genreSubtype"
      | "secondaryGenres"
      | "openingMechanism"
      | "growthCarrier"
      | "primaryPayoff"
      | "premise"
      | "longFormEngine"
    >
  >,
  requireDistinctNarrativeAxis = false,
) {
  const issues: string[] = [];
  const dimensions: Array<[string, (candidate: (typeof candidates)[number]) => string]> = [
    ["子类型", (candidate) => candidate.genreSubtype],
    ["开局机制", (candidate) => candidate.openingMechanism],
    ["成长载体", (candidate) => candidate.growthCarrier],
    ["主要回报", (candidate) => candidate.primaryPayoff],
  ];
  const fullyDistinct = dimensions.filter(
    ([, select]) => new Set(candidates.map((candidate) => diversityKey(select(candidate)))).size === candidates.length,
  );
  if (fullyDistinct.length < 3) {
    const repeated = dimensions
      .filter(([name]) => !fullyDistinct.some(([distinctName]) => distinctName === name))
      .map(([name]) => name);
    issues.push(`至少三个核心维度必须完全不同；当前重复：${repeated.join("、")}`);
  }
  if (
    requireDistinctNarrativeAxis &&
    new Set(candidates.map((candidate) => candidate.secondaryGenres[0])).size < candidates.length
  )
    issues.push("未指定复合方向时，三个方案的首要叙事主轴必须不同");
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const similarCoreDimensions = dimensions
        .filter(([, select]) => ngramSimilarity(select(candidates[left]), select(candidates[right])) >= 0.68)
        .map(([name]) => name);
      const combinedCoreSimilarity = ngramSimilarity(
        dimensions.map(([, select]) => select(candidates[left])).join("；"),
        dimensions.map(([, select]) => select(candidates[right])).join("；"),
      );
      if (similarCoreDimensions.length >= 3 || combinedCoreSimilarity >= 0.58)
        issues.push(
          `方案${left + 1}与方案${right + 1}的核心结构高度近似：${similarCoreDimensions.length ? similarCoreDimensions.join("、") : "组合路线"}`,
        );
      for (const field of ["premise", "longFormEngine"] as const) {
        if (ngramSimilarity(candidates[left][field], candidates[right][field]) >= 0.78)
          issues.push(`方案${left + 1}与方案${right + 1}的${field === "premise" ? "故事前提" : "长篇发动机"}近似改写`);
      }
    }
  }
  for (const field of ["premise", "longFormEngine"] as const) {
    if (new Set(candidates.map((candidate) => diversityKey(candidate[field]))).size < candidates.length)
      issues.push(`${field === "premise" ? "故事前提" : "长篇发动机"}存在重复`);
  }
  return issues;
}

export const DraftSchema = z.object({
  title: z.string(),
  content: z.string().min(500),
});

export const chapterDraftSchema = (minimumCharacters: number, maximumCharacters: number) =>
  z.object({
    title: z.string().min(1).max(80),
    content: z
      .string()
      .min(500)
      .refine((value) => {
        const characters = [...value].filter((character) => !/\s/.test(character)).length;
        return characters >= minimumCharacters && characters <= maximumCharacters;
      }, `正文有效字符数必须在 ${minimumCharacters}-${maximumCharacters} 之间`),
  });

export const AestheticProfileSuggestionSchema = z.object({
  profile: z.object({
    narrativeDistance: z.enum(["贴身", "适中", "远距"]),
    emotionalTemperature: z.enum(["冷峻", "克制", "均衡", "热烈"]),
    proseTexture: z.string().min(2).max(300),
    dialogueStyle: z.string().min(2).max(300),
    emotionalExpression: z.string().min(2).max(300),
    signatureTechniques: z.array(z.string().min(2).max(120)).min(2).max(8),
    avoidPatterns: z.array(z.string().min(2).max(120)).min(2).max(8),
  }),
  diagnosis: z.string().min(10).max(600),
  rationale: z.array(z.string().min(4).max(240)).min(2).max(6),
});

export const QualityReviewSchema = z.object({
  issues: z
    .array(
      z.object({
        severity: z.enum(["硬性", "警告", "建议"]),
        category: z.string().min(1).max(40),
        message: z.string().min(1).max(500),
        evidence: z.string().max(500),
      }),
    )
    .max(12),
});

export const FactCandidateSchema = z.object({
  facts: z
    .array(
      z.object({
        kind: z.enum(["人物", "关系", "能力", "资源", "地点", "时间线", "秘密", "承诺", "伏笔", "支线", "事件"]),
        subject: z.string().min(1).max(80),
        predicate: z.string().min(1).max(80),
        value: z.string().min(1).max(300),
        knowledgeScope: z.string().max(200),
        evidence: z.string().min(4).max(300),
      }),
    )
    .max(12),
});

export const StructurePlanningSchema = z.object({
  stages: z
    .array(
      z.object({
        title: z
          .string()
          .min(2)
          .max(80)
          .refine((title) => !(GENRE_STAGES as readonly string[]).includes(title), "阶段标题必须是本书专属状态"),
        startChapter: z.number().int().positive(),
        goal: z.string().min(10).max(500),
        conflict: z.string().min(10).max(500),
        outcome: z.string().min(10).max(500),
        targetWords: z.number().int().positive(),
      }),
    )
    .min(4)
    .max(8),
  volumes: z
    .array(
      z.object({
        title: z.string().min(2).max(80),
        goal: z.string().min(10).max(500),
        conflict: z.string().min(10).max(500),
        outcome: z.string().min(10).max(500),
        targetWords: z.number().int().positive(),
      }),
    )
    .min(3)
    .max(6),
});

const PlannedChapterSchema = z
  .object({
    title: z.string().min(2).max(80),
    goal: z.string().min(5).max(300),
    conflict: z.string().min(5).max(300),
    outcome: z.string().min(5).max(300),
    chapterFunction: z.enum(CHAPTER_FUNCTIONS),
    targetWords: z.number().int().min(1400).max(3500),
    chapterPromise: z.string().min(5).max(300),
    expectedPayoff: z.string().min(5).max(300),
    crisis: z.string().min(5).max(300),
    endingExpectation: z.string().min(5).max(300),
    payoffOffset: z.number().int().min(1).max(30),
    isKeyChapter: z.boolean(),
    scenes: z
      .array(
        z.object({
          title: z
            .string()
            .min(2)
            .max(80)
            .refine((title) => !/^(入场|对抗|转向|回报|冲突|收束)$/.test(title), "场景标题必须是具体事件"),
          goal: z.string().min(4).max(300),
          conflict: z.string().min(4).max(300),
          outcome: z.string().min(4).max(300),
          targetWords: z.number().int().min(250).max(2200),
        }),
      )
      .min(1)
      .max(5),
  })
  .refine((chapter) => {
    const sceneWords = chapter.scenes.reduce((sum, scene) => sum + scene.targetWords, 0);
    return sceneWords >= chapter.targetWords * 0.6 && sceneWords <= chapter.targetWords * 1.4;
  }, "场景目标字数之和必须接近本章目标字数");

export const ChapterPlanningSchema = z
  .object({
    batchGoal: z.string().min(10).max(800),
    batchConflict: z.string().min(10).max(800),
    batchOutcome: z.string().min(10).max(800),
    chapters: z.array(PlannedChapterSchema).min(1).max(30),
  })
  .superRefine((result, context) => {
    if (result.chapters.length < 5) return;
    const dimensions = [
      ["章节功能", new Set(result.chapters.map((chapter) => chapter.chapterFunction)).size, 3],
      ["场景数量", new Set(result.chapters.map((chapter) => chapter.scenes.length)).size, 2],
      ["目标字数", new Set(result.chapters.map((chapter) => chapter.targetWords)).size, 3],
    ] as const;
    for (const [name, actual, minimum] of dimensions) {
      if (actual < minimum) context.addIssue({ code: "custom", message: `${name}变化不足，至少需要 ${minimum} 种` });
    }
  });

export const PlanningReviewSchema = z.object({
  summary: z.string().min(10).max(1000),
  verdict: z.enum(["可执行", "建议修复", "存在硬伤"]),
  issues: z
    .array(
      z.object({
        severity: z.enum(["硬性", "警告", "建议"]),
        category: z.enum(["因果", "人物动机", "设定", "结构覆盖", "章节承接", "节奏重复", "期待兑现", "篇幅"]),
        targetType: z.enum(["规划", "章节", "全局"]),
        targetId: z.string().nullable(),
        location: z.string().min(1).max(120),
        message: z.string().min(4).max(500),
        evidence: z.string().min(2).max(500),
        repairSummary: z.string().min(4).max(500),
      }),
    )
    .max(40),
  planRepairs: z
    .array(
      z.object({
        targetId: z.string(),
        after: z.object({
          title: z.string().min(1).max(80),
          goal: z.string().min(4).max(500),
          conflict: z.string().min(4).max(500),
          outcome: z.string().min(4).max(500),
          targetWords: z.number().int().positive(),
        }),
      }),
    )
    .max(200),
  chapterRepairs: z
    .array(
      z.object({
        targetId: z.string(),
        after: z.object({
          title: z.string().min(1).max(80),
          outline: z.string().min(4).max(1000),
          chapterFunction: z.enum(CHAPTER_FUNCTIONS).optional(),
          targetWords: z.number().int().min(800).max(5000).optional(),
          chapterPromise: z.string().max(500).optional(),
          expectedPayoff: z.string().max(500).optional(),
          crisis: z.string().max(500).optional(),
          endingExpectation: z.string().max(500).optional(),
          expectationTargetChapter: z.number().int().positive().nullable().optional(),
        }),
      }),
    )
    .max(100),
});

export const NovelRevisionSchema = z.object({
  summary: z.string().min(4).max(1200),
  warnings: z.array(z.string().min(2).max(500)).max(20),
  impacts: z
    .array(
      z.object({
        targetType: z.enum(["创作契约", "规划", "章节", "事实账本", "期待账本"]),
        location: z.string().min(1).max(160),
        reason: z.string().min(2).max(500),
        risk: z.enum(["低", "中", "高"]),
      }),
    )
    .max(100),
  contractRepairs: z
    .array(
      z.object({
        field: z.enum([
          "premise",
          "protagonistDesire",
          "protagonistArc",
          "readerPromise",
          "coreEmotion",
          "ending",
          "worldRules",
          "keyRelationships",
          "majorForces",
          "timelineAnchors",
          "immutableRules",
          "prohibitedPatterns",
        ]),
        label: z.string().min(1).max(80),
        after: z.string().max(10_000),
        reason: z.string().min(2).max(500),
        risk: z.enum(["低", "中", "高"]),
      }),
    )
    .max(30),
  planRepairs: z
    .array(
      z.object({
        targetId: z.string(),
        after: z.object({
          title: z.string().min(1).max(500),
          goal: z.string().max(10_000),
          conflict: z.string().max(10_000),
          outcome: z.string().max(10_000),
          targetWords: z.number().int().min(0).max(20_000_000),
        }),
        reason: z.string().min(2).max(500),
        risk: z.enum(["低", "中", "高"]),
      }),
    )
    .max(100),
  chapterRepairs: z
    .array(
      z.object({
        targetId: z.string(),
        after: z.object({
          title: z.string().min(1).max(500),
          outline: z.string().max(10_000),
          chapterFunction: z.enum(CHAPTER_FUNCTIONS).optional(),
          targetWords: z.number().int().min(800).max(5000).optional(),
          chapterPromise: z.string().max(10_000).optional(),
          expectedPayoff: z.string().max(10_000).optional(),
          crisis: z.string().max(10_000).optional(),
          endingExpectation: z.string().max(10_000).optional(),
          expectationTargetChapter: z.number().int().positive().nullable().optional(),
        }),
        reason: z.string().min(2).max(500),
        risk: z.enum(["低", "中", "高"]),
      }),
    )
    .max(100),
  replacementText: z.string().max(200_000).nullable(),
  replacementReason: z.string().max(500).nullable(),
  replacementRisk: z.enum(["低", "中", "高"]).nullable(),
});

export type InsightResult = z.infer<typeof InsightSchema>;
export const DECONSTRUCT_BATCH_SIZE = 5;
export const CHAPTER_PLANNING_BATCH_SIZE = 10;

export function insightText(insight: InsightResult) {
  return `读者需求：${insight.audienceNeed}\n开篇承诺：${insight.openingPromise}\n冲突发动机：${insight.conflictEngine}\n情绪节奏：${insight.emotionalRhythm}\n留存手段：${insight.retentionDevices}\n长篇发动机：${insight.longFormEngine}\n市场空位：${insight.marketGap}\n风险：${insight.risks}`;
}

export function stripCodeFence(value: string) {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
}

export interface ResearchSanitizationContext {
  replacements: Map<string, string>;
  characterIndex: number;
  placeIndex: number;
}

export function createResearchSanitizationContext(): ResearchSanitizationContext {
  return { replacements: new Map(), characterIndex: 0, placeIndex: 0 };
}

export function sanitizeResearchText(text: string, context = createResearchSanitizationContext()) {
  const replaceStable = (value: string, kind: "角色" | "地点组织") => {
    const existing = context.replacements.get(value);
    if (existing) return existing;
    const replacement = kind === "角色" ? `<角色${++context.characterIndex}>` : `<地点组织${++context.placeIndex}>`;
    context.replacements.set(value, replacement);
    return replacement;
  };

  return text
    .replace(/作者[：:]\s*[^\n]{1,30}/g, "")
    .replace(/https?:\/\/\S+|\b[\w.+-]+@[\w.-]+\.\w+\b/g, "<联系方式>")
    .replace(/(?:\+?86[- ]?)?1[3-9]\d{9}/g, "<联系方式>")
    .replace(/《[^》\n]{1,40}》/g, "《作品》")
    .replace(/(?:番茄小说|起点中文网|晋江文学城)/g, "内容平台")
    .replace(
      /(去了?|前往|返回|进入|离开|住在|位于|在|到|至|从|往)([\p{Script=Han}]{1,8}(?:市|县|镇|村|街|路|巷|山|河|江|湖|宗|门|派|宫|殿|府|司|局|院|校|公司|集团|协会|组织))/gu,
      (_value, prefix: string, entity: string) => `${prefix}${replaceStable(entity, "地点组织")}`,
    )
    .replace(
      /(^|[\s，。！？；：、“”‘’])([\p{Script=Han}]{1,8}(?:市|县|镇|村|街|路|巷|山|河|江|湖|宗|门|派|宫|殿|府|司|局|院|校|公司|集团|协会|组织))(?=[\s，。！？；：、“”‘’]|$)/gu,
      (_value, prefix: string, entity: string) => `${prefix}${replaceStable(entity, "地点组织")}`,
    )
    .replace(
      /([赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季贾江童颜郭梅林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫柯房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄曲封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公][\p{Script=Han}]{1,2}?)(?=说|问|答|道|看|走|来|去|笑|哭|皱|摇|点|抬|低|拿|转|站|坐|听|想|喊|叫)/gu,
      (value) => replaceStable(value, "角色"),
    )
    .replace(
      /(?:名叫|叫做|名字是|自称|人称)([\p{Script=Han}A-Za-z0-9·_-]{2,16})/gu,
      (_value, name: string) => `名为${replaceStable(name, "角色")}`,
    )
    .replace(
      /((?:欧阳|司马|上官|诸葛|东方|皇甫|尉迟|公孙|慕容|令狐|宇文|长孙|端木|独孤|南宫|夏侯|轩辕)[\p{Script=Han}]{1,2}|[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢苏潘范彭鲁韦马方任袁柳史唐薛雷贺罗毕郝安乐傅齐康伍余顾孟黄萧姚邵汪毛戴宋庞熊纪舒项董梁杜阮蓝贾江童郭林钟徐高夏蔡田樊胡凌霍莫房邓洪左石崔吉龚程陆荣白黎叶龙刘陈][\p{Script=Han}]{1,2})(?=[\s，。！？；：、“”‘’]|$)/gu,
      (value) => replaceStable(value, "角色"),
    )
    .slice(0, 3500);
}

export function sanitizeResearchBatch<T extends { content: string }>(chapters: T[]) {
  const context = createResearchSanitizationContext();
  return chapters.map((chapter) => sanitizeResearchText(chapter.content, context));
}

export function hashInput(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export type AiCachePolicy = "use" | "bypass";

export interface StartedAiTask<T> {
  jobId: string | null;
  source: "network" | "cache";
  completion: Promise<T>;
}

export interface StartDraftChapterOptions {
  retryContext?: string;
  onStream?: (event: ChapterDraftStreamEvent) => void;
  cachePolicy?: AiCachePolicy;
}
