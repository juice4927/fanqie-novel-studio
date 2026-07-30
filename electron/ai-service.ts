import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Chapter,
  ConceptCandidate,
  ContextPackage,
  Genre,
  InsightPack,
  MarketOpportunity,
  ProjectDetail,
  QualityIssue,
  ResearchAnalysisRecord,
  ResearchBook,
} from "../src/shared/types";
import { GENRE_PLUGINS } from "../src/shared/genre-plugins";
import { WorkspaceDatabase, now } from "./database";
import { compileCommercialGuidance, compileDeconstructionFramework } from "../src/shared/commercial-knowledge";

const PROMPT_VERSION = "2026-07-30.v4-structured-genres";

const InsightSchema = z.object({
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

const BatchAnalysisSchema = z.object({
  chapters: z.array(z.object({
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
  })),
  synthesis: InsightSchema,
});

const CandidateSchema = z.object({
  candidates: z.array(z.object({
    title: z.string(),
    oneLinePitch: z.string(),
    audience: z.string(),
    coreConflict: z.string(),
    differentiation: z.string(),
    longFormCapacity: z.string(),
    originalityRisk: z.enum(["低", "中", "高"]),
  })).length(3),
});

const DraftSchema = z.object({
  title: z.string(),
  content: z.string().min(500),
});

const QualityReviewSchema = z.object({
  issues: z.array(z.object({
    severity: z.enum(["硬性", "警告", "建议"]),
    category: z.string().min(1).max(40),
    message: z.string().min(1).max(500),
    evidence: z.string().max(500),
  })).max(12),
});

type InsightResult = z.infer<typeof InsightSchema>;

function insightText(insight: InsightResult) {
  return `读者需求：${insight.audienceNeed}\n开篇承诺：${insight.openingPromise}\n冲突发动机：${insight.conflictEngine}\n情绪节奏：${insight.emotionalRhythm}\n留存手段：${insight.retentionDevices}\n长篇发动机：${insight.longFormEngine}\n市场空位：${insight.marketGap}\n风险：${insight.risks}`;
}

function stripCodeFence(value: string) {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
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
    .replace(/(去了?|前往|返回|进入|离开|住在|位于|在|到|至|从|往)([\p{Script=Han}]{1,8}(?:市|县|镇|村|街|路|巷|山|河|江|湖|宗|门|派|宫|殿|府|司|局|院|校|公司|集团|协会|组织))/gu, (_value, prefix: string, entity: string) => `${prefix}${replaceStable(entity, "地点组织")}`)
    .replace(/(^|[\s，。！？；：、“”‘’])([\p{Script=Han}]{1,8}(?:市|县|镇|村|街|路|巷|山|河|江|湖|宗|门|派|宫|殿|府|司|局|院|校|公司|集团|协会|组织))(?=[\s，。！？；：、“”‘’]|$)/gu, (_value, prefix: string, entity: string) => `${prefix}${replaceStable(entity, "地点组织")}`)
    .replace(/([赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵汪祁毛禹狄米贝明臧计伏成戴宋茅庞熊纪舒屈项祝董梁杜阮蓝闵季贾江童颜郭梅林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫柯房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉龚程邢裴陆荣翁荀羊甄曲封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公][\p{Script=Han}]{1,2}?)(?=说|问|答|道|看|走|来|去|笑|哭|皱|摇|点|抬|低|拿|转|站|坐|听|想|喊|叫)/gu, (value) => replaceStable(value, "角色"))
    .replace(/(?:名叫|叫做|名字是|自称|人称)([\p{Script=Han}A-Za-z0-9·_-]{2,16})/gu, (_value, name: string) => `名为${replaceStable(name, "角色")}`)
    .replace(/((?:欧阳|司马|上官|诸葛|东方|皇甫|尉迟|公孙|慕容|令狐|宇文|长孙|端木|独孤|南宫|夏侯|轩辕)[\p{Script=Han}]{1,2}|[赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜谢苏潘范彭鲁韦马方任袁柳史唐薛雷贺罗毕郝安乐傅齐康伍余顾孟黄萧姚邵汪毛戴宋庞熊纪舒项董梁杜阮蓝贾江童郭林钟徐高夏蔡田樊胡凌霍莫房邓洪左石崔吉龚程陆荣白黎叶龙刘陈][\p{Script=Han}]{1,2})(?=[\s，。！？；：、“”‘’]|$)/gu, (value) => replaceStable(value, "角色"))
    .slice(0, 3500);
}

export function sanitizeResearchBatch<T extends { content: string }>(chapters: T[]) {
  const context = createResearchSanitizationContext();
  return chapters.map((chapter) => sanitizeResearchText(chapter.content, context));
}

function hashInput(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class AiService {
  constructor(
    private readonly database: WorkspaceDatabase,
    private readonly getApiKey: () => string,
    private readonly requestTimeoutMs = 120_000,
  ) {}

  private async runJson<T>(options: {
    projectId: string | null;
    taskType: string;
    inputSummary: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
  }): Promise<T> {
    const settings = this.database.getAiSettings();
    const apiKey = this.getApiKey();
    if (!apiKey) throw new Error("尚未配置 AI API 密钥");
    const inputHash = hashInput(`${options.system}\n${options.user}`);
    const cached = this.database.findAiJob(options.taskType, inputHash, PROMPT_VERSION, settings.model);
    if (cached) return options.schema.parse(JSON.parse(cached));
    const jobId = this.database.startAiJob(
      options.projectId, options.taskType, inputHash, PROMPT_VERSION, settings.baseUrl, settings.model, options.inputSummary,
    );
    let lastError = "模型输出不符合结构要求";
    let repairInstruction = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const endpoint = `${settings.baseUrl.replace(/\/$/, "")}/chat/completions`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        let response: Response;
        try {
          response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: settings.model,
            temperature: options.taskType === "draft-chapter" ? 0.85 : 0.35,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: `${options.system}\n只返回合法 JSON，不使用 Markdown。` },
              { role: "user", content: `${options.user}${repairInstruction}` },
            ],
          }),
          });
        } catch (error) {
          if (controller.signal.aborted) throw new Error(`模型请求超时（${Math.ceil(this.requestTimeoutMs / 1000)} 秒）`);
          throw error;
        } finally {
          clearTimeout(timeout);
        }
        if (!response.ok) throw new Error(`模型接口返回 ${response.status}: ${(await response.text()).slice(0, 300)}`);
        const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
        const raw = body.choices?.[0]?.message?.content;
        if (!raw) throw new Error("模型没有返回内容");
        const parsed = options.schema.parse(JSON.parse(stripCodeFence(raw)));
        this.database.finishAiJob(jobId, JSON.stringify(parsed));
        return parsed;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        if (lastError.startsWith("模型请求超时")) {
          this.database.finishAiJob(jobId, "", lastError);
          throw new Error(lastError);
        }
        repairInstruction = `\n上一次输出校验失败：${lastError}。请修复结构并重新输出完整 JSON。`;
      }
    }
    this.database.finishAiJob(jobId, "", lastError);
    throw new Error(lastError);
  }

  async deconstruct(book: ResearchBook, chapters: Array<{ ordinal: number; title: string; content: string; wordCount: number }>): Promise<{ insight: InsightPack; analyses: ResearchAnalysisRecord[] }> {
    if (!book.cloudConsent || !this.getApiKey()) return this.localInsight(book, chapters);
    const partials: InsightResult[] = [];
    const analyses: ResearchAnalysisRecord[] = [];
    for (let start = 0; start < chapters.length; start += 10) {
      const batch = chapters.slice(start, start + 10);
      const sanitizedBatch = sanitizeResearchBatch(batch);
      const result = await this.runJson({
        projectId: null,
        taskType: "deconstruct-batch",
        inputSummary: `${book.title} 第${start + 1}-${start + batch.length}章脱敏分析`,
        system: `你是中国商业网文结构研究员。只能抽象情节机制和读者体验，不得复述句子、输出作品专名、角色名、独特设定名或模仿文风。\n${compileDeconstructionFramework(book.genre)}`,
        user: `题材：${book.genre}\n章节范围：${start + 1}-${start + batch.length}\n输出 chapters 数组，逐章给出 ordinal、finding、conflict、hook、stateChange、risk、enteringExpectation、protagonistGoal、coreInterest、emotionalPayoff、payoffImpact、nextExpectation；没有证据时写“证据不足”，不得臆测。再输出 synthesis，字段为 audienceNeed、openingPromise、conflictEngine、emotionalRhythm、retentionDevices、longFormEngine、marketGap、risks、confidence。所有结论必须抽象，不得引用原句或专名。\n` +
          batch.map((chapter, index) => `【章节${chapter.ordinal}】\n${sanitizedBatch[index]}`).join("\n"),
        schema: BatchAnalysisSchema,
      });
      partials.push(result.synthesis);
      for (const finding of result.chapters) analyses.push({ id: randomUUID(), bookId: book.id, layer: "章节", fromChapter: finding.ordinal, toChapter: finding.ordinal, findings: `进入期待：${finding.enteringExpectation}\n主角目标：${finding.protagonistGoal}\n核心利益：${finding.coreInterest}\n结构：${finding.finding}\n冲突：${finding.conflict}\n情绪回报：${finding.emotionalPayoff}\n回报影响：${finding.payoffImpact}\n下一期待：${finding.nextExpectation}\n章末钩子：${finding.hook}\n状态变化：${finding.stateChange}\n风险：${finding.risk}`, evidenceChapters: [finding.ordinal], confidence: result.synthesis.confidence, createdAt: now() });
      analyses.push({ id: randomUUID(), bookId: book.id, layer: "十章阶段", fromChapter: batch[0].ordinal, toChapter: batch.at(-1)!.ordinal, findings: insightText(result.synthesis), evidenceChapters: batch.map((chapter) => chapter.ordinal), confidence: result.synthesis.confidence, createdAt: now() });
    }
    const volumes: InsightResult[] = [];
    for (let start = 0; start < partials.length; start += 10) {
      const group = partials.slice(start, start + 10);
      const fromChapter = start * 10 + 1;
      const toChapter = Math.min(chapters.length, (start + group.length) * 10);
      const volume = group.length === 1 ? group[0] : await this.runJson({
        projectId: null, taskType: "deconstruct-volume", inputSummary: `${book.title} 第${fromChapter}-${toChapter}章分卷汇总`,
        system: "你是长篇小说分卷结构研究员。输入只有脱敏十章阶段结论，输出同字段抽象汇总，不得还原作品内容。",
        user: `题材：${book.genre}\n范围：第${fromChapter}-${toChapter}章\n${JSON.stringify(group)}`, schema: InsightSchema,
      });
      volumes.push(volume);
      analyses.push({ id: randomUUID(), bookId: book.id, layer: "分卷", fromChapter, toChapter, findings: insightText(volume), evidenceChapters: chapters.slice(fromChapter - 1, toChapter).map((chapter) => chapter.ordinal), confidence: volume.confidence, createdAt: now() });
    }
    const aggregate = volumes.length === 1 ? volumes[0] : await this.runJson({
      projectId: null,
      taskType: "deconstruct-aggregate",
      inputSummary: `${book.title} 全书抽象汇总（${volumes.length}卷）`,
      system: "你是网络小说市场分析师。输入只包含抽象拆解结论。合并重复规律，保留阶段变化和风险，禁止推测或还原原作专名与具体表达。",
      user: `题材：${book.genre}\n请汇总为同字段 JSON：\n${JSON.stringify(volumes)}`,
      schema: InsightSchema,
    });
    analyses.push({ id: randomUUID(), bookId: book.id, layer: "全书", fromChapter: 1, toChapter: chapters.length, findings: insightText(aggregate), evidenceChapters: chapters.map((chapter) => chapter.ordinal), confidence: aggregate.confidence, createdAt: now() });
    return { insight: {
      id: randomUUID(), name: `${book.title} · 脱敏结构洞察`, genre: book.genre,
      ...aggregate, evidenceCount: chapters.length, createdAt: now(),
    }, analyses };
  }

  private localInsight(book: ResearchBook, chapters: Array<{ ordinal: number; title: string; content: string; wordCount: number }>): { insight: InsightPack; analyses: ResearchAnalysisRecord[] } {
    const average = Math.round(chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0) / Math.max(chapters.length, 1));
    const hookRate = Math.round(chapters.filter((chapter) => /[？?!！…]$/.test(chapter.content.trim())).length / Math.max(chapters.length, 1) * 100);
    const dialogueRate = Math.round(chapters.reduce((sum, chapter) => sum + (chapter.content.match(/[“"]/g)?.length ?? 0), 0) / Math.max(book.wordCount, 1) * 1000);
    const insight: InsightPack = {
      id: randomUUID(), name: `${book.title} · 本地结构统计`, genre: book.genre,
      audienceNeed: "未配置云模型，当前仅建立可复核的篇幅与节奏基线。",
      openingPromise: `样本共 ${chapters.length} 章，平均每章约 ${average} 字；需人工补充开篇承诺判断。`,
      conflictEngine: "请在配置模型后运行语义拆解，或根据章节证据人工填写冲突发动机。",
      emotionalRhythm: `章末强标点比例约 ${hookRate}%，对话标记密度约 ${dialogueRate}‰。`,
      retentionDevices: "已完成章节长度、章末形式和对话密度统计，尚未作语义归因。",
      longFormEngine: "待人工确认主线资源、关系变化和阶段升级是否可持续。",
      marketGap: "单本样本不足以形成市场空位结论，应与榜单快照和其他样本交叉验证。",
      risks: "此洞察包由本地规则生成，不包含语义级判断，不应直接作为立项依据。",
      evidenceCount: chapters.length, confidence: "低", createdAt: now(),
    };
    const analyses: ResearchAnalysisRecord[] = chapters.map((chapter) => ({ id: randomUUID(), bookId: book.id, layer: "章节", fromChapter: chapter.ordinal, toChapter: chapter.ordinal, findings: `章节字数：${chapter.wordCount}\n对话标记：${chapter.content.match(/[“”]/g)?.length ?? 0}\n章末形式：${chapter.content.trim().slice(-1) || "无"}`, evidenceChapters: [chapter.ordinal], confidence: "低", createdAt: now() }));
    for (let start = 0; start < chapters.length; start += 10) {
      const group = chapters.slice(start, start + 10);
      analyses.push({ id: randomUUID(), bookId: book.id, layer: "十章阶段", fromChapter: group[0].ordinal, toChapter: group.at(-1)!.ordinal, findings: `平均章长 ${Math.round(group.reduce((sum, chapter) => sum + chapter.wordCount, 0) / group.length)} 字；仅本地统计，待人工补充语义判断。`, evidenceChapters: group.map((chapter) => chapter.ordinal), confidence: "低", createdAt: now() });
    }
    for (let start = 0; start < chapters.length; start += 100) {
      const group = chapters.slice(start, start + 100);
      analyses.push({ id: randomUUID(), bookId: book.id, layer: "分卷", fromChapter: group[0].ordinal, toChapter: group.at(-1)!.ordinal, findings: `本段共 ${group.length} 章、${group.reduce((sum, chapter) => sum + chapter.wordCount, 0)} 字；未启用云端语义拆解。`, evidenceChapters: group.map((chapter) => chapter.ordinal), confidence: "低", createdAt: now() });
    }
    analyses.push({ id: randomUUID(), bookId: book.id, layer: "全书", fromChapter: 1, toChapter: chapters.length, findings: insightText(insight), evidenceChapters: chapters.map((chapter) => chapter.ordinal), confidence: "低", createdAt: now() });
    return { insight, analyses };
  }

  async generateConcepts(project: ProjectDetail, insights: InsightPack[], marketOpportunities: MarketOpportunity[] = []): Promise<ConceptCandidate[]> {
    if (!insights.length) throw new Error("请先为项目关联至少一个脱敏洞察包");
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "generate-concepts",
      inputSummary: `${project.summary.title} 三案立项`,
      system: "你是原创中国商业网文策划。你只能使用输入中的抽象市场洞察，不得假定、复原或模仿任何样本作品。三个方案必须在主角身份、核心矛盾和长篇发动机上明显不同，并能持续制造逐级升级的期待与回报。",
      user: `项目题材：${project.summary.genre}\n目标字数：${project.summary.targetWords}\n商业知识：${compileCommercialGuidance(project.summary.genre, 1, { currentWords: project.summary.currentWords, targetWords: project.summary.targetWords, fanqieCategoryKey: project.contract.fanqieCategoryKey })}\n番茄市场机会（仅作证据，不得机械追热点）：${JSON.stringify(marketOpportunities)}\n脱敏洞察：${JSON.stringify(insights)}\n输出 candidates 数组，每项包含 title、oneLinePitch、audience、coreConflict、differentiation、longFormCapacity、originalityRisk。longFormCapacity 必须说明冲突、资源/关系/地图或规则如何至少三轮升级；每个方案要说明如何借鉴市场机会的读者需求但避开同质化。`,
      schema: CandidateSchema,
    });
    return result.candidates.map((candidate) => ({ ...candidate, id: randomUUID() }));
  }

  async draftChapter(projectId: string, chapter: Chapter, context: ContextPackage): Promise<Chapter> {
    const result = await this.runJson({
      projectId,
      taskType: "draft-chapter",
      inputSummary: `第${chapter.number}章 ${chapter.title || "未命名"}`,
      system: "你是中文长篇商业网文协作写作者。严格遵守已审批创作契约、章纲和事实账本，不自行改纲，不引入上下文之外的关键设定，不泄露角色尚未知晓的信息。商业知识用于明确目标、压力、行动、回报影响和续读问题，不能凌驾于人物逻辑和契约。",
      user: `本章章纲：${chapter.outline}\n上下文包：${JSON.stringify(context)}\n请输出 title 和 content。正文目标 1800-2600 汉字。完成本章目标，使事件产生可观察的状态变化；若本章承担回报，展示其实际影响；留下来自未完成行动、新问题或局势变化的自然续读动力，禁止无因强行反转。`,
      schema: DraftSchema,
    });
    return { ...chapter, title: result.title, content: result.content, status: "待质检", updatedAt: now() };
  }

  async reviewChapter(project: ProjectDetail, chapter: Chapter, context: ContextPackage): Promise<QualityIssue[]> {
    const result = await this.runJson({
      projectId: project.summary.id,
      taskType: "quality-review",
      inputSummary: `第${chapter.number}章语义质检`,
      system: [
        "你是中文长篇网络小说的严格审校员。只报告能够引用本章证据的问题，不做文风偏好式改写。",
        "检查：章纲兑现、人物动机、事件因果、设定与状态一致性、角色知识边界、重复信息、节奏停滞、读者承诺、具体压力、主动行动、情绪回报、回报实际影响与章末推动力。",
        `题材专项检查：${GENRE_PLUGINS[project.summary.genre].qualityChecks.join("；")}。`,
        "只有正文明确违反已审批契约、事实账本或知识边界时才标记为硬性；可以优化但不构成矛盾的问题标记为警告或建议。",
        "evidence 必须是本章中的简短原文或明确的契约/事实条目。没有可验证问题时返回空数组。",
      ].join("\n"),
      user: `题材：${project.summary.genre}\n章节：第${chapter.number}章 ${chapter.title}\n章纲：${chapter.outline}\n上下文：${JSON.stringify(context)}\n正文：\n${chapter.content.slice(0, 16000)}\n输出 issues 数组，每项包含 severity、category、message、evidence。`,
      schema: QualityReviewSchema,
    });
    const evidenceSource = [chapter.content, context.contract, context.volumeGoal, context.rollingOutline, context.relevantFacts, context.forbiddenKnowledge]
      .join("\n").replace(/\s+/g, "");
    return result.issues.map((issue) => {
      const evidence = issue.evidence.trim();
      const supported = evidence.length >= 4 && evidenceSource.includes(evidence.replace(/\s+/g, ""));
      return {
        ...issue,
        severity: issue.severity === "硬性" && !supported ? "警告" as const : issue.severity,
        evidence,
        id: randomUUID(),
        projectId: project.summary.id,
        chapterId: chapter.id,
        status: "待处理" as const,
        createdAt: now(),
      };
    });
  }
}
