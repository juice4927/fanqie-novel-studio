/**
 * AI 味词表（纯数据文件，不含任何逻辑）。
 *
 * 来源：
 * - 社区网文去AI味词表：oh-story（https://github.com/zenstory-ai/oh-story-claudecode）与
 *   fanqie-novel-skill（https://github.com/304769384-png/fanqie-novel-skill）维护的禁用词与替换表。
 * - 频率比校准：2026 人稿 / 模型稿语料。R 为「模型稿频率 / 人稿频率」，R 越大越偏 AI；
 *   R < 1 表示人稿反而更多（见 AI_FLAVOR_EXCLUSIONS）。
 *
 * 字段约定：
 * - ratio：> 0 为已校准的 R 值；0 表示社区词表项，没有公开频率比，只按命中提示，不参与频率阈值。
 * - severity：blocking 仅限一级禁用词与一级禁用句式；其余（含标点规则）默认 advisory，只观察、不阻断。
 * - pattern：isRegExp 为 false 时是字面量；为 true 时是正则源码，分析器统一以 gmu 标志编译。
 *   正则必须线性可回溯（有界量词 + 字面锚点），不得写嵌套量词。
 */
export interface AiFlavorFeature {
  id: string;
  label: string;
  kind: "词" | "句式" | "标点" | "结构";
  pattern: string;
  isRegExp: boolean;
  severity: "blocking" | "advisory";
  ratio: number;
  source: string;
  note?: string;
}

export interface AiFlavorExclusion {
  id: string;
  label: string;
  ratio: number;
  reason: string;
}

const COMMUNITY_SOURCE = "社区网文去AI味词表（oh-story / fanqie-novel-skill）";
const CALIBRATION_SOURCE = "2026 人稿/模型稿频率比校准（R=模型稿/人稿，NOVEL_ENGINE_OPTIMIZATION_PLAN.md 3.5）";

