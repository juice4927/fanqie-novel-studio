import type {
  BaseGenre,
  GenreFatigueRule,
  GenreLedgerTemplate,
  GenreStage,
  GenreStageRule,
  GenreSubtype,
} from "./genre-plugins";
import type { Genre } from "./types";

/**
 * 继承式主题材：只声明与父题材不同的字段。
 * `stages` 缺省继承父题材；其余字段必须显式覆盖，避免出现"空覆盖"。
 */
export interface GenreOverride {
  id: string;
  genre: Genre;
  extends: BaseGenre;
  readerPromise: string;
  targetAudience: string[];
  coreFantasies: string[];
  tabooBoundaries: string[];
  /** 与 tabooBoundaries 一一对应的正向写法。 */
  tabooAlternatives: string[];
  subtypes: GenreSubtype[];
  stages?: Record<GenreStage, GenreStageRule>;
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

export const GENRE_OVERRIDES: GenreOverride[] = [
  {
    id: "sci-fi-apocalypse.v2",
    genre: "科幻末世",
    extends: "都市脑洞",
    readerPromise: "灾变环境下的生存压力、规则揭秘与资源重建",
    targetAudience: ["偏好压迫感与规则推演的读者", "关注资源、秩序与群体选择的生存向读者"],
    coreFantasies: [
      "在灾变规则下活下来并建立据点",
      "用可验证的科技或能力改善生存条件",
      "从求生者成长为群体秩序的制定者",
    ],
    tabooBoundaries: ["灾难只做背景板", "资源凭空出现或消耗不计", "威胁不遵守任何可推演的规则"],
    tabooAlternatives: [
      "让灾变规则持续影响每一天的具体选择。",
      "写清资源从哪里来、消耗在哪里。",
      "让威胁按可预判的规则行动。",
    ],
    subtypes: [
      {
        name: "末世生存",
        coreFantasy: "在资源短缺与威胁压迫下活下来",
        targetAudience: "偏好压迫感与求生策略",
        tabooBoundary: "只写搜物资清单不写人物选择",
      },
      {
        name: "异能规则",
        coreFantasy: "试验灾变赋予的能力边界并付代价",
        targetAudience: "偏好规则探索与能力代价",
        tabooBoundary: "临时增加能力解释所有困局",
      },
      {
        name: "科技重建",
        coreFantasy: "用可落地的技术重建生产与秩序",
        targetAudience: "偏好技术细节与经营反馈",
        tabooBoundary: "跳过材料、人力和组织条件",
      },
    ],
    stages: stages({
      开篇: {
        objective: "一句话讲清灾变规则与生存困境",
        conflict: "留下或离开都要付出代价",
        payoff: "完成第一次安全过夜",
        exitSignal: "读者理解规则、资源与眼前威胁",
      },
      追读: {
        objective: "建立可重复的求生循环",
        conflict: "收人与资源压力互相挤压",
        payoff: "连续解决生存问题并获得稳定据点",
        exitSignal: "主角有了明确的据点目标",
      },
      扩张: {
        objective: "从个人求生进入据点秩序",
        conflict: "旧规则无法处理更大群体",
        payoff: "资源与话语权升级",
        exitSignal: "新问题尺度明显大于开篇",
      },
      中期: {
        objective: "揭示灾变规则来源",
        conflict: "真相与据点安全正面冲突",
        payoff: "规则认知质变",
        exitSignal: "主线方向因真相而改变",
      },
      高潮: {
        objective: "让灾变规则接受最大规模检验",
        conflict: "据点、关系和资源同时承压",
        payoff: "以既有规则完成不可替代的胜利",
        exitSignal: "核心威胁被解决",
      },
      收束: {
        objective: "兑现灾后秩序与人物选择",
        conflict: "保住据点与保住人性不可兼得",
        payoff: "灾后秩序定型",
        exitSignal: "主承诺回收且余波清楚",
      },
    }),
    conflictEngines: [
      "生存资源与探索真相冲突",
      "据点扩张与安全边界冲突",
      "个体能力与群体规则冲突",
      "短期求生与长期重建冲突",
    ],
    rewardLadder: ["安全度过一次危机", "建立稳定据点", "掌握灾变规则", "形成群体秩序", "决定灾后文明走向"],
    expansionAxes: [
      "生存范围：个人→据点→区域→文明",
      "威胁层级：环境→变异体→组织→灾变源头",
      "资源体系：捡拾→生产→分配→制度",
      "认知层级：求生→规则→来源→选择",
    ],
    fatigueRules: [
      {
        name: "搜物资循环",
        signals: ["搜索", "物资", "清点", "囤积"],
        recovery: "让下一次搜索绑定人物目标或新的规则代价",
      },
      {
        name: "威胁换皮",
        signals: ["更强大的怪物", "新的敌人", "未知生物"],
        recovery: "先给出威胁的新规则，再让它改变据点决策",
      },
    ],
    ledgerTemplates: [
      {
        label: "资源账本",
        kind: "资源",
        subjectPlaceholder: "食物、药品或燃料",
        predicate: "库存 / 消耗",
        valueHint: "当前数量与每日消耗",
      },
      {
        label: "据点规则表",
        kind: "承诺",
        subjectPlaceholder: "据点或队伍",
        predicate: "规则 / 代价",
        valueHint: "准入条件与违反后果",
      },
      {
        label: "灾变规则表",
        kind: "秘密",
        subjectPlaceholder: "灾变现象",
        predicate: "已验证规则",
        valueHint: "触发条件与例外",
      },
    ],
    deconstructionDimensions: ["灾变规则", "资源账", "据点与秩序", "威胁逻辑", "群体选择", "长期重建"],
    planningChecks: ["灾变规则前后一致", "资源消耗与来源可追踪", "威胁按规则行动", "每阶段扩大生存范围"],
    qualityChecks: [
      "灾变规则是否被遵守",
      "资源消耗是否记账",
      "威胁是否可预判",
      "据点是否产生新的内部矛盾",
      "生存压力是否持续存在",
    ],
  },
  {
    id: "mystery-deduction.v2",
    genre: "悬疑推理",
    extends: "都市脑洞",
    readerPromise: "可复核的证据链、逐步揭露的真相与规则约束下的惊险",
    targetAudience: ["偏好推理与解谜的读者", "关注信息增量与惊悚氛围的读者"],
    coreFantasies: ["用证据链推翻表面结论", "在规则限制下破解谜题", "让真相改变所有人的立场"],
    tabooBoundaries: ["靠隐瞒信息强行反转", "关键线索凭空出现", "对手动机单薄只为推动剧情"],
    tabooAlternatives: [
      "所有反转都前置可复核的证据。",
      "线索在揭晓前至少出现过一次。",
      "给对手完整的动机、资源与手段。",
    ],
    subtypes: [
      {
        name: "侦探推理",
        coreFantasy: "以证据链与逻辑推演锁定真相",
        targetAudience: "偏好严密推理与公平解谜",
        tabooBoundary: "侦探获得读者无法获得的信息",
      },
      {
        name: "规则怪谈",
        coreFantasy: "在可检验的诡异规则下求生并追索来源",
        targetAudience: "偏好规则解谜与惊悚压迫",
        tabooBoundary: "规则随时变化或前后矛盾",
      },
      {
        name: "异能规则",
        coreFantasy: "用异常能力获取线索并承担代价",
        targetAudience: "偏好能力边界与悬念",
        tabooBoundary: "能力直接给出答案",
      },
    ],
    stages: stages({
      开篇: {
        objective: "给出可复核的异常证据与调查目标",
        conflict: "调查会惊动不想被查的人",
        payoff: "完成第一条线索闭环",
        exitSignal: "读者掌握调查规则与眼前谜题",
      },
      追读: {
        objective: "建立可重复的调查与验证循环",
        conflict: "证据指向与自身立场冲突",
        payoff: "连续破解单元疑点",
        exitSignal: "主角形成明确的追查方向",
      },
      扩张: {
        objective: "从单案进入案件之间的关联",
        conflict: "旧结论被新证据推翻",
        payoff: "认知与调查权限升级",
        exitSignal: "谜题尺度明显扩大",
      },
      中期: {
        objective: "揭示案件背后的规则或组织",
        conflict: "真相与关系、安全正面碰撞",
        payoff: "主线真相推进一层",
        exitSignal: "主线方向因真相而改变",
      },
      高潮: {
        objective: "让证据链接受最终检验",
        conflict: "揭露真相的代价与保护对象冲突",
        payoff: "以既有证据完成不可替代的胜利",
        exitSignal: "核心谜题被解决",
      },
      收束: {
        objective: "兑现真相与人物选择",
        conflict: "公开真相与保全关系不可兼得",
        payoff: "人物立场定型",
        exitSignal: "主承诺回收且余波清楚",
      },
    }),
    conflictEngines: [
      "查真相与自身安全冲突",
      "证据指向与情感立场冲突",
      "规则限制与破案进度冲突",
      "公开真相与保护他人冲突",
    ],
    rewardLadder: ["完成一次线索闭环", "破解单元案件", "揭露案件背后规则", "触及主线组织", "揭开最终真相"],
    expansionAxes: [
      "案件层级：单案→关联案→组织→规则源头",
      "认知层级：线索→动机→结构→真相",
      "代价层级：时间→关系→安全→自我",
      "对手层级：普通人→专业者→组织→规则",
    ],
    fatigueRules: [
      {
        name: "口述真相",
        signals: ["原来", "其实", "真相是", "他坦白"],
        recovery: "把关键信息改写成可被验证的物证或行动后果",
      },
      {
        name: "无前置反转",
        signals: ["没想到", "竟然是", "一直是他"],
        recovery: "回看前文至少补一处可复核的伏笔",
      },
    ],
    ledgerTemplates: [
      {
        label: "证据链表",
        kind: "伏笔",
        subjectPlaceholder: "线索或物证",
        predicate: "指向 / 待验证",
        valueHint: "已验证与存疑部分",
      },
      {
        label: "嫌疑网络表",
        kind: "关系",
        subjectPlaceholder: "涉案人物",
        predicate: "动机 / 手段 / 嫌疑度",
        valueHint: "当前怀疑依据",
      },
      {
        label: "规则表",
        kind: "秘密",
        subjectPlaceholder: "异常规则",
        predicate: "触发条件 / 后果",
        valueHint: "已验证的规则与例外",
      },
    ],
    deconstructionDimensions: ["证据链", "动机结构", "规则约束", "信息节奏", "反转前置", "对手专业性"],
    planningChecks: ["所有反转前置证据", "线索出现顺序可回溯", "对手按利益行动", "每阶段扩大谜题层级"],
    qualityChecks: [
      "线索是否在揭晓前出现过",
      "推理是否跳步",
      "对手是否有完整动机",
      "规则是否前后一致",
      "信息增量是否真实发生",
    ],
  },
  {
    id: "game-sports.v2",
    genre: "游戏竞技",
    extends: "都市脑洞",
    readerPromise: "训练与战术转化为赛场胜负和团队地位",
    targetAudience: ["偏好竞技与团队成长的读者", "关注赛制、战术与职业路径的读者"],
    coreFantasies: ["用训练补强可量化短板", "在团队里找到不可替代的位置", "从替补成长为决定比赛的人"],
    tabooBoundaries: ["只写数值面板不写比赛", "对手只会挑衅不会准备", "团队关系不影响竞技结果"],
    tabooAlternatives: [
      "把关键比赛写完整，让胜负由具体操作决定。",
      "让对手研究主角并升级战术。",
      "让团队关系成为胜负变量。",
    ],
    subtypes: [
      {
        name: "电子竞技",
        coreFantasy: "在赛训体系里用技术赢得位置",
        targetAudience: "偏好电竞战术与团队配合",
        tabooBoundary: "比赛过程被数据面板替代",
      },
      {
        name: "体育竞技",
        coreFantasy: "通过长期训练把短板变成武器",
        targetAudience: "偏好训练细节与赛事成长",
        tabooBoundary: "训练跳过过程直接出结果",
      },
      {
        name: "系统成长",
        coreFantasy: "借训练反馈系统量化进步并承担压力",
        targetAudience: "偏好明确反馈与阶段目标",
        tabooBoundary: "系统替代训练与决策",
      },
    ],
    stages: stages({
      开篇: {
        objective: "明确比赛目标与可量化短板",
        conflict: "上场机会与自身短板冲突",
        payoff: "完成一次训练见效",
        exitSignal: "读者理解赛制与主角位置",
      },
      追读: {
        objective: "建立可重复的训练与比赛循环",
        conflict: "个人能力与团队配合冲突",
        payoff: "连续在比赛中证明价值",
        exitSignal: "主角在队伍中有了明确角色",
      },
      扩张: {
        objective: "从队内竞争进入联赛层级",
        conflict: "对手研究并针对主角",
        payoff: "战术与位置升级",
        exitSignal: "对手尺度明显提升",
      },
      中期: {
        objective: "让短板补强遭遇体系瓶颈",
        conflict: "个人风格与团队战术冲突",
        payoff: "完成一次战术重构",
        exitSignal: "主角的竞技理念发生变化",
      },
      高潮: {
        objective: "在关键赛事中接受最大检验",
        conflict: "伤病、关系与胜负同时承压",
        payoff: "以既有训练成果完成不可替代的胜利",
        exitSignal: "核心赛事目标达成",
      },
      收束: {
        objective: "兑现职业位置与人物选择",
        conflict: "个人荣誉与团队归属不可兼得",
        payoff: "职业身份定型",
        exitSignal: "主承诺回收且余波清楚",
      },
    }),
    conflictEngines: [
      "个人短板与团队战术冲突",
      "上场机会与资历结构冲突",
      "训练投入与关系维护冲突",
      "胜负目标与职业操守冲突",
    ],
    rewardLadder: ["训练见效", "获得上场机会", "成为队伍核心", "赢得关键赛事", "改变职业位置"],
    expansionAxes: [
      "赛场层级：校内→联赛→全国→世界",
      "角色层级：替补→主力→核心→教练",
      "对手层级：同期→老将→战队→体系",
      "关系层级：队友→教练→对手→行业",
    ],
    fatigueRules: [
      {
        name: "面板流水",
        signals: ["属性", "数值", "面板", "熟练度"],
        recovery: "把下一次提升写进一场可复述的比赛或训练",
      },
      {
        name: "对手嘴炮",
        signals: ["嘲讽", "看不起", "放话"],
        recovery: "让对手用具体战术准备说话",
      },
    ],
    ledgerTemplates: [
      {
        label: "技术短板表",
        kind: "能力",
        subjectPlaceholder: "技术动作或位置能力",
        predicate: "当前水平 / 目标",
        valueHint: "已验证的改进",
      },
      {
        label: "赛程与战绩表",
        kind: "事件",
        subjectPlaceholder: "赛事",
        predicate: "结果 / 关键回合",
        valueHint: "比分与决定性动作",
      },
      {
        label: "团队关系表",
        kind: "关系",
        subjectPlaceholder: "队友或教练",
        predicate: "信任 / 分歧",
        valueHint: "当前合作状态",
      },
    ],
    deconstructionDimensions: ["赛制理解", "训练过程", "战术执行", "团队关系", "对手准备", "职业路径"],
    planningChecks: ["关键比赛必须写完整", "对手必须有针对性准备", "训练过程不跳步", "团队关系影响胜负"],
    qualityChecks: [
      "本章是否有可复述的比赛或训练过程",
      "胜负是否由具体操作决定",
      "对手是否有准备",
      "团队关系是否影响结果",
      "短板是否被持续推进",
    ],
  },
  {
    id: "quick-transmigration.v2",
    genre: "快穿衍生",
    extends: "都市脑洞",
    readerPromise: "单元回报与主线谜团并行，在多重身份中确认自我",
    targetAudience: ["偏好高密度单元回报的读者", "喜欢熟悉世界中新关系与新选择的读者"],
    coreFantasies: ["用不同身份完成单元任务", "在单元中修复关系或改写遗憾", "逐步揭开主线与自己的来历"],
    tabooBoundaries: ["单元结构重复且主线停滞", "复述原作剧情或依赖原作角色推动", "主角没有稳定的自我"],
    tabooAlternatives: [
      "每个单元换一种冲突结构，并推进一点主线。",
      "让原创角色和目标驱动剧情，原作只做背景。",
      "让主角的选择暴露并巩固自我立场。",
    ],
    subtypes: [
      {
        name: "单元快穿",
        coreFantasy: "在多个世界中完成单元目标并累积自我",
        targetAudience: "偏好单元回报与长线谜团",
        tabooBoundary: "单元模板重复",
      },
      {
        name: "异能规则",
        coreFantasy: "借任务规则改变单元世界并付代价",
        targetAudience: "偏好规则探索与反差",
        tabooBoundary: "规则临时更改",
      },
      {
        name: "破镜重圆",
        coreFantasy: "在单元中重启旧关系并处理信任",
        targetAudience: "偏好关系修复与情感确认",
        tabooBoundary: "靠误会推动关系",
      },
      {
        name: "宗门升级",
        coreFantasy: "在熟悉体系里建立原创势力",
        targetAudience: "偏好世界观延展与势力成长",
        tabooBoundary: "只搬运原作剧情",
      },
    ],
    stages: stages({
      开篇: {
        objective: "明确单元任务与情感缺口",
        conflict: "完成任务与守住自我冲突",
        payoff: "完成第一次单元闭环",
        exitSignal: "读者理解任务规则与主线悬念",
      },
      追读: {
        objective: "建立单元回报与主线推进的双循环",
        conflict: "身份代入与自我立场冲突",
        payoff: "连续完成单元并积累主线线索",
        exitSignal: "主角有了明确的主线疑问",
      },
      扩张: {
        objective: "从单元任务进入主线组织",
        conflict: "主线规则限制单元选择",
        payoff: "主线身份与权限升级",
        exitSignal: "谜题尺度明显扩大",
      },
      中期: {
        objective: "揭示主线与自己来历的关联",
        conflict: "真相与自我认同正面碰撞",
        payoff: "自我认知质变",
        exitSignal: "主线方向因真相而改变",
      },
      高潮: {
        objective: "让自我立场接受最终检验",
        conflict: "完成使命与保留自我不可兼得",
        payoff: "以既有选择完成不可替代的胜利",
        exitSignal: "核心谜团被解决",
      },
      收束: {
        objective: "兑现自我确认与人物选择",
        conflict: "回归原身份与保留新自我冲突",
        payoff: "人物定型",
        exitSignal: "主承诺回收且余波清楚",
      },
    }),
    conflictEngines: [
      "单元任务与自我立场冲突",
      "身份代入与主线目标冲突",
      "关系修复与任务要求冲突",
      "主线真相与情感归属冲突",
    ],
    rewardLadder: ["完成单元闭环", "修复一段关系", "获得主线线索", "触及主线组织", "确认自我来历"],
    expansionAxes: [
      "世界层级：单世界→关联世界→主线组织→规则源头",
      "身份层级：外来者→参与者→关键角色→规则制定者",
      "关系层级：单元关系→跨单元羁绊→主线同盟→自我",
      "认知层级：任务→规则→来源→自我",
    ],
    fatigueRules: [
      {
        name: "单元模板",
        signals: ["又一次", "同样的任务", "照例"],
        recovery: "换一种冲突结构，并让主线推进一点",
      },
      {
        name: "原作依赖",
        signals: ["原作角色", "名场面", "原著"],
        recovery: "让原创角色和目标承担剧情推进",
      },
    ],
    ledgerTemplates: [
      {
        label: "单元任务表",
        kind: "承诺",
        subjectPlaceholder: "单元世界",
        predicate: "任务 / 代价",
        valueHint: "完成条件与遗留问题",
      },
      {
        label: "主线谜团表",
        kind: "伏笔",
        subjectPlaceholder: "主线线索",
        predicate: "已知 / 待解",
        valueHint: "当前推断",
      },
      {
        label: "自我认知表",
        kind: "秘密",
        subjectPlaceholder: "主角身份",
        predicate: "立场变化",
        valueHint: "每个单元后的自我判断",
      },
    ],
    deconstructionDimensions: ["单元结构", "主线推进", "自我立场", "关系修复", "原作边界", "身份代入"],
    planningChecks: ["每个单元换冲突结构", "主线每单元推进一点", "原创角色驱动剧情", "自我立场持续变化"],
    qualityChecks: [
      "单元是否有独立冲突与回报",
      "主线是否推进",
      "是否复述原作",
      "主角自我是否稳定",
      "单元关系是否留下痕迹",
    ],
  },
  {
    id: "youth-campus.v2",
    genre: "青春校园",
    extends: "现言甜宠",
    readerPromise: "校园阶段的成长目标与关系确认互相推动",
    targetAudience: ["偏好轻松成长与校园关系的读者", "关注青春阶段选择的读者"],
    coreFantasies: ["在具体成长目标中获得认可", "让关系在行动中确认", "从被安排到主动选择"],
    tabooBoundaries: ["只有暧昧没有行动", "成长目标长期停滞", "校园生活与规则失真"],
    tabooAlternatives: [
      "让每次靠近都由具体行动促成。",
      "让成长目标持续产生压力与进展。",
      "写出真实的课业节奏与校园规则。",
    ],
    subtypes: [
      {
        name: "校园成长",
        coreFantasy: "在学业与自我认同中完成成长",
        targetAudience: "偏好成长线与现实压力",
        tabooBoundary: "成长只靠口号",
      },
      {
        name: "青春甜宠",
        coreFantasy: "在成长压力中确认关系",
        targetAudience: "偏好轻松情绪与关系回报",
        tabooBoundary: "只有暧昧没有行动",
      },
      {
        name: "职场恋爱",
        coreFantasy: "把校园关系延续到初入职场",
        targetAudience: "偏好陪伴感与阶段过渡",
        tabooBoundary: "职场部分失真",
      },
    ],
    conflictEngines: [
      "成长目标与关系投入冲突",
      "家庭期待与自我选择冲突",
      "同伴竞争与友谊冲突",
      "升学压力与情感确认冲突",
    ],
    rewardLadder: ["完成一次目标", "关系破冰", "获得同伴认可", "做出主动选择", "成长阶段定型"],
    expansionAxes: [
      "阶段层级：校内→升学→初入社会→职业起步",
      "关系层级：同窗→搭档→亲密→共同选择",
      "目标层级：成绩→特长→方向→人生选择",
      "自我层级：被动→尝试→坚持→定型",
    ],
    fatigueRules: [
      {
        name: "暧昧循环",
        signals: ["脸红", "心跳", "误会", "擦肩"],
        recovery: "用一次具体行动推动关系或目标",
      },
      {
        name: "目标停滞",
        signals: ["努力", "加油", "一定会"],
        recovery: "给出可量化的进展或一次真实失败",
      },
    ],
    ledgerTemplates: [
      {
        label: "成长目标表",
        kind: "承诺",
        subjectPlaceholder: "学业或特长目标",
        predicate: "进度 / 阻碍",
        valueHint: "当前状态",
      },
      {
        label: "同伴关系表",
        kind: "关系",
        subjectPlaceholder: "同学或师长",
        predicate: "信任 / 分歧",
        valueHint: "关系变化节点",
      },
      {
        label: "家庭期待表",
        kind: "事件",
        subjectPlaceholder: "家庭",
        predicate: "期待 / 压力",
        valueHint: "冲突与让步",
      },
    ],
    deconstructionDimensions: ["成长目标", "关系行动", "校园规则", "家庭压力", "同伴竞争", "阶段过渡"],
    planningChecks: ["关系推进必须有行动", "成长目标持续推进", "校园规则真实", "每阶段有明确变化"],
    qualityChecks: [
      "关系是否由行动推进",
      "成长目标是否推进",
      "校园细节是否可信",
      "家庭压力是否具体",
      "配角是否有独立目标",
    ],
  },
  {
    id: "military-espionage.v2",
    genre: "军事谍战",
    extends: "历史/架空",
    readerPromise: "情报成本、身份风险与组织纪律下的智斗",
    targetAudience: ["偏好历史质感与智斗的读者", "关注潜伏与组织博弈的读者"],
    coreFantasies: ["在身份暴露风险下完成情报任务", "用有限资源换取关键情报", "在组织与敌我之间做出选择"],
    tabooBoundaries: ["靠巧合脱险", "对手降智或缺乏情报能力", "现代常识替代时代证据"],
    tabooAlternatives: [
      "让脱险来自事先布置或代价交换。",
      "让对手具备专业的情报与反制手段。",
      "用时代条件下的证据和流程推进。",
    ],
    subtypes: [
      {
        name: "潜伏谍战",
        coreFantasy: "长期潜伏中的身份维护与情报传递",
        targetAudience: "偏好潜伏张力与身份风险",
        tabooBoundary: "身份暴露无后果",
      },
      {
        name: "庙堂权谋",
        coreFantasy: "在组织与派系间争取行动空间",
        targetAudience: "偏好组织博弈与制度约束",
        tabooBoundary: "权责悬空",
      },
      {
        name: "战场军旅",
        coreFantasy: "在战场条件下完成任务与成长",
        targetAudience: "偏好战争质感与团队行动",
        tabooBoundary: "战斗结果脱离条件",
      },
    ],
    conflictEngines: [
      "完成任务与保住身份冲突",
      "情报传递与掩护线冲突",
      "组织纪律与个人判断冲突",
      "短期任务与长期战局冲突",
    ],
    rewardLadder: ["完成一次情报传递", "保住一条掩护线", "获得组织信任", "影响一次战局", "改变格局"],
    expansionAxes: [
      "任务层级：单点情报→情报网→组织博弈→战局",
      "身份层级：外围→内线→关键位置→决策层",
      "对手层级：普通人员→专业反谍→机构→体系",
      "代价层级：时间→掩护线→关系→生命",
    ],
    fatigueRules: [
      {
        name: "巧合脱险",
        signals: ["恰好", "正好", "没想到"],
        recovery: "改成事先布置或代价交换",
      },
      {
        name: "对手降智",
        signals: ["愚蠢", "没发现", "大意"],
        recovery: "让对手用专业反制推动主角升级手段",
      },
    ],
    ledgerTemplates: [
      {
        label: "身份掩护表",
        kind: "秘密",
        subjectPlaceholder: "掩护身份",
        predicate: "知情范围 / 破绽",
        valueHint: "谁掌握何种证据",
      },
      {
        label: "情报网表",
        kind: "关系",
        subjectPlaceholder: "联络人",
        predicate: "信任 / 风险",
        valueHint: "当前联络状态",
      },
      {
        label: "任务进度表",
        kind: "承诺",
        subjectPlaceholder: "任务",
        predicate: "目标 / 代价",
        valueHint: "已完成与待完成",
      },
    ],
    deconstructionDimensions: ["情报成本", "身份风险", "组织纪律", "对手专业性", "时代条件", "战局影响"],
    planningChecks: ["脱险必须有代价", "对手具备专业能力", "时代条件约束行动", "每阶段扩大情报层级"],
    qualityChecks: [
      "任务是否受时代条件限制",
      "对手是否有专业反制",
      "每次成功是否付出掩护代价",
      "组织关系是否具体",
      "战局影响是否可追踪",
    ],
  },
  {
    id: "workplace-reality.v2",
    genre: "现实职场",
    extends: "现言甜宠",
    readerPromise: "职业成长与亲密边界的现实推进",
    targetAudience: ["偏好现实职场与成熟情感的读者", "关注行业逻辑与权责边界的读者"],
    coreFantasies: ["用专业能力解决真实业务问题", "在权责边界中争取成长空间", "让关系与职业选择互相影响"],
    tabooBoundaries: ["职场常识失真或权责悬空", "关系冲突不涉及现实利益", "主角靠贵人而非能力推进"],
    tabooAlternatives: [
      "写出可信的流程、成本和责任划分。",
      "让关系冲突与职业选择直接相关。",
      "让主角的进展来自可验证的专业动作。",
    ],
    subtypes: [
      {
        name: "职场恋爱",
        coreFantasy: "职业目标与亲密边界同步建立",
        targetAudience: "偏好成熟情感与职场现实",
        tabooBoundary: "关系冲突不涉及现实利益",
      },
      {
        name: "行业成长",
        coreFantasy: "在行业规则中积累专业能力与位置",
        targetAudience: "偏好行业细节与成长反馈",
        tabooBoundary: "专业过程被跳过",
      },
      {
        name: "婚恋家庭",
        coreFantasy: "职业选择与家庭责任互相牵制",
        targetAudience: "偏好现实议题与关系张力",
        tabooBoundary: "家庭线脱离现实约束",
      },
    ],
    conflictEngines: [
      "职业晋升与关系边界冲突",
      "专业判断与组织利益冲突",
      "个人成长与家庭责任冲突",
      "短期业绩与长期信誉冲突",
    ],
    rewardLadder: ["完成一次业务破局", "获得专业认可", "职位或权限升级", "关系边界明确", "职业身份定型"],
    expansionAxes: [
      "岗位层级：新人→骨干→负责人→决策层",
      "业务范围：单项目→团队→公司→行业",
      "关系层级：同事→上级→合作方→伴侣",
      "信誉层级：完成任务→被信任→被依赖→被追随",
    ],
    fatigueRules: [
      {
        name: "贵人相助",
        signals: ["上司赏识", "有人帮忙", "恰好认识"],
        recovery: "让进展来自可验证的专业动作",
      },
      {
        name: "职场失真",
        signals: ["随便签字", "一句话搞定", "没人追责"],
        recovery: "补上流程、成本与责任划分",
      },
    ],
    ledgerTemplates: [
      {
        label: "职业目标表",
        kind: "承诺",
        subjectPlaceholder: "岗位或项目",
        predicate: "目标 / 进度",
        valueHint: "当前状态",
      },
      {
        label: "权责关系表",
        kind: "关系",
        subjectPlaceholder: "同事或上级",
        predicate: "权责 / 分歧",
        valueHint: "合作与冲突点",
      },
      {
        label: "业务账表",
        kind: "资源",
        subjectPlaceholder: "项目预算或资源",
        predicate: "投入 / 产出",
        valueHint: "可核算的结果",
      },
    ],
    deconstructionDimensions: ["行业逻辑", "权责边界", "专业动作", "关系张力", "现实代价", "职业路径"],
    planningChecks: ["职场逻辑经得起推敲", "权责边界清晰", "关系冲突涉及现实利益", "成长来自专业动作"],
    qualityChecks: [
      "职场事件是否符合行业逻辑",
      "权责是否清晰",
      "关系冲突是否与职业相关",
      "主角进展是否来自能力",
      "现实代价是否出现",
    ],
  },
];
