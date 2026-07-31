import type { Genre, LedgerKind } from "./types";

export const GENRE_STAGES = [
  "开篇",
  "追读",
  "扩张",
  "中期",
  "高潮",
  "收束",
] as const;
export type GenreStage = (typeof GENRE_STAGES)[number];

export interface GenreSubtype {
  name: string;
  coreFantasy: string;
  targetAudience: string;
  tabooBoundary: string;
}

export interface GenreStageRule {
  objective: string;
  conflict: string;
  payoff: string;
  exitSignal: string;
}

export interface GenreFatigueRule {
  name: string;
  signals: string[];
  recovery: string;
}

export interface GenreLedgerTemplate {
  label: string;
  kind: LedgerKind;
  subjectPlaceholder: string;
  predicate: string;
  valueHint: string;
}

export interface GenrePluginDefinition {
  id: string;
  genre: Genre;
  readerPromise: string;
  targetAudience: string[];
  coreFantasies: string[];
  tabooBoundaries: string[];
  subtypes: GenreSubtype[];
  stages: Record<GenreStage, GenreStageRule>;
  conflictEngines: string[];
  rewardLadder: string[];
  expansionAxes: string[];
  fatigueRules: GenreFatigueRule[];
  ledgerTemplates: GenreLedgerTemplate[];
  deconstructionDimensions: string[];
  planningChecks: string[];
  qualityChecks: string[];
}

const stages = (rules: Record<GenreStage, GenreStageRule>) => rules;

