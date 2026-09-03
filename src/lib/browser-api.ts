import {
  decideChangeRequest as decideChangeRequestDraft,
  prepareChangeRequest,
  resolveChangeTargetVersion,
} from "../shared/change-request-service";
import { buildChapterBatchPreview } from "../shared/chapter-batch-service";
import {
  assertChapterTransition,
  deriveChapterBatchMode,
  findMatchingApproval,
  isProtectedChapterEdit,
  prepareChapterSave,
} from "../shared/chapter-lifecycle";
import { compileProjectChapterContext } from "../shared/context-compiler";
import { approveContractDraft, findApprovedContractChange, prepareContractUpdate } from "../shared/contract-service";
import {
  assembleDashboard,
  collectDashboardActivity,
  localDayEndExclusive,
  visibleProjectSummaries,
} from "../shared/dashboard-policy";
import { prepareExpectationSave } from "../shared/expectation-service";
import { prepareFactSave } from "../shared/fact-service";
import { computeGenerationQuality } from "../shared/generation-quality";
import { analyzeMetrics, parseMetricsCsv } from "../shared/metrics";
import {
  applyContractRepairs,
  applyTextRepair,
  chapterRevisionSnapshot,
  planRevisionSnapshot,
  sameRevisionSnapshot,
} from "../shared/novel-revision";
import { approvePlanDraft, preparePlanSave } from "../shared/plan-service";
import { prepareProjectCreation, prepareProjectUpdate } from "../shared/project-service";
import { prepareQualityIssueSave, resolveQualityIssue } from "../shared/quality-issue-service";
import { parseRankingCsv } from "../shared/ranking-csv";
import { prepareLocalResearchBook } from "../shared/research-import-service";
import { prepareReviewExperiment } from "../shared/review-experiment-service";
import { prepareScheduleSave } from "../shared/schedule-service";
import { prepareFinalizedChapterSummaries } from "../shared/summaries";
import type {
  AppApi,
  BookConceptCandidate,
  BookConceptInput,
  BookConceptSkeleton,
  ChangeRequest,
  Chapter,
  ConceptCandidate,
  ContextPackage,
  CreateProjectInput,
  DashboardData,
  ExpectationEntry,
  Genre,
  ImportPreview,
  InsightPack,
  LedgerFact,
  NovelRevisionApplyResult,
  PlanNode,
  ProjectDetail,
  ProjectPatch,
  QualityIssue,
  RankingAnalytics,
  RankingSnapshot,
  ReviewExperiment,
  ScheduleItem,
  StoryContract,
} from "../shared/types";
import type { DemoState } from "./browser-demo";
import { analyzeBrowserNovelRevision, id, key, now, seed, summary } from "./browser-demo";

function load(): DemoState {
  try {
    const raw = localStorage.getItem(key);
    const state = raw ? (JSON.parse(raw) as DemoState) : seed();
    state.settings.protocol ??= "openai-compatible";
    state.directorNotes ??= {};
    state.genDecisions ??= {};
    state.planVersions ??= {};
    for (const project of state.projects) {
      for (const plan of project.plans) {
        state.planVersions[plan.id] ??= plan.status === "已批准" ? 2 : 1;
      }
    }
    return state;
  } catch {
    return seed();
  }
}

function save(state: DemoState) {
  localStorage.setItem(key, JSON.stringify(state));
}
function getProject(state: DemoState, projectId: string) {
  const project = state.projects.find((item) => item.summary.id === projectId);
  if (!project) throw new Error("项目不存在");
  project.summaries ??= [];
  project.expectations ??= [];
  project.experiments ??= [];
  project.chapters.forEach((chapter) => {
    chapter.linkedExpectationIds ??= [];
  });
  project.summary = summary(project);
  return project;
}

function browserPlanVersion(state: DemoState, plan: PlanNode) {
  return state.planVersions[plan.id] ?? (plan.status === "已批准" ? 2 : 1);
}

function browserRankingAnalytics(snapshots: RankingSnapshot[]): RankingAnalytics {
  const entries = snapshots.flatMap((snapshot) => snapshot.entries);
  const group = (values: string[]) =>
    [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())].map(
      ([name, count]) => ({ name, count }),
    );
  return {
    snapshotCount: snapshots.length,
    sampleSize: entries.length,
    timeRange: snapshots.length ? snapshots.map((item) => item.capturedAt.slice(0, 10)).sort()[0] : "暂无数据",
    confidence: snapshots.length >= 2 ? "中" : "低",
    genreDistribution: group(entries.map((item) => item.genre)),
    wordBands: group(
      entries.map((item) =>
        item.words < 300000
          ? "30万以下"
          : item.words < 1000000
            ? "30–100万"
            : item.words < 2000000
              ? "100–200万"
              : "200万以上",
      ),
    ),
    statusDistribution: group(entries.map((item) => item.status)),
    newEntrants: [],
    movers: [],
    continuousAppearances: [],
    marketOpportunities: [],
  };
}

