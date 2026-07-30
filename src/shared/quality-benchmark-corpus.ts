import { PROMPT_VERSION } from "./prompt-version";
import type { QualityBenchmarkFixture } from "./quality-benchmark";

export interface QualityBenchmarkCase {
  fixture: QualityBenchmarkFixture;
  baselineOutput: { issues: Array<{ severity: string; category: string; message: string; evidence: string }> };
}

export const QUALITY_BENCHMARK = {
  corpusVersion: "2026-07-30.v1",
  promptVersion: PROMPT_VERSION,
  minimumAverageScore: 90,
  cases: [
    {
      fixture: {
        id: "knowledge-boundary-password",
        title: "角色越过知识边界",
        genre: "都市脑洞",
        stage: "追读",
        chapter: "林舟看了一眼紧闭的门，直接说出了密码是7319。",
        contextEvidence: ["机房密码只有反派周成知晓，林舟尚未获得密码。"],
        expectedIssues: [{ id: "unknown-password", category: "知识边界", severity: "硬性", matchAny: ["密码", "尚未获得"] }],
      },
      baselineOutput: { issues: [{ severity: "硬性", category: "知识边界", message: "林舟使用了尚未获得的密码", evidence: "直接说出了密码是7319" }] },
    },
    {
      fixture: {
        id: "resource-conservation-spirit-stones",
        title: "资源数量不守恒",
        genre: "玄幻/仙侠",
        stage: "扩张",
        chapter: "沈砚取出八十枚灵石交给掌柜，买下了赤炎炉。",
        contextEvidence: ["沈砚当前仅剩五十枚灵石。"],
        expectedIssues: [{ id: "insufficient-stones", category: "资源一致性", severity: "硬性", matchAny: ["八十枚", "五十枚", "不足"] }],
      },
      baselineOutput: { issues: [{ severity: "硬性", category: "资源一致性", message: "现有五十枚灵石不足以支付八十枚", evidence: "沈砚当前仅剩五十枚灵石" }] },
    },
    {
      fixture: {
        id: "timeline-impossible-travel",
        title: "时间地点冲突",
        genre: "历史权谋",
        stage: "中期",
        chapter: "午时刚过，陆青已经站在三百里外的北仓城头。",
        contextEvidence: ["当日辰时，陆青仍在京城参加朝会；京城至北仓快马需两日。"],
        expectedIssues: [{ id: "impossible-travel", category: "时间线", severity: "硬性", matchAny: ["三百里", "两日", "午时"] }],
      },
      baselineOutput: { issues: [{ severity: "硬性", category: "时间线", message: "陆青无法在半日内抵达三百里外的北仓", evidence: "京城至北仓快马需两日" }] },
    },
    {
      fixture: {
        id: "repeated-payoff-loop",
        title: "连续章节重复同一回报机制",
        genre: "都市脑洞",
        stage: "追读",
        chapter: "众人再次震惊，经理当众认错，所有人都不敢相信林舟的能力。",
        contextEvidence: ["前两章均采用围观质疑、展示能力、众人震惊、对手认错的结构。"],
        expectedIssues: [{ id: "repeated-loop", category: "重复疲劳", severity: "警告", matchAny: ["震惊", "重复", "前两章"] }],
      },
      baselineOutput: { issues: [{ severity: "警告", category: "重复疲劳", message: "连续三章重复围观震惊与当众认错的回报机制", evidence: "众人再次震惊" }] },
    },
    {
      fixture: {
        id: "clean-causal-progression",
        title: "正常推进不得误报",
        genre: "年代重生",
        stage: "开篇",
        chapter: "许棠先核对供销社的进货单，再用三天做出样品。主任验收后给了她第一张正式订单。她把订单折好，决定明早去找运输队。",
        contextEvidence: ["许棠会裁缝，目标是获得第一张订单；供销社主任有权验收样品。"],
        expectedIssues: [],
        forbiddenIssueTerms: ["能力冲突", "无因获得订单", "知识边界"],
      },
      baselineOutput: { issues: [] },
    },
  ] satisfies QualityBenchmarkCase[],
} as const;