export const AI_FLAVOR_FEATURES: readonly AiFlavorFeature[] = [
  {
    id: "blocking-cliche-simile",
    label: "一级禁用比喻词（仿佛/犹如/宛若/如同）",
    kind: "词",
    pattern: "仿佛|犹如|宛若|如同",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比，命中即提示。只针对成串出现的套话喻词，不统计比喻标记总量（比喻标记 R=0.42 已排除）。",
  },
  {
    id: "blocking-vague-amount",
    label: "一级禁用模糊量词（一丝/一抹/些许/隐约）",
    kind: "词",
    pattern: "一丝|一抹|些许|隐约",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；这类词在模型稿里容易成串出现，命中后由作者判断是否空泛。",
  },
  {
    id: "blocking-cliche-action",
    label: "一级禁用套话动作（毫无征兆/深吸一口气/不禁/眉头微皱/瞳孔一缩/心中一动/心头一震）",
    kind: "词",
    pattern: "毫无征兆|深吸一口气|不禁|眉头微皱|瞳孔一缩|心中一动|心头一震",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；命中只提示，删改与否由作者决定。",
  },
  {
    id: "blocking-absolute-judgment",
    label: "一级禁用绝对化判断（不容置疑/显而易见/毫无疑问）",
    kind: "词",
    pattern: "不容置疑|显而易见|毫无疑问",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；直接下判断会让叙述变成旁白，建议改为动作或细节。",
  },
  {
    id: "blocking-not-but",
    label: "一级禁用对举句式（不是A，而是B）",
    kind: "句式",
    pattern: "不是[^。！？!?\\n]{1,12}，?而是",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表高频模板；与「对举结构」（R=3.4，advisory）重叠时会两条都记，面板可合并展示。",
  },
  {
    id: "blocking-carry",
    label: "一级禁用伴随句式（…，带着…）",
    kind: "句式",
    pattern: "，带着[^。！？!?\\n]{1,20}",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；「带着」后面常接抽象情绪，属于典型 AI 补语。",
  },
  {
    id: "blocking-as-if-general",
    label: "一级禁用比喻模板（仿佛能…一般）",
    kind: "句式",
    pattern: "仿佛[^。！？!?\\n]{0,12}一般",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；「仿佛…一般」是闭环比喻模板。",
  },
  {
    id: "blocking-feel-telling",
    label: "一级禁用直陈感受（他/她感到…）",
    kind: "句式",
    pattern: "[他她](?:感到|感觉到|感受到)",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；直接报告感受而非呈现反应，建议改为动作、生理反应或留白。",
  },
  {
    id: "blocking-eye-flash",
    label: "一级禁用模板（眼中闪过一丝…）",
    kind: "句式",
    pattern: "眼中闪过",
    isRegExp: false,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；用字面量统计，同时覆盖「眼中闪过一抹/一道」等变体。",
  },
  {
    id: "blocking-mouth-curl",
    label: "一级禁用模板（嘴角勾起一抹…）",
    kind: "句式",
    pattern: "嘴角勾起",
    isRegExp: false,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；用字面量统计，同时覆盖「嘴角勾起一丝」等变体。",
  },
  {
    id: "blocking-heart-surge",
    label: "一级禁用模板（心中涌起一股…）",
    kind: "句式",
    pattern: "心中涌起",
    isRegExp: false,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；用字面量统计，同时覆盖「心中涌起一阵」等变体。",
  },
  {
    id: "blocking-replaced-by",
    label: "一级禁用转折套话（取而代之的是）",
    kind: "句式",
    pattern: "取而代之的是",
    isRegExp: false,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；字面量统计，避免「取而代之」单独出现时误报。",
  },
  {
    id: "blocking-seems",
    label: "一级禁用描述模板（显得有些/格外…）",
    kind: "句式",
    pattern: "显得(?:有些|有几分|格外|异常|颇为|很是|十分|愈发)",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；只匹配带程度副词的「显得…」，光杆「显得」不报，降低误伤。",
  },
  {
    id: "blocking-aura",
    label: "一级禁用氛围套话（散发着一股…气息）",
    kind: "句式",
    pattern: "散发[^。！？!?\\n]{0,8}(?:气息|气场)",
    isRegExp: true,
    severity: "blocking",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；限制在 8 字窗口内，避免跨句误命中。",
  },
  {
    id: "struct-initial-comment",
    label: "段首零回指评论",
    kind: "结构",
    pattern: "^(?:令人(?:惊讶|意外|不解|唏嘘)|事实上|总的来说|更重要的是|关键在于|问题在于|与此同时|值得注意的是)",
    isRegExp: true,
    severity: "advisory",
    ratio: 4.4,
    source: CALIBRATION_SOURCE,
    note: "R=4.4：模型稿更常在段首直接下评语。只匹配段首评语标记，不把「然而/不过」等普通转折词算进来。",
  },
  {
    id: "struct-personified-vehicle",
    label: "拟人化喻体",
    kind: "结构",
    pattern:
      "(?:像|好像|像是|如同|犹如|宛如)[^。！？!?\\n]{0,12}(?:野兽|猛兽|毒蛇|猎豹|雄狮|猛虎|孤狼|猎犬|恶魔|幽灵|木偶|棋子|困兽|牲口)",
    isRegExp: true,
    severity: "advisory",
    ratio: 7.3,
    source: CALIBRATION_SOURCE,
    note: "R=7.3，本批最高的 AI 偏好。代理指标：比喻词 + 12 字内出现生物/人格化喻体；不统计比喻标记总量（比喻标记 R=0.42 已排除）。",
  },
  {
    id: "struct-contrast-pair",
    label: "对举结构",
    kind: "句式",
    pattern:
      "(?:与其[^。！？!?\\n]{1,12}不如|既(?!然)[^。！？!?\\n]{1,8}又|不但[^。！？!?\\n]{1,10}而且|虽[^。！？!?\\n]{1,10}但|不是[^。！？!?\\n]{1,12}而是)",
    isRegExp: true,
    severity: "advisory",
    ratio: 3.4,
    source: CALIBRATION_SOURCE,
    note: "R=3.4：与一级禁用句式「不是A，而是B」重叠的部分会同时命中，属预期行为。",
  },
  {
    id: "punct-enumeration-cluster",
    label: "顿号并列过密",
    kind: "标点",
    pattern: "、[^。！？!?\\n]{0,12}、[^。！？!?\\n]{0,12}、",
    isRegExp: true,
    severity: "advisory",
    ratio: 1.8,
    source: CALIBRATION_SOURCE,
    note: "R=1.8：只统计同一句内出现三次及以上顿号的并列串，单个顿号不报。",
  },
  {
    id: "struct-adjacent-isomorphic",
    label: "相邻句结构同构",
    kind: "结构",
    pattern:
      "(?:^|[。！？!?\\n])\\s*([^\\s。！？!?\\n])[^。！？!?\\n]{2,25}[。！？!?]\\s*\\1[^。！？!?\\n]{2,25}[。！？!?]",
    isRegExp: true,
    severity: "advisory",
    ratio: 2.0,
    source: CALIBRATION_SOURCE,
    note: "R=2.0：代理指标为相邻两句以同一字起首；刻意不统计句长（句长均匀度 R=0.87 已排除）。",
  },
  {
    id: "punct-dash",
    label: "破折号",
    kind: "标点",
    pattern: "——|—",
    isRegExp: true,
    severity: "advisory",
    ratio: 3.0,
    source: CALIBRATION_SOURCE,
    note: "R=3.0：中文正文破折号按次统计，标准「——」记 1 次；方案规定 blocking 仅限一级禁用词与句式，故本项为 advisory。",
  },
  {
    id: "punct-colon",
    label: "冒号滥用",
    kind: "标点",
    pattern: "：|:",
    isRegExp: true,
    severity: "advisory",
    ratio: 3.8,
    source: CALIBRATION_SOURCE,
    note: "R=3.8：全角与半角冒号都计入，对话提示语中的冒号同样计数，是否滥用由作者判断。",
  },
  {
    id: "struct-ordinal-heading",
    label: "序数词小标题",
    kind: "结构",
    pattern:
      "^(?:第[一二三四五六七八九十百]+[、，,.]|首先[、，,]|其次[、，,]|再次[、，,]|最后[、，,]|其一[、，,]|其二[、，,]|一方面[、，,]|另一方面[、，,])",
    isRegExp: true,
    severity: "advisory",
    ratio: 3.1,
    source: CALIBRATION_SOURCE,
    note: "R=3.1：只匹配段首序数词 + 分隔符，段中列举不报。",
  },
  {
    id: "struct-formulaic-opener",
    label: "起首语",
    kind: "结构",
    pattern: "^(?:值得一提的是|不得不说|不知过了多久|就在这时|话说回来|换句话说|总而言之|说到底|另一边|此时此刻)",
    isRegExp: true,
    severity: "advisory",
    ratio: 3.2,
    source: CALIBRATION_SOURCE,
    note: "R=3.2：只匹配段首套话起句，普通时间或地点开头不报。",
  },
  {
    id: "syntax-translationese",
    label: "译文句式",
    kind: "句式",
    pattern:
      "(?:作为一个|对于[^。！？!?\\n]{1,10}来说|在[^。！？!?\\n]{1,10}的情况下|当[^。！？!?\\n]{1,10}的时候|不仅[^。！？!?\\n]{1,10}而且|从某种意义上|在某种意义上|被认为[^。！？!?\\n]{0,8}|一种[^。！？!?\\n]{1,8}的存在|尽管如此)",
    isRegExp: true,
    severity: "advisory",
    ratio: 2.6,
    source: CALIBRATION_SOURCE,
    note: "R=2.6–5.3，这里取保守下界 2.6；翻译腔清单来自社区词表，R 取低端以减少误报。",
  },
  {
    id: "punct-ellipsis-pause",
    label: "省略号当停顿",
    kind: "标点",
    pattern: "……",
    isRegExp: false,
    severity: "advisory",
    ratio: 0,
    source: COMMUNITY_SOURCE,
    note: "社区词表项，无公开频率比；无法区分省略与停顿，按标准六点省略号的出现次数观察。",
  },
];