function browserConceptSkeleton(concept: BookConceptCandidate): BookConceptSkeleton {
  if (concept.genreElements.includes("探案"))
    return {
      protagonistArc:
        "她从只想证明自己没有失职，走到敢于承担调查后果、建立可靠证据标准，并最终以公开真相重新定义职业尊严。",
      keyRelationships: [
        "主角与事故幸存者：从相互怀疑到共同还原现场，对方掌握线索却隐瞒自身责任",
        "主角与同行调查者：既争夺职业机会又共享证据方法，对规则边界持相反立场",
      ],
      worldRules: [
        "每条事故线索必须由现场痕迹、运行记录或证人交叉验证，异常提示不能直接作为结论",
        "调查会消耗职业信用和现实资源，越接近事故源头，主角承担的法律与人际风险越高",
      ],
      majorForces: [
        "主角的职业协作网络：依靠专业能力与基层信息还原事故",
        "掩盖安全隐患的利益联盟：依靠流程漏洞、关系掩护和信息差转移责任",
      ],
      timelineAnchors: [
        "开局前：主角因一次错误定责失去职业信任",
        "开局触发：一处反常痕迹揭示事故并非偶然",
        "中期节点：证据指向主角曾信任的职业体系并迫使她公开站队",
        "终局兑现：事故链完成司法与行业双重定性，主角建立新的调查规范",
      ],
    };
  if (concept.genreElements.includes("乡村"))
    return {
      protagonistArc:
        "她从把荒山当作最后退路，走到理解土地、合作与长期责任的代价，最终成为能够让个人选择与地方共同发展并存的经营者。",
      keyRelationships: [
        "主角与村集体负责人：围绕承包边界彼此试探，双方必须在收益与公共责任之间达成新规则",
        "主角与返乡技术伙伴：一个重视长期改造，一个急于商业回报，路线冲突决定产业方向",
      ],
      worldRules: [
        "土地改造受承包合同、生态条件和农业周期约束，投入不能立即兑换收益",
        "产业扩张必须获得村民协作并处理利益分配，个人成功不能绕过社区成本",
      ],
      majorForces: [
        "荒山改造合作组：拥有合同、劳动力和技术试验能力",
        "等待低价收地的外部资本：拥有资金、渠道和地方关系，试图利用短期失败取得控制权",
      ],
      timelineAnchors: [
        "开局前：主角被迫让出工作名额并失去家庭资源",
        "开局触发：旧承包合同使她意外获得荒山经营权",
        "中期节点：首次产业成果引发土地控制权和分配规则争夺",
        "终局兑现：荒山形成稳定产业，合同与社区治理规则得到重新确认",
      ],
    };
  return {
    protagonistArc:
      "她从只求尽快止损、拒绝再次信任任何人，走到能够建立合作规则、承担共同体责任，并在终局以平等关系守住自己的事业和选择。",
    keyRelationships: [
      "主角与供销社老采购员：从互相防备到共同恢复渠道，老采购员熟悉地方需求却害怕再次担责",
      "主角与前夫家利益代表：围绕资产和名誉持续对抗，对方每次施压都会暴露供应链漏洞",
      "主角与女性互助团队：成员各有生计目标，合作成果与分配矛盾共同推动群像线",
    ],
    worldRules: [
      "供销社的采购、库存和运输必须符合真实经营周期，成果不能凭空出现",
      "主角只能依靠职业能力、渠道谈判和团队协作解决问题，每次扩张都会增加供给与管理风险",
    ],
    majorForces: [
      "主角经营团队：目标是让供销社恢复稳定经营，资源是专业能力、基层渠道和社区信任",
      "旧利益网络：目标是维持渠道控制并夺回资产控制权，资源是人情关系、合同漏洞和舆论压力",
    ],
    timelineAnchors: [
      "开局前：主角在婚姻与工作中长期替他人承担损失",
      "开局触发：离婚与资产争夺当天，她接手濒临倒闭的供销社",
      "中期节点：团队首次扩张后因分配方式和发展路线出现不可逆分裂",
      "终局兑现：地方供应体系完成重组，供销社形成可持续制度并由团队共同治理",
    ],
  };
}

