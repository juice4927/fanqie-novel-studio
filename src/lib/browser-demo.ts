// 浏览器预览 demo：状态类型、种子数据与纯函数（不含 createBrowserApi 的闭包）。
import { normalizeAestheticProfile } from "../shared/aesthetic-profile";
import { deriveProjectRisk } from "../shared/dashboard-policy";
import type { GenerationDecision } from "../shared/generation-quality";
import type {
  AiSettings,
  Chapter,
  InsightPack,
  NovelRevisionInput,
  NovelRevisionProposal,
  ProjectDetail,
  ProjectSummary,
  RankingSnapshot,
  ResearchBook,
} from "../shared/types";

export interface DemoState {
  projects: ProjectDetail[];
  planVersions: Record<string, number>;
  rankings: RankingSnapshot[];
  books: ResearchBook[];
  insights: InsightPack[];
  settings: AiSettings;
  directorNotes: Record<string, string[]>;
  genDecisions: Record<string, GenerationDecision[]>;
}

export const key = "fanqie-novel-studio.demo.v1";
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();

const QUOTED_REPLACEMENT = /(?:把|将)\s*[“「『"]([\s\S]+?)[”」』"]\s*(?:改成|改为|替换为)\s*[“「『"]([\s\S]*?)[”」』"]/;
const SELECTION_REPLACEMENT = /^(?:改成|改为|替换为)\s*[：:]?\s*[“「『"]?([\s\S]*?)[”」』"]?$/;

function demoRevisionText(sourceText: string, instruction: string, selected: boolean) {
  const quoted = instruction.match(QUOTED_REPLACEMENT);
  if (quoted) {
    if (!sourceText.includes(quoted[1]))
      return { replacement: null, warning: "修改意见中的原文与当前目标文字不一致，请重新选择或核对原文。" };
    return { replacement: sourceText.replace(quoted[1], quoted[2]), warning: null };
  }
  const selection = selected ? instruction.trim().match(SELECTION_REPLACEMENT) : null;
  if (selection) return { replacement: selection[1], warning: null };
  return {
    replacement: null,
    warning: "浏览器预览仅支持“把「原文」改为「新文」”，或选中文字后输入“改为：新文”。复杂联动分析请使用桌面版模型。",
  };
}

export function analyzeBrowserNovelRevision(project: ProjectDetail, input: NovelRevisionInput): NovelRevisionProposal {
  const chapter = project.chapters.find((item) => item.id === input.chapterId);
  if (!chapter) throw new Error("章节不存在");
  const instruction = input.instruction.trim();
  if (!instruction) throw new Error("请先填写修改意见");
  const selected = input.scope === "仅选区";
  const start = selected ? (input.selectionStart ?? -1) : 0;
  const end = selected ? (input.selectionEnd ?? -1) : chapter.content.length;
  if (selected && (start < 0 || end <= start || end > chapter.content.length))
    throw new Error("请先在正文中选中要修改的文字");
  const sourceText = chapter.content.slice(start, end);
  if (selected && input.selectedText !== sourceText) throw new Error("正文选区已经变化，请重新选择");

  const tooLong = !selected && sourceText.length > 16_000;
  const demo = tooLong
    ? { replacement: null, warning: "目标正文超过 16000 字符，请选中具体段落后再使用浏览器预览修改。" }
    : demoRevisionText(sourceText, instruction, selected);
  const changed = demo.replacement !== null && demo.replacement !== sourceText;
  const textRepair = changed
    ? {
        id: `text:${chapter.id}`,
        targetId: chapter.id,
        baseRevision: chapter.revision,
        start,
        end,
        before: sourceText,
        after: demo.replacement!,
        reason: instruction,
        risk: "低" as const,
      }
    : null;
  return {
    sourceChapterId: chapter.id,
    baseContractVersion: project.contract.version,
    instruction,
    authority: input.authority,
    scope: input.scope,
    summary: textRepair
      ? `已生成第${chapter.number}章的确定性文字替换建议。`
      : `未生成第${chapter.number}章的可执行修改。`,
    warnings: [
      "浏览器预览只执行明确文字替换，不推断创作设定、规划或跨章节联动。",
      ...(demo.warning ? [demo.warning] : []),
    ],
    impacts: textRepair
      ? [{ targetType: "章节", location: `第${chapter.number}章`, reason: instruction, risk: "低" }]
      : [],
    contractRepairs: [],
    planRepairs: [],
    chapterRepairs: [],
    textRepair,
  };
}