/**
 * 明确排除项：这些特征在 2026 语料校准里没有区分度，甚至方向相反，硬禁只会让文字更不像人。
 * 本模块不为其生成任何检测规则，也不应把它们作为 AI 味依据。
 */
export const AI_FLAVOR_EXCLUSIONS: readonly AiFlavorExclusion[] = [
  {
    id: "exclude-question-in-prose",
    label: "正文设问",
    ratio: 0.05,
    reason: "R=0.05：人稿使用频率约为模型稿的 17–20 倍，把设问当 AI 味会误伤更自然的写法。",
  },
  {
    id: "exclude-sentence-length-uniformity",
    label: "句长均匀度",
    ratio: 0.87,
    reason: "R=0.87 接近 1，人稿与模型稿无有效区分；且长度属于排版观察，不是 AI 味特征。",
  },
  {
    id: "exclude-metaphor-marker",
    label: "比喻标记",
    ratio: 0.42,
    reason: "R=0.42 方向相反：人稿比喻标记更多。只对社区词表里的套话喻词单独提示，不做比喻密度统计。",
  },
  {
    id: "exclude-rhetorical-self-answer",
    label: "设问自答",
    ratio: 1.03,
    reason: "R=1.03 几乎无差异，不能作为 AI 味依据。",
  },
  {
    id: "exclude-verbal-nominalization",
    label: "动词名词化",
    ratio: 0.52,
    reason: "R=0.52 方向相反：人稿名词化更多，列为排除项以避免误报。",
  },
];