export function createBrowserApi(): AppApi {
  const state = load();
  const persist = () => save(state);
  const createProject = (input: CreateProjectInput) => {
    const projectId = id();
    const prepared = prepareProjectCreation(input, {
      projectId,
      updatedAt: now(),
    });
    const project: ProjectDetail = {
      summary: prepared.summary,
      contract: prepared.contract,
      plans: [],
      chapters: [],
      facts: [],
      issues: [],
      changes: [],
      schedule: [],
      metrics: [],
      experiments: [],
      insightIds: [],
      summaries: [],
      expectations: [],
    };
    state.projects.unshift(project);
    persist();
    return summary(project);
  };
  return {
    async getDashboard(): Promise<DashboardData> {
      return assembleDashboard(
        state.projects.map((item) => summary(item)),
        collectDashboardActivity(state.projects, localDayEndExclusive(new Date())),
      );
    },
    async listProjects() {
      return visibleProjectSummaries(state.projects.map(summary));
    },
    async createProject(input: CreateProjectInput) {
      return createProject(input);
    },
    async generateBookConcepts(input: BookConceptInput): Promise<BookConceptCandidate[]> {
      const ideas = [
        ["她能看见事故留下的断点", "被错误定责的安全调查员，发现每起事故现场都会显露一处可验证的因果断点。"],
        [
          "离婚当天，我接手了倒闭供销社",
          "被夺走婚房的基层职员接手濒临倒闭的供销社，用一张异常进货单串起女性互助生意。",
        ],
        ["全家等我认输，我却承包了荒山", "返乡姑娘被逼让出工作名额，她用一份旧承包合同把荒山变成整个县的新产业。"],
      ];
      const routes = [
        {
          secondaryGenres: ["悬疑", "成长"] as const,
          genreElements: ["现代都市", "探案"],
          openingMechanism: "事故现场暴露一处反常断点",
          growthCarrier: "职业调查能力与证据网络",
          primaryPayoff: "还原事故真相并夺回职业尊严",
        },
        {
          secondaryGenres: ["经营", "群像"] as const,
          genreElements: ["年代", "经商"],
          openingMechanism: "接手即将倒闭的供销社",
          growthCarrier: "商品渠道与女性互助团队",
          primaryPayoff: "经营成果改变个人和社区处境",
        },
        {
          secondaryGenres: ["冒险", "经营"] as const,
          genreElements: ["乡村", "种田"],
          openingMechanism: "旧承包合同引出荒山争夺",
          growthCarrier: "土地改造技术与产业合作",
          primaryPayoff: "守住土地并建立区域产业",
        },
      ];
      return ideas.map(([title, premise], index) => ({
        id: id(),
        title,
        premise: `${premise} 她必须在事业扩张与亲密关系重建中守住自己的选择。`,
        genreSubtype: input.genre === "年代重生" ? "年代经营" : "现实成长",
        secondaryGenres: [...routes[index].secondaryGenres],
        genreElements: routes[index].genreElements,
        openingMechanism: routes[index].openingMechanism,
        growthCarrier: routes[index].growthCarrier,
        primaryPayoff: routes[index].primaryPayoff,
        protagonistDesire: "夺回人生选择权，并建立不依附任何人的事业与关系。",
        readerPromise: "持续提供止损反击、能力变现、关系升温与阶段性事业成果。",
        coreEmotion: index === 1 ? "治愈与重建" : "憋屈后的清醒反击",
        ending: "主角解决最初的不公，建立可持续事业，并以平等关系完成情感选择。",
        immutableRules: ["主角依靠行动和能力解决问题", "每次升级都带来新的责任与代价"],
        prohibitedPatterns: ["反派无理由降智", "用连续误会拖延关系"],
        audience: "偏好女性成长、现实经营与稳定情绪回报的番茄女频读者",
        commercialHook: "低谷止损开局，身份反差和事业成果形成连续可见回报。",
        longFormEngine: "个人止损、团队经营、区域产业三轮扩张，关系与现实阻力在每轮同步升级。",
      }));
    },
    async createProjectFromConcept(input: BookConceptInput, concept: BookConceptCandidate) {
      const created = createProject({ ...input, title: concept.title });
      const project = getProject(state, created.id);
      project.contract = {
        ...project.contract,
        premise: concept.premise,
        genreSubtype: concept.genreSubtype,
        secondaryGenres: concept.secondaryGenres,
        genreElements: concept.genreElements,
        customGenreDirection: input.customGenreDirection ?? "",
        audience: concept.audience,
        commercialHook: concept.commercialHook,
        openingMechanism: concept.openingMechanism,
        growthCarrier: concept.growthCarrier,
        primaryPayoff: concept.primaryPayoff,
        longFormEngine: concept.longFormEngine,
        protagonistDesire: concept.protagonistDesire,
        readerPromise: concept.readerPromise,
        ...browserConceptSkeleton(concept),
        coreEmotion: concept.coreEmotion,
        ending: concept.ending,
        immutableRules: concept.immutableRules,
        prohibitedPatterns: concept.prohibitedPatterns,
      };
      persist();
      return summary(project);
    },
    async deleteProject(projectId, confirmationTitle) {
      const project = getProject(state, projectId);
      if (project.summary.title !== confirmationTitle.trim()) throw new Error("输入的书名与作品名不一致");
      state.projects = state.projects.filter((item) => item.summary.id !== projectId);
      for (const plan of project.plans) delete state.planVersions[plan.id];
      persist();
      return "浏览器预览作品已从 localStorage 移除";
    },
    async getProject(projectId) {
      const project = getProject(state, projectId);
      return structuredClone({
        ...project,
        chapters: project.chapters.map((chapter) => ({ ...chapter, content: "" })),
      });
    },
    async getChapter(projectId, chapterId) {
      const chapter = getProject(state, projectId).chapters.find((item) => item.id === chapterId);
      if (!chapter) throw new Error("章节不存在");
      return structuredClone(chapter);
    },
    async updateProject(projectId, patch: ProjectPatch) {
      const project = getProject(state, projectId);
      project.summary = prepareProjectUpdate(project.summary, patch, now());
      persist();
      return summary(project);
    },
    async saveContract(projectId, contract: StoryContract) {
      const project = getProject(state, projectId);
      const previous = project.contract;
      const updatedAt = now();
      const update = prepareContractUpdate(previous, contract, updatedAt);
      if (!update.changed) return previous;
      const approval = previous.approved ? findApprovedContractChange(project.changes, previous.version) : undefined;
      if (previous.approved && !approval) throw new Error("已审批创作契约只能通过匹配的已批准变更单修改");
      if (approval) approval.status = "已应用";
      project.contract = update.contract;
      project.summary.updatedAt = updatedAt;
      persist();
      return project.contract;
    },
    async suggestAestheticProfile(_projectId, _contract) {
      throw new Error("AI 审美优化需要在桌面版配置模型后使用");
    },
    async approveContract(projectId) {
      const project = getProject(state, projectId);
      const updatedAt = now();
      project.contract = approveContractDraft(project.contract, updatedAt);
      project.summary.status = "大纲审批";
      project.summary.updatedAt = updatedAt;
      persist();
      return project.contract;
    },
    async savePlan(projectId, plan: PlanNode) {
      const project = getProject(state, projectId);
      const index = project.plans.findIndex((item) => item.id === plan.id);
      const previous = index >= 0 ? project.plans[index] : undefined;
      const prepared = preparePlanSave(previous, plan, plan.id || id());
      if (prepared.noOp) return previous!;
      if (prepared.protectedEdit) {
        const approval = findMatchingApproval(
          project.changes,
          "规划",
          previous!.id,
          browserPlanVersion(state, previous!),
        );
        if (!approval) throw new Error("已批准规划只能通过匹配的已批准变更单修改");
        approval.status = "已应用";
      }
      const next = prepared.plan;
      if (index >= 0) project.plans[index] = next;
      else project.plans.push(next);
      state.planVersions[next.id] = previous ? browserPlanVersion(state, previous) + 1 : 1;
      project.summary.updatedAt = now();
      persist();
      return next;
    },
    async approvePlan(projectId, planId) {
      const project = getProject(state, projectId);
      const planIndex = project.plans.findIndex((item) => item.id === planId);
      const plan = project.plans[planIndex];
      const approved = approvePlanDraft(plan, project.contract);
      project.plans[planIndex] = approved;
      state.planVersions[planId] = browserPlanVersion(state, approved) + 1;
      project.summary.updatedAt = now();
      persist();
    },
    async generatePlanningDraft() {
      throw new Error("AI 规划生成需要在桌面版配置模型后使用");
    },
    async reviewPlanning() {
      throw new Error("AI 规划审核需要在桌面版配置模型后使用");
    },
    async applyPlanningRepairs() {
      throw new Error("AI 规划修复需要在桌面版使用");
    },
    async analyzeNovelRevision(projectId, input) {
      return analyzeBrowserNovelRevision(getProject(state, projectId), input);
    },
    async applyNovelRevision(projectId, proposal, selectedRepairIds): Promise<NovelRevisionApplyResult> {
      const selected = new Set(selectedRepairIds);
      if (!selected.size) throw new Error("请至少选择一项修改");
      if (selected.size !== selectedRepairIds.length) throw new Error("修改提案包含重复项目");
      const allRepairIds = new Set([
        ...proposal.contractRepairs.map((item) => item.id),
        ...proposal.planRepairs.map((item) => item.id),
        ...proposal.chapterRepairs.map((item) => item.id),
        ...(proposal.textRepair ? [proposal.textRepair.id] : []),
      ]);
      if ([...selected].some((repairId) => !allRepairIds.has(repairId))) throw new Error("修改提案包含未知项目");

      const project = getProject(state, projectId);
      const contractRepairs = proposal.contractRepairs.filter((item) => selected.has(item.id));
      if (contractRepairs.length && project.contract.version !== proposal.baseContractVersion)
        throw new Error("创作设定版本已变化，请重新分析修改意见");
      const nextContract = contractRepairs.length ? applyContractRepairs(project.contract, contractRepairs) : null;
      const plansById = new Map(project.plans.map((item) => [item.id, item]));
      const planRepairs = proposal.planRepairs.filter((item) => selected.has(item.id));
      for (const repair of planRepairs) {
        const current = plansById.get(repair.targetId);
        if (!current || !sameRevisionSnapshot(planRevisionSnapshot(current), repair.before))
          throw new Error(`规划“${repair.location}”已变化，请重新分析修改意见`);
      }
      const chaptersById = new Map(project.chapters.map((item) => [item.id, item]));
      const chapterRepairs = proposal.chapterRepairs.filter((item) => selected.has(item.id));
      for (const repair of chapterRepairs) {
        const current = chaptersById.get(repair.targetId);
        if (
          !current ||
          current.revision !== repair.baseRevision ||
          !sameRevisionSnapshot(chapterRevisionSnapshot(current), repair.before)
        )
          throw new Error(`${repair.location}已变化，请重新分析修改意见`);
      }
      if (proposal.textRepair && selected.has(proposal.textRepair.id)) {
        const current = chaptersById.get(proposal.textRepair.targetId);
        if (!current) throw new Error("正文修改目标不存在");
        applyTextRepair(current, proposal.textRepair);
      }

      const changeRequestIds: string[] = [];
      const approveProtectedChange = async (
        targetKind: "创作契约" | "规划" | "章节",
        targetId: string,
        title: string,
        before: unknown,
        after: unknown,
      ) => {
        const change = await this.saveChangeRequest(projectId, {
          id: "",
          targetKind,
          targetId,
          baseVersion: 0,
          title,
          reason: proposal.instruction,
          beforeValue: JSON.stringify(before),
          afterValue: JSON.stringify(after),
          impact: proposal.summary,
          rollback: "从目标历史版本恢复本次修改前内容",
          status: "待审批",
          createdAt: "",
        });
        await this.decideChangeRequest(projectId, change.id, "批准");
        changeRequestIds.push(change.id);
      };

      const appliedTargets: string[] = [];
      if (nextContract) {
        if (project.contract.approved)
          await approveProtectedChange(
            "创作契约",
            "contract",
            "浏览器修改意见联动创作设定",
            project.contract,
            nextContract,
          );
        await this.saveContract(projectId, nextContract);
        appliedTargets.push("创作设定");
      }
      for (const repair of planRepairs) {
        const current = plansById.get(repair.targetId)!;
        if (current.status === "已批准")
          await approveProtectedChange(
            "规划",
            current.id,
            `浏览器修改意见联动：${current.title}`,
            repair.before,
            repair.after,
          );
        await this.savePlan(projectId, { ...current, ...repair.after });
        appliedTargets.push(repair.location);
      }
      const affectedChapterIds = new Set([
        ...chapterRepairs.map((item) => item.targetId),
        ...(proposal.textRepair && selected.has(proposal.textRepair.id) ? [proposal.textRepair.targetId] : []),
      ]);
      for (const chapterId of affectedChapterIds) {
        const current = chaptersById.get(chapterId)!;
        const metadata = chapterRepairs.find((item) => item.targetId === chapterId);
        const text =
          proposal.textRepair?.targetId === chapterId && selected.has(proposal.textRepair.id)
            ? proposal.textRepair
            : null;
        const next = {
          ...current,
          ...(metadata?.after ?? {}),
          content: text ? applyTextRepair(current, text) : current.content,
        };
        if (["已定稿", "待发布", "已发布"].includes(current.status))
          await approveProtectedChange("章节", current.id, `浏览器修改意见联动：第${current.number}章`, current, next);
        await this.saveChapter(projectId, next);
        appliedTargets.push(`第${current.number}章`);
      }
      return { appliedTargets, changeRequestIds };
    },
    async saveChapter(projectId, chapter: Chapter, mode = "version") {
      const project = getProject(state, projectId);
      const existing = project.chapters.findIndex((item) => item.id === chapter.id);
      const previous = existing >= 0 ? project.chapters[existing] : undefined;
      const protectedEdit = isProtectedChapterEdit(previous, chapter);
      if (protectedEdit) {
        const approval = findMatchingApproval(project.changes, "章节", previous!.id, previous!.revision);
        if (!approval) throw new Error("已定稿或进入发布流程的章节只能通过匹配的已批准变更单修改");
        approval.status = "已应用";
      }
      let endingExpectationId = chapter.endingExpectationId ?? null;
      if (chapter.endingExpectation?.trim()) {
        const old = project.expectations.find((item) => item.id === endingExpectationId);
        const expectation: ExpectationEntry = {
          id: endingExpectationId || id(),
          title: chapter.endingExpectation.trim(),
          description: chapter.endingExpectation.trim(),
          sourceChapter: chapter.number,
          expectedPayoffChapter: chapter.expectationTargetChapter ?? null,
          actualPayoffChapter: old?.actualPayoffChapter ?? null,
          status: old?.status ?? "待兑现",
          payoffResult: old?.payoffResult ?? "",
          createdAt: old?.createdAt ?? now(),
          updatedAt: now(),
        };
        const index = project.expectations.findIndex((item) => item.id === expectation.id);
        if (index >= 0) project.expectations[index] = expectation;
        else project.expectations.push(expectation);
        endingExpectationId = expectation.id;
      }
      const updatedAt = now();
      const next = prepareChapterSave(chapter, {
        previous,
        protectedEdit,
        createRevision: mode === "version",
        chapterId: chapter.id || id(),
        endingExpectationId,
        batchMode: deriveChapterBatchMode(chapter, {
          facts: project.facts,
          issues: project.issues,
          plans: project.plans,
          genre: project.summary.genre,
          majorStateChanges: project.contract.majorStateChanges,
        }),
        updatedAt,
      });
      if (existing >= 0) project.chapters[existing] = next;
      else project.chapters.push(next);
      project.summary.updatedAt = updatedAt;
      persist();
      return next;
    },
    async saveExpectation(projectId, expectation: ExpectationEntry) {
      const project = getProject(state, projectId);
      const previous = project.expectations.find((item) => item.id === expectation.id);
      const next = prepareExpectationSave(previous, expectation, {
        expectationId: expectation.id || id(),
        createdAt: now(),
        updatedAt: now(),
      });
      const index = project.expectations.findIndex((item) => item.id === next.id);
      if (index >= 0) project.expectations[index] = next;
      else project.expectations.push(next);
      persist();
      return next;
    },
    async transitionChapter(projectId, chapterId, status: Chapter["status"]) {
      const project = getProject(state, projectId);
      const chapter = project.chapters.find((item) => item.id === chapterId);
      if (!chapter) throw new Error("章节不存在");
      assertChapterTransition(chapter.status, status, chapterId, project.issues);
      const updatedAt = now();
      const next = prepareChapterSave(chapter, {
        previous: chapter,
        forcedStatus: status,
        protectedEdit: false,
        createRevision: true,
        chapterId: chapter.id,
        endingExpectationId: chapter.endingExpectationId ?? null,
        batchMode: deriveChapterBatchMode(chapter, {
          facts: project.facts,
          issues: project.issues,
          plans: project.plans,
          genre: project.summary.genre,
          majorStateChanges: project.contract.majorStateChanges,
        }),
        updatedAt,
      });
      project.chapters[project.chapters.indexOf(chapter)] = next;
      if (status === "已定稿" && chapter.status !== "已定稿") {
        for (const summary of prepareFinalizedChapterSummaries(project, next, updatedAt)) {
          const summaryIndex = project.summaries.findIndex((item) => item.id === summary.id);
          if (summaryIndex >= 0) project.summaries[summaryIndex] = summary;
          else project.summaries.push(summary);
        }
      }
      project.summary.updatedAt = updatedAt;
      persist();
      return {
        chapter: next,
        ledgerExtraction: {
          status: status === "已定稿" ? ("未配置" as const) : ("不适用" as const),
          candidateCount: 0,
        },
      };
    },
    onChapterFactsExtracted() {
      return () => {};
    },
    async compileContext(projectId, chapterId): Promise<ContextPackage> {
      const project = getProject(state, projectId);
      const chapter = project.chapters.find((item) => item.id === chapterId)!;
      return compileProjectChapterContext(project, chapter);
    },
    async searchProject(projectId, query, offset = 0, limit = 50) {
      return getProject(state, projectId)
        .chapters.filter((chapter) => `${chapter.title}\n${chapter.content}`.includes(query))
        .map((chapter) => ({
          id: chapter.id,
          type: "章节" as const,
          title: `第${chapter.number}章 ${chapter.title}`,
          excerpt: chapter.content.slice(0, 120),
          chapterNumber: chapter.number,
        }))
        .slice(offset, offset + limit);
    },
    async listRevisions() {
      return [];
    },
    async restoreRevision() {
      throw new Error("浏览器预览不包含持久化历史版本");
    },
    async runQualityCheck(projectId, chapterId) {
      const project = getProject(state, projectId);
      const chapterIndex = project.chapters.findIndex((item) => item.id === chapterId);
      const chapter = project.chapters[chapterIndex];
      if (!chapter) throw new Error("章节不存在");
      const issues: QualityIssue[] = [];
      if (chapter.wordCount < 1200)
        issues.push({
          id: id(),
          projectId,
          chapterId,
          severity: "警告",
          category: "篇幅",
          message: `本章仅 ${chapter.wordCount} 字，可能不足以完成目标`,
          evidence: "",
          status: "待处理",
          createdAt: now(),
        });
      if (chapter.isKeyChapter && chapter.batchMode === "五章批次")
        issues.push({
          id: id(),
          projectId,
          chapterId,
          severity: "硬性",
          category: "审批模式",
          message: "关键章必须逐章审批",
          evidence: "",
          status: "待处理",
          createdAt: now(),
        });
      const plan = prepareQualityIssueSave(project.issues, chapterId, issues);
      for (const issue of plan.upserts) {
        const index = project.issues.findIndex((item) => item.id === issue.id);
        if (index >= 0) project.issues[index] = issue;
        else project.issues.push(issue);
      }
      const batchMode = plan.forceSequentialReview ? "逐章" : chapter.batchMode;
      const updatedAt = now();
      if (chapter.status === "草稿" || batchMode !== chapter.batchMode) {
        project.chapters[chapterIndex] = prepareChapterSave(
          { ...chapter, batchMode },
          {
            previous: chapter,
            forcedStatus: chapter.status === "草稿" ? "待质检" : undefined,
            protectedEdit: false,
            createRevision: true,
            chapterId: chapter.id,
            endingExpectationId: chapter.endingExpectationId ?? null,
            batchMode,
            updatedAt,
          },
        );
      }
      project.summary.updatedAt = updatedAt;
      persist();
      return issues;
    },
    async reviseChapterFromQuality() {
      throw new Error("AI 修订正文需要在桌面版配置模型后使用");
    },
    async extractChapterFacts() {
      throw new Error("状态候选提取需要在桌面版配置 AI 后使用");
    },
    async saveFact(projectId, fact: LedgerFact) {
      const project = getProject(state, projectId);
      const updatedAt = now();
      const { fact: next, replacement } = prepareFactSave(project.facts, fact, { factId: fact.id || id(), updatedAt });
      if (replacement) {
        const replacementIndex = project.facts.findIndex((item) => item.id === replacement.id);
        project.facts[replacementIndex] = replacement;
      }
      const factIndex = project.facts.findIndex((item) => item.id === next.id);
      if (factIndex >= 0) project.facts[factIndex] = next;
      else project.facts.push(next);
      project.summary.updatedAt = updatedAt;
      persist();
      return next;
    },
    async resolveIssue(projectId, issueId, status) {
      const project = getProject(state, projectId);
      const issueIndex = project.issues.findIndex((item) => item.id === issueId);
      project.issues[issueIndex] = resolveQualityIssue(project.issues[issueIndex], status);
      project.summary.updatedAt = now();
      persist();
    },
    async saveChangeRequest(projectId, change: ChangeRequest) {
      const project = getProject(state, projectId);
      const baseVersion = resolveChangeTargetVersion(change.targetKind, change.targetId, {
        contractVersion: project.contract.version,
        planVersion: (targetId) => {
          const plan = project.plans.find((item) => item.id === targetId);
          return plan ? browserPlanVersion(state, plan) : undefined;
        },
        chapterVersion: (targetId) => project.chapters.find((item) => item.id === targetId)?.revision,
      });
      const next = prepareChangeRequest(change, {
        id: id(),
        baseVersion,
        createdAt: now(),
      });
      project.changes.unshift(next);
      persist();
      return next;
    },
    async decideChangeRequest(projectId, changeId, decision) {
      const project = getProject(state, projectId);
      const changeIndex = project.changes.findIndex((item) => item.id === changeId);
      const next = decideChangeRequestDraft(project.changes[changeIndex], decision);
      project.changes[changeIndex] = next;
      persist();
    },
    async saveSchedule(projectId, item: ScheduleItem) {
      const project = getProject(state, projectId);
      const chapterIndex = project.chapters.findIndex((entry) => entry.id === item.chapterId);
      const chapter = project.chapters[chapterIndex];
      const updatedAt = now();
      const plan = prepareScheduleSave(item, {
        scheduleId: item.id || id(),
        projectId,
        projectTitle: project.summary.title,
        chapter,
        issues: project.issues,
      });
      if (plan.transitionTo) {
        project.chapters[chapterIndex] = prepareChapterSave(
          { ...chapter, status: plan.transitionTo },
          {
            previous: chapter,
            forcedStatus: plan.transitionTo,
            protectedEdit: false,
            createRevision: true,
            chapterId: chapter.id,
            endingExpectationId: chapter.endingExpectationId ?? null,
            batchMode: deriveChapterBatchMode(chapter, {
              facts: project.facts,
              issues: project.issues,
              plans: project.plans,
              genre: project.summary.genre,
              majorStateChanges: project.contract.majorStateChanges,
            }),
            updatedAt,
          },
        );
      }
      const index = project.schedule.findIndex((entry) => entry.id === plan.schedule.id);
      if (index >= 0) project.schedule[index] = plan.schedule;
      else project.schedule.push(plan.schedule);
      project.summary.updatedAt = updatedAt;
      persist();
      return plan.schedule;
    },
    async listRankings() {
      return structuredClone(state.rankings);
    },
    async importRankingCsv(csvText, listName) {
      const snapshot = parseRankingCsv(csvText, listName, {
        createId: id,
        capturedAt: now(),
      });
      state.rankings.unshift(snapshot);
      persist();
      return snapshot;
    },
    async capturePublicRanking() {
      throw new Error("公开页采集仅在桌面版运行，浏览器预览请使用 CSV");
    },
    async listRankingSchedules() {
      return [];
    },
    async saveRankingSchedule() {
      throw new Error("定时采榜仅在桌面版运行");
    },
    async runRankingSchedule() {
      throw new Error("定时采榜仅在桌面版运行");
    },
    async deleteRankingSchedule() {},
    async getRankingAnalytics() {
      return browserRankingAnalytics(state.rankings);
    },
    async listResearchBooks() {
      return structuredClone(state.books);
    },
    async previewResearchFile() {
      return null;
    },
    async importResearchBook(preview: ImportPreview, genre: Genre, rightsConfirmed, cloudConsent) {
      const book = prepareLocalResearchBook(preview, genre, rightsConfirmed, cloudConsent, {
        createId: id,
        currentTimestamp: now,
      });
      state.books.unshift(book);
      persist();
      return book;
    },
    async importPublicResearchSample() {
      throw new Error("公开试读采集仅在桌面版运行");
    },
    async listInsights() {
      return structuredClone(state.insights);
    },
    async createInsight(input) {
      const insight: InsightPack = { ...input, id: id(), createdAt: now() };
      state.insights.unshift(insight);
      persist();
      return insight;
    },
    async deconstructResearchBook(bookId) {
      const book = state.books.find((item) => item.id === bookId)!;
      book.status = "已拆解";
      const insight: InsightPack = {
        id: id(),
        name: `${book.title} · 本地结构统计`,
        genre: book.genre,
        audienceNeed: "需结合章节证据人工确认。",
        openingPromise: "已建立篇幅和章节基线。",
        conflictEngine: "待配置模型后补充语义拆解。",
        emotionalRhythm: "本地预览不读取原始样本。",
        retentionDevices: "待人工填写。",
        longFormEngine: "待人工验证。",
        marketGap: "需与多本样本交叉验证。",
        risks: "浏览器预览仅展示流程。",
        evidenceCount: book.chapterCount,
        confidence: "低",
        createdAt: now(),
      };
      state.insights.unshift(insight);
      persist();
      return insight;
    },
    async listResearchAnalyses() {
      return [];
    },
    async attachInsights(projectId, insightIds) {
      getProject(state, projectId).insightIds = insightIds;
      persist();
    },
    async generateConcepts(projectId): Promise<ConceptCandidate[]> {
      const project = getProject(state, projectId);
      if (!project.insightIds.length) throw new Error("请先关联洞察");
      return ["回声协议", "逆光档案", "城市第七码"].map((title, index) => ({
        id: id(),
        title,
        oneLinePitch: [
          "维修员以记忆为代价改写事故结果。",
          "记者追查能被提前听见的城市灾难。",
          "普通人组成互助网络对抗灾难交易者。",
        ][index],
        audience: "偏好现实锚点与高概念悬念的读者",
        coreConflict: "救人越多，个人付出的不可逆代价越大",
        differentiation: "能力代价直接改变人物关系",
        longFormCapacity: "事件规模、规则和组织层级三线扩张",
        originalityRisk: "低",
      }));
    },
    async generateChapterDraft() {
      throw new Error("浏览器预览不调用云模型，请在桌面版配置 API 密钥");
    },
    async previewChapterBatch(projectId, chapterId) {
      const project = getProject(state, projectId);
      return buildChapterBatchPreview(
        project,
        state.settings,
        chapterId,
        (chapter) => compileProjectChapterContext(project, chapter).estimatedTokens,
      );
    },
    async generateChapterBatch() {
      throw new Error("浏览器预览不调用云模型，请在桌面版运行五章批次");
    },
    async getAiSettings() {
      return state.settings;
    },
    async saveAiSettings(settings, apiKey) {
      const providerChanged =
        state.settings.protocol !== settings.protocol ||
        new URL(state.settings.baseUrl).origin !== new URL(settings.baseUrl).origin;
      state.settings = {
        ...settings,
        hasApiKey: Boolean(apiKey) || (!providerChanged && state.settings.hasApiKey),
      };
      persist();
      return state.settings;
    },
    async listAiJobs() {
      return [];
    },
    async cancelAiJob() {
      return false;
    },
    async retryAiJob() {
      throw new Error("AI 任务重试仅在桌面版可用");
    },
    async exportProject(projectId, format) {
      const project = getProject(state, projectId);
      const content = project.chapters
        .filter((chapter) => ["已定稿", "待发布", "已发布"].includes(chapter.status))
        .map((chapter) => `第${chapter.number}章 ${chapter.title}\n\n${chapter.content}`)
        .join("\n\n");
      const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${project.summary.title}.${format === "docx" ? "txt" : format}`;
      anchor.click();
      URL.revokeObjectURL(url);
      return anchor.download;
    },
    async importMetricsCsv(projectId, csvText) {
      const project = getProject(state, projectId);
      const metrics = parseMetricsCsv(csvText, id);
      project.metrics.unshift(...metrics);
      persist();
      return metrics.length;
    },
    async getReviewSuggestions(projectId) {
      return analyzeMetrics(getProject(state, projectId).metrics);
    },
    async saveReviewExperiment(projectId, experiment: ReviewExperiment) {
      const project = getProject(state, projectId);
      const existing = project.experiments.find((item) => item.id === experiment.id);
      const updatedAt = now();
      const next = prepareReviewExperiment(existing, experiment, {
        id: experiment.id || id(),
        updatedAt,
      });
      const index = project.experiments.findIndex((item) => item.id === next.id);
      if (index >= 0) project.experiments[index] = next;
      else project.experiments.unshift(next);
      project.summary.updatedAt = updatedAt;
      persist();
      return next;
    },
    async createBackup() {
      throw new Error("加密备份仅在桌面版可用");
    },
    async restoreBackup() {
      throw new Error("备份恢复仅在桌面版可用");
    },
    async getAutoBackupSettings() {
      return {
        enabled: false,
        frequency: "daily",
        retentionCount: 7,
        hasPassword: false,
        lastRunAt: null,
        lastStatus: "未运行",
        lastError: null,
        nextRunAt: null,
      };
    },
    async saveAutoBackupSettings() {
      throw new Error("自动加密备份仅在 Windows 桌面版可用");
    },
    async runAutoBackup() {
      throw new Error("自动加密备份仅在 Windows 桌面版可用");
    },
    async runSystemHealthCheck() {
      const chapterCount = state.projects.reduce((sum, project) => sum + project.chapters.length, 0);
      return {
        checkedAt: now(),
        status: "正常",
        projectCount: state.projects.length,
        chapterCount,
        failedAiJobs: 0,
        workspaceBytes: new Blob([JSON.stringify(state)]).size,
        backupBytes: 0,
        checks: [
          {
            id: "browser-storage",
            label: "浏览器预览数据",
            status: "正常",
            detail: "localStorage 数据可读取；SQLite 完整性检查仅在桌面版可用",
            projectId: null,
            repairable: false,
          },
        ],
      } as const;
    },
    async startSystemHealthCheck() {
      const id = crypto.randomUUID();
      const report = await this.runSystemHealthCheck();
      const task = { id, status: "完成" as const, completed: 1, total: 1, label: "检查完成", report, error: null };
      localStorage.setItem(`novel-health-task:${id}`, JSON.stringify(task));
      return task;
    },
    async getSystemHealthCheck(id: string) {
      const stored = localStorage.getItem(`novel-health-task:${id}`);
      if (!stored) throw new Error("健康检查任务不存在");
      return JSON.parse(stored);
    },
    async cancelSystemHealthCheck() {
      return false;
    },
    async rebuildSearchIndexes() {
      throw new Error("搜索索引重建仅在桌面版可用");
    },
    async exportDiagnosticBundle() {
      throw new Error("诊断包仅在桌面版提供");
    },
    async recordGenerationDecision(projectId: string, chapterId: string, action: "adopted" | "reverted") {
      const decisions = state.genDecisions[projectId] ?? [];
      decisions.push({ chapterId, action, at: now() });
      state.genDecisions[projectId] = decisions.slice(-50);
      persist();
    },
    async getGenerationQuality(projectId: string) {
      return computeGenerationQuality(state.genDecisions[projectId] ?? []);
    },
    async getDirectorNotes(projectId: string) {
      return state.directorNotes[projectId] ?? [];
    },
    async saveDirectorNotes(projectId: string, notes: string[]) {
      const cleaned = [...new Set(notes.map((note) => note.trim()).filter(Boolean))].slice(-50);
      state.directorNotes[projectId] = cleaned;
      persist();
      return cleaned;
    },
    async getWorkspacePath() {
      return "浏览器预览使用 localStorage";
    },
  };
}
