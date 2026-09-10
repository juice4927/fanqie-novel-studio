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
        id: "launch-character-dossier-knowledge-boundary",
        title: "完整人物档案不等于角色知晓全局秘密",
        genre: "都市脑洞",
        stage: "开篇",
        chapterKind: "开篇",
        chapter: "许澄第一次见到顾闻，就说出了顾闻藏在旧站地下室的录音带。",
        contextEvidence: ["人物档案中的作者设定：只有顾闻知道录音带位置，许澄尚未获得任何相关线索。"],
        expectedIssues: [
          { id: "dossier-secret", category: "知识边界", severity: "硬性", matchAny: ["录音带", "尚未", "顾闻"] },
        ],
      },
      baselineOutput: {
        issues: [
          {
            severity: "硬性",
            category: "知识边界",
            message: "许澄直接使用了仅顾闻知晓的人物档案秘密，尚未取得线索",
            evidence: "说出了顾闻藏在旧站地下室的录音带",
          },
        ],
      },
    },
    {
      fixture: {
        id: "knowledge-boundary-password",
        title: "角色越过知识边界",
        genre: "都市脑洞",
        stage: "追读",
        chapter: "林舟看了一眼紧闭的门，直接说出了密码是7319。",
        contextEvidence: ["机房密码只有反派周成知晓，林舟尚未获得密码。"],
        expectedIssues: [
          { id: "unknown-password", category: "知识边界", severity: "硬性", matchAny: ["密码", "尚未获得"] },
        ],
      },
      baselineOutput: {
        issues: [
          {
            severity: "硬性",
            category: "知识边界",
            message: "林舟使用了尚未获得的密码",
            evidence: "直接说出了密码是7319",
          },
        ],
      },
    },
    {
      fixture: {
        id: "resource-conservation-spirit-stones",
        title: "资源数量不守恒",
        genre: "玄幻/仙侠",
        stage: "扩张",
        chapter: "沈砚取出八十枚灵石交给掌柜，买下了赤炎炉。",
        contextEvidence: ["沈砚当前仅剩五十枚灵石。"],
        expectedIssues: [
          {
            id: "insufficient-stones",
            category: "资源一致性",
            severity: "硬性",
            matchAny: ["八十枚", "五十枚", "不足"],
          },
        ],
      },
      baselineOutput: {
        issues: [
          {
            severity: "硬性",
            category: "资源一致性",
            message: "现有五十枚灵石不足以支付八十枚",
            evidence: "沈砚当前仅剩五十枚灵石",
          },
        ],
      },
    },
    {
      fixture: {
        id: "timeline-impossible-travel",
        title: "时间地点冲突",
        genre: "历史权谋",
        stage: "中期",
        chapter: "午时刚过，陆青已经站在三百里外的北仓城头。",
        contextEvidence: ["当日辰时，陆青仍在京城参加朝会；京城至北仓快马需两日。"],
        expectedIssues: [
          { id: "impossible-travel", category: "时间线", severity: "硬性", matchAny: ["三百里", "两日", "午时"] },
        ],
      },
      baselineOutput: {
        issues: [
          {
            severity: "硬性",
            category: "时间线",
            message: "陆青无法在半日内抵达三百里外的北仓",
            evidence: "京城至北仓快马需两日",
          },
        ],
      },
    },
    {
      fixture: {
        id: "repeated-payoff-loop",
        title: "连续章节重复同一回报机制",
        genre: "都市脑洞",
        stage: "追读",
        chapter: "众人再次震惊，经理当众认错，所有人都不敢相信林舟的能力。",
        contextEvidence: ["前两章均采用围观质疑、展示能力、众人震惊、对手认错的结构。"],
        expectedIssues: [
          { id: "repeated-loop", category: "重复疲劳", severity: "警告", matchAny: ["震惊", "重复", "前两章"] },
        ],
      },
      baselineOutput: {
        issues: [
          {
            severity: "警告",
            category: "重复疲劳",
            message: "连续三章重复围观震惊与当众认错的回报机制",
            evidence: "众人再次震惊",
          },
        ],
      },
    },
    {
      fixture: {
        id: "clean-causal-progression",
        title: "正常推进不得误报",
        genre: "年代重生",
        stage: "开篇",
        chapterKind: "开篇",
        chapter:
          "许棠先核对供销社的进货单，再用三天做出样品。主任验收后给了她第一张正式订单。她把订单折好，决定明早去找运输队。",
        contextEvidence: ["许棠会裁缝，目标是获得第一张订单；供销社主任有权验收样品。"],
        expectedIssues: [],
        forbiddenIssueTerms: ["能力冲突", "无因获得订单", "知识边界"],
      },
      baselineOutput: { issues: [] },
    },
    {
      fixture: {
        id: "scene-summary-dump",
        title: "概述替代关键场景",
        genre: "都市脑洞",
        stage: "追读",
        chapter: "林舟想起了那天的争执，也想了很多以后要做的事。几天后，事情就这样过去了，他决定继续调查。",
        contextEvidence: ["本章章纲要求林舟当面向搭档说明证据并承担关系破裂的风险。"],
        expectedIssues: [
          {
            id: "skipped-scene-choice",
            category: "场景推进",
            severity: "警告",
            matchAny: ["概述", "选择", "关系", "风险"],
          },
        ],
      },
      baselineOutput: {
        issues: [
          {
            severity: "警告",
            category: "场景推进",
            message: "本章用概述跳过了当面说明证据、承担关系风险这一关键选择，关系位移没有被呈现。",
            evidence: "几天后，事情就这样过去了",
          },
        ],
      },
    },
    {
      fixture: {
        id: "flat-but-valid",
        title: "平淡但无硬伤的章节不得误报",
        genre: "都市脑洞",
        stage: "中期",
        chapterKind: "过渡",
        chapter:
          "林舟把录音笔收进外套内袋，沿走廊走到尽头。值班室的灯亮着，他隔着玻璃看了两分钟，确认里面只有一个人。回程路上他买了两个包子，边吃边把今天的见闻记进本子。明天还要来一次。",
        contextEvidence: ["本章为过渡章，章纲只要求确认值班室人员，不要求兑现冲突。"],
        expectedIssues: [],
        forbiddenIssueTerms: ["平淡", "文风", "节奏缓慢", "缺少冲突", "情绪温度"],
      },
      baselineOutput: { issues: [] },
    },
    {
      fixture: {
        id: "setup-chapter-no-payoff",
        title: "蓄势章未兑现回报不得判为问题",
        genre: "玄幻/仙侠",
        stage: "扩张",
        chapterKind: "蓄势",
        chapter:
          "沈砚在丹房外站了很久，手里那封信始终没有拆。师父说过，赤炎炉的火候要等三天，他数着日子，把每一味药材都重新称了一遍。夜里他梦见炉火熄灭，醒来时天还没亮。",
        contextEvidence: ["本章章纲标注为蓄势章，回报预计在第 47 章兑现。"],
        expectedIssues: [],
        forbiddenIssueTerms: ["回报落空", "未兑现", "缺乏回报", "没有爽点"],
      },
      baselineOutput: { issues: [] },
    },
    {
      fixture: {
        id: "observation-only-length",
        title: "字数与密度偏低只作观察",
        genre: "年代重生",
        stage: "追读",
        chapter: "许棠把最后一针收好，布料叠成方块。她数了数剩下的线，够再做两件。",
        contextEvidence: ["本章目标字数为 2200，实际偏短；无契约或事实冲突。"],
        expectedIssues: [],
        forbiddenIssueTerms: ["字数", "篇幅", "过短", "感官密度", "具身情绪"],
      },
      baselineOutput: { issues: [] },
    },
    {
      fixture: {
        id: "apocalypse-rule-violation",
        title: "灾变规则被违反（新增题材基线）",
        genre: "科幻末世",
        stage: "追读",
        chapter: "周野在辐射区待了整整两天，没有补充抑制剂，也没有出现任何异变。",
        contextEvidence: ["灾变规则：暴露超过六小时必然出现异变，必须靠抑制剂压制。"],
        expectedIssues: [
          { id: "rule-broken", category: "设定一致性", severity: "硬性", matchAny: ["六小时", "异变", "抑制剂"] },
        ],
      },
      baselineOutput: {
        issues: [
          {
            severity: "硬性",
            category: "设定一致性",
            message: "暴露超过六小时却未出现异变，违反已建立的灾变规则",
            evidence: "在辐射区待了整整两天，没有补充抑制剂，也没有出现任何异变",
          },
        ],
      },
    },
    {
      fixture: {
        id: "deduction-leap",
        title: "推理跳步（新增题材基线）",
        genre: "悬疑推理",
        stage: "扩张",
        chapter: "程夏只看了一眼鞋印，就断定凶手是住在三楼的护士。",
        contextEvidence: ["现场鞋印只有尺码信息，尚未比对人选；护士尚未进入嫌疑名单。"],
        expectedIssues: [
          { id: "evidence-leap", category: "知识边界", severity: "硬性", matchAny: ["鞋印", "尚未", "断定"] },
        ],
      },
      baselineOutput: {
        issues: [
          {
            severity: "硬性",
            category: "知识边界",
            message: "仅凭鞋印尺码直接断定凶手，缺少可复核的证据链",
            evidence: "只看了一眼鞋印，就断定凶手是住在三楼的护士",
          },
        ],
      },
    },
  ] satisfies QualityBenchmarkCase[],
} as const;