export const GENRE_PLUGINS: Record<Genre, GenrePluginDefinition> = {
  都市脑洞: {
    id: "urban-imagination.v2",
    genre: "都市脑洞",
    readerPromise: "高概念进入现实后的快速反馈、身份反差与可验证升级",
    targetAudience: [
      "偏好高概念和快反馈的移动端读者",
      "关注现实获益、身份变化与能力边界的成长型读者",
    ],
    coreFantasies: [
      "用独特规则重写现实困境",
      "低位身份因能力获得可见反馈",
      "能力、资源和社会影响同步升级",
    ],
    tabooBoundaries: [
      "金手指无边界且不付代价",
      "只靠围观震惊替代实际结果",
      "现实职业、财富和组织运行完全失真",
    ],
    subtypes: [
      {
        name: "系统成长",
        coreFantasy: "任务反馈推动能力和身份双升级",
        targetAudience: "偏好明确目标与连续奖励",
        tabooBoundary: "系统替主角决策或奖励凭空通胀",
      },
      {
        name: "神豪经营",
        coreFantasy: "财富转化为事业、关系和社会影响",
        targetAudience: "偏好消费反馈与经营扩张",
        tabooBoundary: "只有报数字和重复消费",
      },
      {
        name: "异能规则",
        coreFantasy: "试验未知能力并解决现实危机",
        targetAudience: "偏好规则探索与悬念",
        tabooBoundary: "临时增加能力解释所有困局",
      },
    ],
    stages: stages({
      开篇: {
        objective: "一句话讲清异常与主角困境",
        conflict: "能力暴露或不用能力都会损失",
        payoff: "完成首次试验并获得可见反馈",
        exitSignal: "读者理解能力、代价与眼前目标",
      },
      追读: {
        objective: "建立可重复的能力使用循环",
        conflict: "现实身份与异常能力相互挤压",
        payoff: "连续兑现现实利益和身份反差",
        exitSignal: "主角形成稳定行动目标",
      },
      扩张: {
        objective: "从个人问题进入行业或组织问题",
        conflict: "旧规则无法处理更高层对手",
        payoff: "资源、权限或影响范围升级",
        exitSignal: "新问题尺度明显大于开篇",
      },
      中期: {
        objective: "揭示能力来源并更换解题方式",
        conflict: "能力收益与长期代价正面碰撞",
        payoff: "规则质变或阵营重组",
        exitSignal: "主线方向因真相而改变",
      },
      高潮: {
        objective: "让核心能力接受最大规模验证",
        conflict: "身份、关系和核心资源同时承压",
        payoff: "以既有规则完成不可替代的胜利",
        exitSignal: "核心对手或规则源头被解决",
      },
      收束: {
        objective: "兑现能力终局和人物选择",
        conflict: "保留能力与保留自我不可兼得",
        payoff: "现实生活获得不可逆的新状态",
        exitSignal: "主承诺回收且余波清楚",
      },
    }),
    conflictEngines: [
      "能力规则与现实制度冲突",
      "隐藏身份与公开获益冲突",
      "短期收益与能力代价冲突",
      "个人成长与组织争夺冲突",
    ],
    rewardLadder: [
      "规则试验成功",
      "解决眼前现实困难",
      "身份反差被关键人物看见",
      "获得可持续资源或权限",
      "改变行业或组织格局",
    ],
    expansionAxes: [
      "能力规则：单一效果→组合运用→规则改写",
      "资源范围：个人→团队→行业→城市",
      "对手层级：旁观者→竞争者→组织→规则源头",
      "关系代价：隐瞒→合作→信任危机→共同承担",
    ],
    fatigueRules: [
      {
        name: "震惊循环",
        signals: ["震惊", "打脸", "围观", "不敢相信"],
        recovery: "让回报改变资源或关系，并切换到规则试验或代价选择",
      },
      {
        name: "任务流水",
        signals: ["任务", "奖励", "签到", "抽奖"],
        recovery: "把下一任务绑定人物目标和不可回避的现实后果",
      },
    ],
    ledgerTemplates: [
      {
        label: "能力规则表",
        kind: "能力",
        subjectPlaceholder: "能力或系统名称",
        predicate: "边界 / 代价 / 冷却",
        valueHint: "当前已验证规则及例外",
      },
      {
        label: "现实资源表",
        kind: "资源",
        subjectPlaceholder: "资金、公司或权限",
        predicate: "规模 / 来源",
        valueHint: "数量、来源及可调用范围",
      },
      {
        label: "身份暴露表",
        kind: "秘密",
        subjectPlaceholder: "隐藏身份",
        predicate: "知情进度",
        valueHint: "谁掌握何种证据",
      },
    ],
    deconstructionDimensions: [
      "脑洞解释成本",
      "首次能力兑现",
      "现实锚点",
      "身份反差",
      "能力代价",
      "资源与组织升级",
    ],
    planningChecks: [
      "能力必须有边界或代价",
      "每阶段至少更换一条扩张轴",
      "现实身份与能力线同步推进",
      "回报必须造成现实状态变化",
    ],
    qualityChecks: [
      "本章目标是否获得反馈",
      "能力使用是否越过已知边界",
      "现实收益是否有来源",
      "围观反应是否替代剧情影响",
      "同类任务回报是否连续重复",
    ],
  },
  "玄幻/仙侠": {
    id: "fantasy-xianxia.v2",
    genre: "玄幻/仙侠",
    readerPromise: "清晰成长、力量质变、世界展开与更高层次冲突",
    targetAudience: [
      "偏好升级获得感和世界探索的读者",
      "关注战力逻辑、资源竞争和大道选择的长线读者",
    ],
    coreFantasies: [
      "从弱小到掌握自身命运",
      "突破带来解题方式质变",
      "探索更广世界并改写秩序",
    ],
    tabooBoundaries: [
      "境界只涨数字不改变能力",
      "战力随剧情任意浮动",
      "资源凭空出现或地图无代价刷新",
    ],
    subtypes: [
      {
        name: "宗门升级",
        coreFantasy: "以修行和宗门竞争改变地位",
        targetAudience: "偏好阶梯式成长",
        tabooBoundary: "宗门人物只为主角送资源",
      },
      {
        name: "凡人修仙",
        coreFantasy: "有限资质下靠选择和积累求长生",
        targetAudience: "偏好谨慎成长与资源经营",
        tabooBoundary: "机缘密集到消除生存压力",
      },
      {
        name: "无敌横推",
        coreFantasy: "实力差制造明确压制与秩序重建",
        targetAudience: "偏好高强度回报",
        tabooBoundary: "没有更高目标，只重复碾压",
      },
    ],
    stages: stages({
      开篇: {
        objective: "建立弱势处境、力量规则和第一目标",
        conflict: "生存或尊严危机逼迫修行选择",
        payoff: "首次突破、获宝或战力验证",
        exitSignal: "成长路径和近期对手明确",
      },
      追读: {
        objective: "跑通修炼、资源、战斗循环",
        conflict: "资源稀缺和同阶竞争",
        payoff: "能力组合与地位同步提升",
        exitSignal: "进入首个稳定势力关系",
      },
      扩张: {
        objective: "展开宗门、秘境或新地图",
        conflict: "旧优势受到新规则限制",
        payoff: "功法质变、越阶验证或势力认可",
        exitSignal: "主角能影响局部格局",
      },
      中期: {
        objective: "重构修行路线与世界认知",
        conflict: "大道选择、阵营责任和个人欲望冲突",
        payoff: "自创体系或掌握高层规则",
        exitSignal: "对最终秩序形成明确立场",
      },
      高潮: {
        objective: "集中兑现力量体系和长期因果",
        conflict: "核心势力与世界规则全面压迫",
        payoff: "最高层战力验证并改变秩序",
        exitSignal: "终局障碍被击穿",
      },
      收束: {
        objective: "回答力量为何而用和长生代价",
        conflict: "超脱与人间关系取舍",
        payoff: "境界、秩序和人物关系共同落定",
        exitSignal: "世界新常态可被描述",
      },
    }),
    conflictEngines: [
      "修炼资源稀缺与竞争",
      "境界压制与越阶解法",
      "宗门责任与个人大道",
      "旧秩序与新修行体系",
    ],
    rewardLadder: [
      "资源获得",
      "小境界突破",
      "战力实战验证",
      "功法或血脉质变",
      "地位与势力提升",
      "掌握世界规则",
    ],
    expansionAxes: [
      "境界层级",
      "功法组合与克制",
      "地图灵气和规则",
      "宗门到世界势力",
      "个人因果到大道秩序",
    ],
    fatigueRules: [
      {
        name: "重复越阶",
        signals: ["越阶", "秒杀", "碾压", "一招"],
        recovery: "改变胜利条件，引入保护、争夺、逃脱或规则破解",
      },
      {
        name: "秘境换皮",
        signals: ["秘境", "传承", "灵药", "遗迹"],
        recovery: "让新地图改变规则、关系或主线，而非只换资源名称",
      },
    ],
    ledgerTemplates: [
      {
        label: "境界战力表",
        kind: "能力",
        subjectPlaceholder: "角色",
        predicate: "境界 / 战力边界",
        valueHint: "境界、可胜范围与克制条件",
      },
      {
        label: "功法资源表",
        kind: "资源",
        subjectPlaceholder: "功法、法宝或灵材",
        predicate: "来源 / 消耗",
        valueHint: "效果、来源、剩余量和代价",
      },
      {
        label: "宗门势力表",
        kind: "关系",
        subjectPlaceholder: "宗门或势力",
        predicate: "立场 / 层级",
        valueHint: "目标、盟敌和当前影响范围",
      },
    ],
    deconstructionDimensions: [
      "力量层级",
      "资源循环",
      "地图规则",
      "功法克制与代价",
      "敌我层次",
      "大道选择",
    ],
    planningChecks: [
      "升级必须改变解题方式",
      "新地图必须带来新规则",
      "资源获取有因果和代价",
      "战力胜负与已确认状态一致",
    ],
    qualityChecks: [
      "境界与战力一致",
      "资源来源可追溯",
      "功法克制有前置依据",
      "新名词密度不过载",
      "突破是否产生质变",
    ],
  },
  "历史/架空": {
    id: "history-alternate.v2",
    genre: "历史/架空",
    readerPromise: "个人选择在时代约束中撬动制度、势力与民生的因果快感",
    targetAudience: [
      "偏好权谋、经营和战争因果的读者",
      "在意制度可信度与群体命运变化的读者",
    ],
    coreFantasies: [
      "用信息和组织能力突破时代限制",
      "建立可持续制度而非单次取巧",
      "个人决策改变势力与民生",
    ],
    tabooBoundaries: [
      "现代知识无成本落地",
      "财政、人口、交通和军需凭空满足",
      "历史人物与势力失去自身目标",
    ],
    subtypes: [
      {
        name: "争霸经营",
        coreFantasy: "从一地经营到重塑天下秩序",
        targetAudience: "偏好势力成长与战略",
        tabooBoundary: "胜利不计算粮秣、人口与治理成本",
      },
      {
        name: "庙堂权谋",
        coreFantasy: "在制度缝隙中改变权力分配",
        targetAudience: "偏好信息博弈与政治因果",
        tabooBoundary: "靠偷听和降智推动所有计谋",
      },
      {
        name: "技术种田",
        coreFantasy: "有限条件下让技术形成生产力",
        targetAudience: "偏好建设和民生改善",
        tabooBoundary: "跨越材料、工艺、推广和利益阻力",
      },
    ],
    stages: stages({
      开篇: {
        objective: "钉住时代、身份和眼前生存问题",
        conflict: "个人目标受到制度与资源限制",
        payoff: "信息优势首次转化为实际成果",
        exitSignal: "主角获得第一个行动支点",
      },
      追读: {
        objective: "建立人才、资源和制度执行循环",
        conflict: "既得利益与执行成本反扑",
        payoff: "局部治理、经营或权力突破",
        exitSignal: "形成稳定班底和阶段目标",
      },
      扩张: {
        objective: "从个人破局扩展到一地或一方势力",
        conflict: "财政、交通、军力与联盟相互制约",
        payoff: "制度复制或战略胜利",
        exitSignal: "主角决策影响区域格局",
      },
      中期: {
        objective: "处理改革连锁反应和联盟裂变",
        conflict: "效率、合法性与民生代价冲突",
        payoff: "建立可持续制度和新利益共同体",
        exitSignal: "天下问题被压缩为核心路线之争",
      },
      高潮: {
        objective: "集中兑现长期经营和战略伏笔",
        conflict: "战争、财政、民心与内部权力同时承压",
        payoff: "以组织能力赢得决定性局势",
        exitSignal: "旧权力结构失去复原能力",
      },
      收束: {
        objective: "展示新制度如何运行及其代价",
        conflict: "个人权力与制度约束取舍",
        payoff: "民生、势力和人物归宿落定",
        exitSignal: "时代新秩序具有可持续性",
      },
    }),
    conflictEngines: [
      "信息优势与制度惯性",
      "财政供给与战略目标",
      "中央权力与地方利益",
      "技术扩散与既得利益",
      "战争胜负与民生成本",
    ],
    rewardLadder: [
      "避开眼前灾祸",
      "获得人才或合法身份",
      "改善一项生产或治理",
      "改变地方势力格局",
      "制度突破并可复制",
      "战略胜利重塑天下",
    ],
    expansionAxes: [
      "治理范围：个人→乡县→州府→天下",
      "组织能力：亲信→班底→官僚与军队",
      "资源系统：钱粮→交通→工业与人口",
      "权力合法性与制度约束",
    ],
    fatigueRules: [
      {
        name: "技术清单",
        signals: ["发明", "配方", "改良", "量产"],
        recovery: "补足材料、工艺、推广、利益受损者和社会后果",
      },
      {
        name: "计谋降智",
        signals: ["中计", "偷听", "密信", "大惊"],
        recovery: "让各势力基于自身信息和利益作出合理反制",
      },
    ],
    ledgerTemplates: [
      {
        label: "势力格局表",
        kind: "关系",
        subjectPlaceholder: "政权、军阀或派系",
        predicate: "目标 / 盟敌",
        valueHint: "控制区、资源、诉求和当前关系",
      },
      {
        label: "财政军需表",
        kind: "资源",
        subjectPlaceholder: "州县、军队或项目",
        predicate: "钱粮 / 人口 / 运力",
        valueHint: "存量、消耗、补给线和缺口",
      },
      {
        label: "制度政策表",
        kind: "事件",
        subjectPlaceholder: "政策或制度",
        predicate: "适用范围 / 阻力",
        valueHint: "条款、执行者、受益者和代价",
      },
    ],
    deconstructionDimensions: [
      "时代约束",
      "势力格局",
      "信息优势",
      "制度阻力",
      "财政交通",
      "战争与民生代价",
    ],
    planningChecks: [
      "改变历史必须产生连锁反应",
      "资源和交通符合时代条件",
      "不同势力拥有独立目标",
      "技术与制度落地经过完整链条",
    ],
    qualityChecks: [
      "称谓与制度一致",
      "时空距离合理",
      "财政军需可追溯",
      "重大胜利存在成本",
      "政策执行存在受益者与阻力",
    ],
  },
  现言甜宠: {
    id: "modern-romance.v2",
    genre: "现言甜宠",
    readerPromise: "明确偏爱、可靠边界、双向成长与递进的情绪回报",
    targetAudience: [
      "偏好稳定情绪价值和关系确认的读者",
      "重视成年人沟通、人格边界与共同成长的读者",
    ],
    coreFantasies: [
      "被具体看见并坚定选择",
      "在亲密关系中保持独立成长",
      "双方共同抵御现实压力",
    ],
    tabooBoundaries: [
      "控制、羞辱或侵犯边界被包装成爱",
      "靠拒绝沟通无限延长误会",
      "一方失去事业与人格只服务恋爱",
    ],
    subtypes: [
      {
        name: "职场恋爱",
        coreFantasy: "能力被看见并在并肩工作中建立信任",
        targetAudience: "偏好事业与关系双线",
        tabooBoundary: "权力压迫被浪漫化",
      },
      {
        name: "先婚后爱",
        coreFantasy: "契约关系逐步变为真实选择",
        targetAudience: "偏好关系阶段递进",
        tabooBoundary: "用婚姻强制替代情感建立",
      },
      {
        name: "破镜重圆",
        coreFantasy: "旧伤被理解后重新作出成熟选择",
        targetAudience: "偏好高情绪张力与修复",
        tabooBoundary: "不处理旧问题直接复合",
      },
    ],
    stages: stages({
      开篇: {
        objective: "建立双方魅力、关系起点和核心阻碍",
        conflict: "靠近的需求与自我保护冲突",
        payoff: "第一次具体看见或偏爱证据",
        exitSignal: "读者理解双方为何会相爱又为何不能立刻相爱",
      },
      追读: {
        objective: "通过共同事件积累信任",
        conflict: "独立目标与关系靠近发生摩擦",
        payoff: "选择、维护和边界尊重",
        exitSignal: "关系进入不可退回的新阶段",
      },
      扩张: {
        objective: "让关系面对家庭、事业或过去",
        conflict: "外部压力放大内部差异",
        payoff: "公开站队、共同承担和亲密升级",
        exitSignal: "双方形成共同目标",
      },
      中期: {
        objective: "处理核心创伤和权力不平衡",
        conflict: "爱意与长期生活能力不等价",
        payoff: "有效沟通、修复行动与个人成长",
        exitSignal: "旧模式被实际改变",
      },
      高潮: {
        objective: "用最大现实压力验证坚定选择",
        conflict: "事业、家庭和关系无法全部保全",
        payoff: "双方主动承担代价并互相成全",
        exitSignal: "核心关系危机被解决",
      },
      收束: {
        objective: "展示共同生活而非停在告白",
        conflict: "理想爱情落入日常协商",
        payoff: "关系确认、个人目标和生活秩序同时落定",
        exitSignal: "幸福状态具体可信",
      },
    }),
    conflictEngines: [
      "亲密需求与自我保护",
      "事业目标与相处时间",
      "家庭期待与个人选择",
      "旧创伤与当下信任",
      "公开身份与私人边界",
    ],
    rewardLadder: [
      "注意到细节",
      "在关键时刻维护",
      "主动沟通与尊重边界",
      "公开坚定选择",
      "共同承担现实代价",
      "建立长期生活方案",
    ],
    expansionAxes: [
      "关系阶段：相识→信任→暧昧→确认→共同体",
      "偏爱成本：语言→时间→机会→公开立场",
      "个人成长：认识问题→采取行动→稳定改变",
      "外部压力：工作→家庭→长期生活",
    ],
    fatigueRules: [
      {
        name: "工业糖精",
        signals: ["摸头", "壁咚", "公主抱", "宠溺"],
        recovery: "用记住需求、尊重边界和承担成本替代表面动作",
      },
      {
        name: "误会拉扯",
        signals: ["误会", "不解释", "转身离开", "听我解释"],
        recovery: "让阻碍来自价值差异或现实利益，并推进有效沟通",
      },
    ],
    ledgerTemplates: [
      {
        label: "关系进度表",
        kind: "关系",
        subjectPlaceholder: "角色 A × 角色 B",
        predicate: "关系阶段 / 信任值",
        valueHint: "当前阶段、关键证据与未解决边界",
      },
      {
        label: "偏爱证据表",
        kind: "事件",
        subjectPlaceholder: "给予偏爱的角色",
        predicate: "选择 / 成本",
        valueHint: "具体行动、付出成本和对方感受",
      },
      {
        label: "个人成长表",
        kind: "人物",
        subjectPlaceholder: "角色",
        predicate: "创伤 / 成长任务",
        valueHint: "旧模式、改变行动和当前进度",
      },
    ],
    deconstructionDimensions: [
      "关系起点",
      "偏爱证据",
      "亲密阶段",
      "人物边界",
      "外部压力",
      "冲突修复",
    ],
    planningChecks: [
      "关系变化必须由事件推动",
      "双方均有独立目标",
      "甜点与矛盾交替",
      "偏爱必须体现选择或成本",
    ],
    qualityChecks: [
      "情绪落点清晰",
      "人物边界受尊重",
      "双方是否主动选择",
      "误会不依赖失智或拒绝沟通",
      "关系进度是否无故倒退",
    ],
  },
  古言宅斗: {
    id: "ancient-household.v2",
    genre: "古言宅斗",
    readerPromise: "礼法约束中的证据信息博弈、权力转移与生存成长",
    targetAudience: [
      "偏好家族权谋和女性成长的读者",
      "关注礼法、名分、财产与关系反转的读者",
    ],
    coreFantasies: [
      "在受限身份中夺回生存与选择权",
      "用信息和规则让强权付出代价",
      "建立可控资源与可靠联盟",
    ],
    tabooBoundaries: [
      "主角凭现代口号无视礼法后果",
      "证据和证人临时出现",
      "所有女性角色只围绕争宠互害",
    ],
    subtypes: [
      {
        name: "家宅经营",
        coreFantasy: "掌握内宅资源并建立自身秩序",
        targetAudience: "偏好细密经营与权力变化",
        tabooBoundary: "管家权没有账目、人事和长辈授权",
      },
      {
        name: "婚恋权谋",
        coreFantasy: "在婚姻与家族联盟中争取主动",
        targetAudience: "偏好感情与利益双博弈",
        tabooBoundary: "男方权势直接解决全部困局",
      },
      {
        name: "复仇逆袭",
        coreFantasy: "建立证据链让旧债公开结算",
        targetAudience: "偏好压抑后的集中回报",
        tabooBoundary: "复仇对象持续降智送证据",
      },
    ],
    stages: stages({
      开篇: {
        objective: "建立身份困境、家族结构和致命利益",
        conflict: "礼法限制下不能直接反击",
        payoff: "用一条证据或规则守住底线",
        exitSignal: "主角拥有第一个秘密或盟友",
      },
      追读: {
        objective: "建立信息、证据、资源循环",
        conflict: "每次行动都可能损害名声或联盟",
        payoff: "夺回小项资源或话语权",
        exitSignal: "形成可持续的生存策略",
      },
      扩张: {
        objective: "从房院之争进入宗族、婚姻或朝堂关系",
        conflict: "多方利益使盟友随时变化",
        payoff: "权力转移、联盟重组或名分提升",
        exitSignal: "主角能主动设置议题",
      },
      中期: {
        objective: "揭开旧案并处理自身阵营裂缝",
        conflict: "真相、亲情与现实安全冲突",
        payoff: "证据链闭合并获得独立资源",
        exitSignal: "核心对手失去制度保护",
      },
      高潮: {
        objective: "集中引爆长期证据与联盟",
        conflict: "名声、性命、婚姻和家族存续同时承压",
        payoff: "在公开规则下完成权力反转",
        exitSignal: "旧家族秩序被打破",
      },
      收束: {
        objective: "落实财产、身份和生活选择",
        conflict: "新权力是否复制旧压迫",
        payoff: "人物获得制度化而非口头的安全",
        exitSignal: "主要人物和资源归属清楚",
      },
    }),
    conflictEngines: [
      "礼法边界与个人生存",
      "证据真相与名声传播",
      "财产分配与家族名分",
      "婚姻联盟与个人选择",
      "长辈权威与后辈利益",
    ],
    rewardLadder: [
      "守住证据或底线",
      "让局部谎言暴露",
      "夺回财物或用人权",
      "改变长辈与盟友立场",
      "完成名分和权力反转",
      "建立独立生活秩序",
    ],
    expansionAxes: [
      "空间：房院→府宅→宗族→外部权力",
      "资源：月例→产业→嫁妆与继承",
      "规则：家规→礼法→司法与政治",
      "联盟：贴身人→房支→姻亲→权力共同体",
    ],
    fatigueRules: [
      {
        name: "下毒栽赃",
        signals: ["下毒", "栽赃", "陷害", "搜查"],
        recovery: "切换到财产、婚姻、用人、名分或规则解释权竞争",
      },
      {
        name: "反派送证",
        signals: ["证据", "证人", "当场", "揭穿"],
        recovery: "记录证据来源、保全成本、传播路径和对方反制",
      },
    ],
    ledgerTemplates: [
      {
        label: "家族权限表",
        kind: "关系",
        subjectPlaceholder: "房支、长辈或主事人",
        predicate: "名分 / 权限",
        valueHint: "可决定的事务、资源和制约者",
      },
      {
        label: "证据链表",
        kind: "秘密",
        subjectPlaceholder: "案件或隐情",
        predicate: "证据 / 知情人",
        valueHint: "来源、保管者、证明力和暴露风险",
      },
      {
        label: "财产名分表",
        kind: "资源",
        subjectPlaceholder: "嫁妆、产业或继承份额",
        predicate: "权属 / 控制权",
        valueHint: "名义归属、实际控制和争议",
      },
    ],
    deconstructionDimensions: [
      "宗族结构",
      "礼法边界",
      "资源分配",
      "证据链",
      "盟友变化",
      "名声传播",
    ],
    planningChecks: [
      "计谋依赖可获得的信息",
      "胜负改变实际资源或名分",
      "反派具有自身利益逻辑",
      "证据有来源、保全和传播路径",
    ],
    qualityChecks: [
      "人物称谓一致",
      "知情范围无越权",
      "证据出现时间可追溯",
      "礼法惩罚与身份匹配",
      "胜利是否改变实际权力",
    ],
  },
  年代重生: {
    id: "period-rebirth.v2",
    genre: "年代重生",
    readerPromise: "在具体时代条件下用有限先知修正命运、改善生计并重建关系",
    targetAudience: [
      "偏好生活改善、家庭成长和时代机会的读者",
      "关注物资细节、劳动过程与命运修正的读者",
    ],
    coreFantasies: [
      "避开前世遗憾并保护重要的人",
      "靠劳动和判断逐步改善生活",
      "抓住时代变化但不脱离政策与物资边界",
    ],
    tabooBoundaries: [
      "先知等于全知且永不衰减",
      "物价票证和政策混用年代",
      "靠囤货或投机一夜暴富而无风险",
    ],
    subtypes: [
      {
        name: "家庭修复",
        coreFantasy: "改正旧选择并建立健康家庭边界",
        targetAudience: "偏好情感补偿和生活流",
        tabooBoundary: "用道德绑架强行和解",
      },
      {
        name: "创业致富",
        coreFantasy: "从小生计抓住市场开放机会",
        targetAudience: "偏好经营积累",
        tabooBoundary: "忽略政策、资金、渠道和竞争",
      },
      {
        name: "知青军婚",
        coreFantasy: "在身份与地域限制下改变人生轨迹",
        targetAudience: "偏好时代关系与成长",
        tabooBoundary: "身份政策只在需要时出现",
      },
    ],
    stages: stages({
      开篇: {
        objective: "钉住具体年月、地点和前世遗憾",
        conflict: "修正命运受到物资与家庭限制",
        payoff: "避开第一次损失或守住关键关系",
        exitSignal: "先知边界和近期生计目标明确",
      },
      追读: {
        objective: "建立劳动、交换和生活改善循环",
        conflict: "家庭旧关系与现实匮乏持续施压",
        payoff: "吃穿住行和家庭话语权改善",
        exitSignal: "主角形成稳定生计路径",
      },
      扩张: {
        objective: "从家庭进入单位、村镇或市场",
        conflict: "政策、渠道和既得利益限制机会",
        payoff: "事业台阶与关系网络同步成长",
        exitSignal: "个人选择开始影响周围人",
      },
      中期: {
        objective: "让先知衰减并转向真实能力",
        conflict: "历史偏移后经验不再可靠",
        payoff: "凭劳动、判断和团队完成升级",
        exitSignal: "主角不再依赖具体前世答案",
      },
      高潮: {
        objective: "用长期积累应对时代转折和旧命运反扑",
        conflict: "家庭、事业和政策风险集中",
        payoff: "守住核心成果并完成命运反转",
        exitSignal: "最大前世遗憾被真正修正",
      },
      收束: {
        objective: "展示生活改善与人物成长的长期结果",
        conflict: "财富增长与家庭价值重新平衡",
        payoff: "生计、关系和个人尊严稳定落地",
        exitSignal: "时代红利转化为可持续生活",
      },
    }),
    conflictEngines: [
      "前世记忆与历史偏移",
      "物资匮乏与家庭分配",
      "个人边界与亲缘责任",
      "政策窗口与市场风险",
      "地域身份与人生选择",
    ],
    rewardLadder: [
      "避开一次前世损失",
      "改善一项生活条件",
      "建立家庭边界",
      "获得稳定工作或生计",
      "抓住时代机会完成事业升级",
      "让家人和社区共同受益",
    ],
    expansionAxes: [
      "生活范围：个人→家庭→单位或村镇→区域市场",
      "能力来源：先知→技能→组织与信誉",
      "资源形态：票证物资→现金设备→渠道品牌",
      "关系网络：亲缘→同事邻里→合作伙伴",
    ],
    fatigueRules: [
      {
        name: "囤货致富",
        signals: ["囤", "倒卖", "票证", "黑市"],
        recovery: "补足资金、保存、渠道、政策风险，并转向可持续生产",
      },
      {
        name: "极品亲戚",
        signals: ["偏心", "抢走", "极品", "断绝关系"],
        recovery: "用利益结构、家庭边界和人物改变替代重复争吵",
      },
    ],
    ledgerTemplates: [
      {
        label: "年代政策表",
        kind: "时间线",
        subjectPlaceholder: "政策、制度或事件",
        predicate: "年月 / 地域 / 适用人群",
        valueHint: "生效时间、地域差异和实际影响",
      },
      {
        label: "物价票证表",
        kind: "资源",
        subjectPlaceholder: "商品或票证",
        predicate: "价格 / 供应条件",
        valueHint: "年月、地区、数量与来源",
      },
      {
        label: "先知衰减表",
        kind: "能力",
        subjectPlaceholder: "前世记忆",
        predicate: "可靠范围 / 偏移",
        valueHint: "已验证信息、失效原因和不确定性",
      },
      {
        label: "家庭边界表",
        kind: "关系",
        subjectPlaceholder: "家庭成员",
        predicate: "责任 / 边界",
        valueHint: "旧模式、当前约定和变化证据",
      },
    ],
    deconstructionDimensions: [
      "年月地域锚点",
      "先知边界",
      "家庭关系",
      "生计过程",
      "政策约束",
      "时代机会",
    ],
    planningChecks: [
      "先知不等于全知并随历史偏移衰减",
      "改善过程符合物资条件",
      "个人变化影响关系网络",
      "政策与物价标注时间和地域",
    ],
    qualityChecks: [
      "物价物资与时代一致",
      "前世信息来源明确",
      "政策适用范围准确",
      "劳动与经营过程不跳步",
      "价值观表达不悬浮",
    ],
  },
};
