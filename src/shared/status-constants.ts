// 领域状态值的唯一数据源：所有状态转移、比较和展示文本必须引用这里的常量，
// 避免裸中文字面量散落各处造成拼写不一致。类型由这些常量派生（见 types.ts）。

export const PROJECT_STATUSES = [
  "研究中", "候选立项", "设定中", "大纲审批", "连载准备", "连载中", "暂停", "完结", "归档",
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const CHAPTER_STATUSES = [
  "章纲", "草稿", "待质检", "待定稿", "已定稿", "待发布", "已发布",
] as const;
export type ChapterStatus = (typeof CHAPTER_STATUSES)[number];

export const CONTRACT_STATUSES = ["草稿", "待审批", "已批准"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const PLAN_STATUSES = ["草稿", "待审批", "已批准"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const SCHEDULE_STATUSES = ["待排期", "待发布", "已发布"] as const;
export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const CHANGE_REQUEST_STATUSES = ["待审批", "已批准", "已拒绝", "已应用"] as const;
export type ChangeRequestStatus = (typeof CHANGE_REQUEST_STATUSES)[number];

export const QUALITY_SEVERITIES = ["硬性", "警告", "建议"] as const;
export type QualitySeverity = (typeof QUALITY_SEVERITIES)[number];

export const QUALITY_STATUSES = ["待处理", "已忽略", "已解决"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

export const EXPECTATION_STATUSES = ["待兑现", "部分兑现", "已兑现", "已放弃"] as const;
export type ExpectationStatus = (typeof EXPECTATION_STATUSES)[number];

export const REVIEW_EXPERIMENT_STATUSES = ["计划中", "观察中", "已结论", "已取消"] as const;
export type ReviewExperimentStatus = (typeof REVIEW_EXPERIMENT_STATUSES)[number];

export const AI_JOB_STATUSES = ["运行中", "成功", "失败", "已取消", "已中断"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const RESEARCH_BOOK_STATUSES = ["待拆解", "拆解中", "已拆解", "失败"] as const;
export type ResearchBookStatus = (typeof RESEARCH_BOOK_STATUSES)[number];

export const PROMPT_RENDER_STATUSES = ["已包含", "已截断", "缺失"] as const;

export const AI_TASK_STATUSES = ["不适用", "未配置", "排队中", "已完成", "失败"] as const;