export function summary(detail: ProjectDetail): ProjectSummary {
  const currentWords = detail.chapters.reduce((sum, chapter) => sum + chapter.wordCount, 0);
  const stockChapters = detail.chapters.filter(
    (chapter) => chapter.status === "已定稿" || chapter.status === "待发布",
  ).length;
  const next = detail.schedule
    .filter((item) => item.status !== "已发布")
    .sort((a, b) => a.publishAt.localeCompare(b.publishAt))[0];
  const safeStockLine = detail.summary.safeStockLine ?? 10;
  return {
    ...detail.summary,
    currentWords,
    chapterCount: detail.chapters.length,
    stockChapters,
    safeStockLine,
    nextPublishAt: next?.publishAt ?? null,
    riskLevel: deriveProjectRisk({
      status: detail.summary.status,
      stockChapters,
      safeStockLine,
      pendingHardIssues: detail.issues.filter((issue) => issue.status === "待处理" && issue.severity === "硬性").length,
    }),
  };
}

function seedProject(): ProjectDetail {
  const projectId = "demo-project";
  const chapters: Chapter[] = [
    {
      id: "demo-chapter-1",
      number: 1,
      title: "停电后的第七分钟",
      outline: "目标：让主角发现异常回声；冲突：救人还是隐藏能力；结果：被陌生人看见。",
      content:
        "整条旧街在七分钟内熄灭了三次。\n\n沈砚站在药店门口，听见黑暗里传来一段只有他能听懂的回声。它没有告诉他未来，只重复了一个尚未发生的求救声。\n\n他循声冲进巷子，把摔倒的老人拖离断裂的招牌。灯光重新亮起时，巷口多了一个撑着红伞的女孩。\n\n她没有看老人，只看着沈砚。\n\n“你也听见了，对吗？”",
      wordCount: 125,
      status: "已定稿",
      batchMode: "逐章",
      isKeyChapter: true,
      revision: 3,
      updatedAt: now(),
    },
    {
      id: "demo-chapter-2",
      number: 2,
      title: "回声的代价",
      outline: "目标：确认能力边界；冲突：每次干预都会失去一段近期记忆；结果：主角决定建立记录系统。",
      content: "",
      wordCount: 0,
      status: "章纲",
      batchMode: "逐章",
      isKeyChapter: false,
      revision: 1,
      updatedAt: now(),
    },
  ];
  return {
    summary: {
      id: projectId,
      title: "回声备忘录",
      genre: "都市脑洞",
      status: "连载准备",
      targetWords: 3000000,
      currentWords: 125,
      chapterCount: 2,
      stockChapters: 1,
      safeStockLine: 10,
      updateCadence: "每日 2 章",
      nextPublishAt: null,
      riskLevel: "注意",
      updatedAt: now(),
    },
    contract: {
      premise: "普通维修员能听见事故发生前的回声，却会因每次干预失去一段记忆。",
      genreSubtype: "异能规则",
      protagonistDesire: "在彻底忘记家人之前找出回声来源。",
      readerPromise: "以现实城市事件验证能力边界，并逐层揭开一套操纵灾难的交易网络。",
      coreEmotion: "救人与自我消失之间的选择，以及被他人记住的温暖。",
      ending: "主角放弃能力保住核心记忆，曾被他救下的人共同完成最后一次干预。",
      immutableRules: ["回声只提前七分钟出现", "每次主动改变结果都会丢失等量近期记忆"],
      prohibitedPatterns: ["无代价升级", "用梦境撤销已发生剧情"],
      majorStateChanges: { include: [], exclude: [] },
      aestheticProfile: normalizeAestheticProfile(),
      version: 2,
      approved: true,
      updatedAt: now(),
    },
    plans: [
      {
        id: "plan-1",
        kind: "宏观阶段",
        title: "第一阶段：证明回声",
        ordinal: 1,
        goal: "建立能力规则与城市事件单元",
        conflict: "救人越多，主角遗忘越快",
        outcome: "形成三人调查小组",
        targetWords: 600000,
        status: "已批准",
        parentId: null,
      },
      {
        id: "plan-2",
        kind: "分卷",
        title: "第一卷：七分钟",
        ordinal: 1,
        goal: "从单次事故追到第一名交易者",
        conflict: "能力暴露与记忆损失",
        outcome: "确认事故可以被人为制造",
        targetWords: 150000,
        status: "已批准",
        parentId: "plan-1",
      },
    ],
    chapters,
    facts: [
      {
        id: "fact-1",
        kind: "能力",
        subject: "沈砚",
        predicate: "回声预警",
        value: "事故前七分钟听见求救回声",
        validFromChapter: 1,
        validToChapter: null,
        evidenceChapter: 1,
        confidence: "已确认",
        knowledgeScope: "沈砚、林柚",
        updatedAt: now(),
      },
    ],
    issues: [
      {
        id: "issue-1",
        projectId,
        chapterId: "demo-chapter-1",
        severity: "建议",
        category: "篇幅",
        message: "示例章节较短，正式连载前需要扩写场景推进。",
        evidence: "当前 125 字",
        status: "待处理",
        createdAt: now(),
      },
    ],
    changes: [],
    schedule: [],
    metrics: [],
    experiments: [],
    insightIds: ["demo-insight"],
    summaries: [],
    expectations: [
      {
        id: "expectation-1",
        title: "红伞女孩为何也能听见回声",
        description: "确认她与回声交易网络的关系",
        sourceChapter: 1,
        expectedPayoffChapter: 8,
        actualPayoffChapter: null,
        status: "待兑现",
        payoffResult: "",
        createdAt: now(),
        updatedAt: now(),
      },
    ],
  };
}

