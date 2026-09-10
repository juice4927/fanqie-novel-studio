import { COARSE_BLOCK_CHAPTERS } from "../shared/planning";
import type { PlanNode, ProjectDetail } from "../shared/types";

/** 开书包一次备好的章纲数；与桌面端 LAUNCH_INITIAL_HORIZON 保持一致。 */
const LAUNCH_INITIAL_HORIZON = 100;

/** 浏览器预览使用本地示例数据，桌面版由模型生成同样的层级。 */
export function buildBrowserLaunchPack(project: ProjectDetail, nextId: () => string, updatedAt: string) {
  if (project.launchPack?.status === "待确认" || project.launchPack?.status === "已确认") return;
  if (project.plans.length || project.chapters.length) throw new Error("项目已有规划或章节，不能覆盖现有创作内容");
  const wordsPerChapter = project.summary.wordsPerChapter ?? 2500;
  const targetChapters = Math.ceil(project.summary.targetWords / wordsPerChapter);
  const horizon = Math.min(targetChapters, LAUNCH_INITIAL_HORIZON);
  const plans: PlanNode[] = [];
  const chapters: ProjectDetail["chapters"] = [];
  const addPlan = (value: Omit<PlanNode, "id" | "status">) => {
    const plan: PlanNode = { ...value, id: nextId(), status: "草稿" };
    plans.push(plan);
    return plan;
  };
  const phases = ["踏入事件", "关系与局势转变", "终局抉择"];
  const phaseCount = Math.min(phases.length, targetChapters);
  const volumes: Array<{ plan: PlanNode; fromChapter: number; toChapter: number }> = [];
  let cursor = 1;
  for (let index = 0; index < phaseCount; index += 1) {
    const count = Math.ceil((targetChapters - cursor + 1) / (phaseCount - index));
    const end = cursor + count - 1;
    const stage = addPlan({
      kind: "宏观阶段",
      title: phases[index],
      ordinal: cursor,
      goal: index === phaseCount - 1 ? project.contract.ending : project.contract.protagonistDesire,
      conflict: project.contract.openingMechanism ?? "主角必须在风险中选择调查方向",
      outcome: index === phaseCount - 1 ? project.contract.ending : project.contract.readerPromise,
      targetWords: count * wordsPerChapter,
      parentId: null,
    });
    const volume = addPlan({
      ...stage,
      kind: "分卷",
      title: `第${index + 1}卷 ${phases[index]}`,
      ordinal: index + 1,
      parentId: stage.id,
    });
    volumes.push({ plan: volume, fromChapter: cursor, toChapter: end });
    cursor = end + 1;
  }
  const volumeAt = (chapterNumber: number) =>
    volumes.find((item) => chapterNumber >= item.fromChapter && chapterNumber <= item.toChapter) ?? volumes.at(-1)!;
  // 全书粗纲按全局十章网格对齐，开书时一次给到全书末章。
  const coarseBlocks = new Map<number, PlanNode>();
  for (let start = 1; start <= targetChapters; start += COARSE_BLOCK_CHAPTERS) {
    const end = Math.min(start + COARSE_BLOCK_CHAPTERS - 1, targetChapters);
    const volume = volumeAt(start);
    coarseBlocks.set(
      start,
      addPlan({
        kind: "粗纲",
        title: `第${start}-${end}章 ${volume.plan.title.replace(/^第\d+卷 /, "")}`,
        ordinal: start,
        goal: volume.plan.goal,
        conflict: volume.plan.conflict,
        outcome: volume.plan.outcome,
        targetWords: (end - start + 1) * wordsPerChapter,
        parentId: volume.plan.id,
      }),
    );
  }
  // 开局章纲：只备到前瞻窗口，其余由写作推进后自动续跑。
  for (let number = 1; number <= horizon; number += 1) {
    const rough = coarseBlocks.get(1 + Math.floor((number - 1) / COARSE_BLOCK_CHAPTERS) * COARSE_BLOCK_CHAPTERS)!;
    const volume = volumeAt(number);
    const title = number === targetChapters ? "最后的选择" : `${volume.plan.title.replace(/^第\d+卷 /, "")} ${number}`;
    const goal = number === targetChapters ? project.contract.ending : project.contract.protagonistDesire;
    const detail = addPlan({
      kind: "细纲",
      title: `第${number}章 ${title}`,
      ordinal: number,
      goal,
      conflict: rough.conflict,
      outcome: rough.outcome,
      targetWords: wordsPerChapter,
      parentId: rough.id,
    });
    for (let scene = 1; scene <= 2; scene += 1)
      addPlan({
        kind: "场景卡",
        title: `第${number}章 ${scene === 1 ? "面对新证据" : "作出选择"}`,
        ordinal: number * 10 + scene,
        goal,
        conflict: detail.conflict,
        outcome: detail.outcome,
        targetWords: Math.ceil(wordsPerChapter / 2),
        parentId: detail.id,
      });
    chapters.push({
      id: nextId(),
      number,
      title,
      outline: `目标：${goal}；冲突：${detail.conflict}；结果：${detail.outcome}`,
      content: "",
      wordCount: 0,
      status: "章纲",
      batchMode: "逐章",
      isKeyChapter: number === 1 || number === horizon,
      chapterFunction: "行动",
      targetWords: wordsPerChapter,
      chapterPromise: project.contract.readerPromise,
      expectedPayoff: detail.outcome,
      crisis: detail.conflict,
      endingExpectation: number === targetChapters ? project.contract.ending : "选择将改变下一步调查",
      expectationTargetChapter: number === targetChapters ? null : Math.min(number + 2, targetChapters),
      revision: 0,
      updatedAt,
    });
  }
  const coarseTotal = Math.ceil(targetChapters / COARSE_BLOCK_CHAPTERS);
  project.plans = plans;
  project.chapters = chapters;
  project.launchPack = {
    status: "待确认",
    phase: "完成",
    targetChapters,
    horizonChapters: horizon,
    completedChapters: chapters.length,
    coarseCompleted: coarseTotal,
    coarseTotal,
    updatedAt,
  };
}