export function seed(): DemoState {
  return {
    projects: [seedProject()],
    planVersions: { "plan-1": 2, "plan-2": 2 },
    rankings: [
      {
        id: "demo-ranking",
        source: "CSV 手动导入",
        listName: "示例公开榜单快照",
        capturedAt: now(),
        status: "成功",
        error: null,
        entries: [
          {
            id: "r1",
            snapshotId: "demo-ranking",
            rank: 1,
            title: "样本甲",
            author: "作者甲",
            genre: "都市脑洞",
            words: 1080000,
            status: "连载",
            tags: ["系统", "成长"],
            sourceUrl: "",
          },
          {
            id: "r2",
            snapshotId: "demo-ranking",
            rank: 2,
            title: "样本乙",
            author: "作者乙",
            genre: "玄幻/仙侠",
            words: 2460000,
            status: "连载",
            tags: ["升级"],
            sourceUrl: "",
          },
          {
            id: "r3",
            snapshotId: "demo-ranking",
            rank: 3,
            title: "样本丙",
            author: "作者丙",
            genre: "现言甜宠",
            words: 680000,
            status: "完结",
            tags: ["双向成长"],
            sourceUrl: "",
          },
        ],
      },
    ],
    books: [
      {
        id: "demo-book",
        title: "结构研究样本",
        author: "已脱敏",
        genre: "都市脑洞",
        sourceType: "TXT",
        chapterCount: 120,
        wordCount: 278000,
        rightsConfirmed: true,
        cloudConsent: false,
        importedAt: now(),
        status: "已拆解",
      },
    ],
    insights: [
      {
        id: "demo-insight",
        name: "高概念都市长篇结构洞察",
        genre: "都市脑洞",
        audienceNeed: "能力迅速兑现，同时保留可验证的边界与代价。",
        openingPromise: "前三章完成异常、验证和首次代价。",
        conflictEngine: "能力解决外部问题，同时制造不可逆的个人损失。",
        emotionalRhythm: "紧张事件与关系修复交替。",
        retentionDevices: "有限倒计时、身份信息差、阶段性规则揭示。",
        longFormEngine: "事件规模、能力规则和组织层级同步扩张。",
        marketGap: "把能力代价与人物关系绑定，而非只做数值升级。",
        risks: "能力失控会削弱悬念；单元事件重复会造成疲劳。",
        evidenceCount: 120,
        confidence: "中",
        createdAt: now(),
      },
    ],
    settings: {
      protocol: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4.1",
      embeddingModel: "text-embedding-3-small",
      hasApiKey: false,
      inputPricePerMillion: 0,
      outputPricePerMillion: 0,
      longTaskTimeoutMinutes: 10,
    },
    directorNotes: {},
    genDecisions: {},
  };
}
