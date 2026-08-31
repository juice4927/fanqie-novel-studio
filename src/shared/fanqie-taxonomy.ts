import type { NarrativeGenre } from "./genre-composition";
import type { Genre } from "./types";

export type FanqieChannel = "男频" | "女频";
export type FanqieRankKind = "阅读榜" | "新书榜";

export interface FanqieCategoryProfile {
  key: string;
  channel: FanqieChannel;
  categoryId: string;
  name: string;
  genre: Genre;
  recommendedSubtype: string;
  coreFantasy: string;
  audience: string;
  openingFocus: string;
  taboo: string;
  conflictEngine: string;
  payoffPattern: string;
  expansionAxis: string;
  fatigueSignal: string;
  qualityChecks: string[];
  narrativeGenres: NarrativeGenre[];
  genreElements: string[];
  expansionRoutes: string[];
}

type CategorySeed = [string, string, Genre, string, string, string, string, string];

const seeds: Record<FanqieChannel, CategorySeed[]> = {
  男频: [
    [
      "1141",
      "西方奇幻",
      "玄幻/仙侠",
      "宗门升级",
      "异域规则探索与力量成长",
      "偏好世界探索和成长回报",
      "先展示异域规则，再让主角用一次有限能力破局",
      "避免只换名词的西式皮肤",
    ],
    [
      "1140",
      "东方仙侠",
      "玄幻/仙侠",
      "凡人修仙",
      "境界跃迁与道途选择",
      "偏好修炼积累和境界质变",
      "用资源、代价和境界差制造首个不可回避的选择",
      "避免无代价越阶和境界数字膨胀",
    ],
    [
      "8",
      "科幻末世",
      "都市脑洞",
      "异能规则",
      "灾变生存与科技/能力升级",
      "偏好危机压迫和规则揭秘",
      "把生存资源、未知威胁和能力边界同时落地",
      "避免灾难只做背景板",
    ],
    [
      "261",
      "都市日常",
      "都市脑洞",
      "神豪经营",
      "现实身份改善与可见生活反馈",
      "偏好轻松节奏和现实回报",
      "用具体职业困境触发第一轮异常收益",
      "避免日常流水账和只报消费数字",
    ],
    [
      "124",
      "都市修真",
      "都市脑洞",
      "异能规则",
      "超凡规则嵌入现实秩序",
      "偏好现代社会与修行反差",
      "先验证一条能力边界，再制造身份暴露压力",
      "避免修真体系覆盖现实逻辑",
    ],
    [
      "1014",
      "都市高武",
      "都市脑洞",
      "异能规则",
      "现实秩序中的力量跃迁",
      "偏好力量升级和城市危机",
      "把能力代价与现实制度绑定",
      "避免战力只靠口号升级",
    ],
    [
      "273",
      "历史古代",
      "历史/架空",
      "庙堂权谋",
      "在真实制度约束下改变历史局面",
      "偏好权谋、经营和时代选择",
      "先给出资源短缺和制度障碍",
      "避免现代价值直接碾压时代",
    ],
    [
      "27",
      "战神赘婿",
      "都市脑洞",
      "系统成长",
      "低位身份反转与实力/资源证明",
      "偏好身份揭示和即时打脸反馈",
      "首章同时落下婚姻压力和可验证反转",
      "避免反复隐藏身份打脸",
    ],
    [
      "263",
      "都市种田",
      "都市脑洞",
      "神豪经营",
      "从小资源经营到现实影响力扩张",
      "偏好经营反馈和稳定成长",
      "用一个可量化的经营难题开局",
      "避免只写采购和报表",
    ],
    [
      "258",
      "传统玄幻",
      "玄幻/仙侠",
      "无敌横推",
      "力量体系与世界层级不断打开",
      "偏好热血升级和大世界探索",
      "先建立境界差与一次可见胜负",
      "避免战斗结果脱离规则",
    ],
    [
      "272",
      "历史脑洞",
      "历史/架空",
      "技术种田",
      "知识/技术改变时代资源配置",
      "偏好历史代入和经营回报",
      "用一个技术清单解决迫在眉睫的现实问题",
      "避免万能现代知识包打天下",
    ],
    [
      "539",
      "悬疑脑洞",
      "都市脑洞",
      "异能规则",
      "异常规则与案件真相互相验证",
      "偏好解谜、惊险和信息增量",
      "首章给出可复核异常证据",
      "避免靠隐藏信息强行反转",
    ],
    [
      "262",
      "都市脑洞",
      "都市脑洞",
      "系统成长",
      "高概念规则快速改写现实困境",
      "偏好快反馈、身份反差和连续奖励",
      "三章内完成能力试验和现实收益",
      "避免震惊循环和任务流水",
    ],
    [
      "257",
      "玄幻脑洞",
      "玄幻/仙侠",
      "无敌横推",
      "新规则带来的力量和世界反差",
      "偏好高概念升级和意外解法",
      "先用规则漏洞完成一次有限胜利",
      "避免临时增加规则解释一切",
    ],
    [
      "751",
      "悬疑灵异",
      "都市脑洞",
      "异能规则",
      "诡异生存规则与真相追索",
      "偏好恐惧、推理和禁忌探索",
      "先让规则造成具体损失，再给出可验证线索",
      "避免只靠氛围不推进真相",
    ],
    [
      "504",
      "抗战谍战",
      "历史/架空",
      "庙堂权谋",
      "时代危机中的情报、选择与组织成长",
      "偏好历史真实感和行动压力",
      "用任务目标、身份风险和资源缺口开局",
      "避免用现代常识替代历史证据",
    ],
    [
      "746",
      "游戏体育",
      "都市脑洞",
      "系统成长",
      "规则训练转化为赛场胜负与团队地位",
      "偏好竞技反馈和技能成长",
      "首章明确比赛目标与可量化短板",
      "避免只写数值面板不写比赛",
    ],
    [
      "718",
      "动漫衍生",
      "玄幻/仙侠",
      "宗门升级",
      "熟悉规则中的原创成长和关系重组",
      "偏好世界观熟悉感与新鲜路线",
      "尽快给出原创角色目标和差异化代价",
      "避免复述原作和替代原主角",
    ],
    [
      "1016",
      "男频衍生",
      "玄幻/仙侠",
      "宗门升级",
      "既有世界规则下的原创势力成长",
      "偏好衍生代入和新主线",
      "用新角色的独立冲突建立阅读理由",
      "避免只做原作剧情搬运",
    ],
  ],
  女频: [
    [
      "1139",
      "古风世情",
      "古言宅斗",
      "婚恋权谋",
      "古代身份、情感和家国选择",
      "偏好情感牵引与时代命运",
      "先落下婚姻/家族压力和一个不可退让的目标",
      "避免只有宅斗技巧没有情感代价",
    ],
    [
      "8",
      "科幻末世",
      "都市脑洞",
      "异能规则",
      "灾变环境中的生存、关系和资源掌控",
      "偏好危机求生和女性成长",
      "先展示资源缺口与关系信任风险",
      "避免囤货清单替代人物行动",
    ],
    [
      "746",
      "游戏体育",
      "都市脑洞",
      "系统成长",
      "竞技目标与亲密关系双线成长",
      "偏好轻快节奏和关系回报",
      "让事业目标与关系冲突在首段相撞",
      "避免比赛或恋爱线沦为背景",
    ],
    [
      "1015",
      "女频衍生",
      "现言甜宠",
      "破镜重圆",
      "熟悉世界中的女性主体关系与新选择",
      "偏好代入感和情感新鲜度",
      "先给原创女主的独立欲望和关系缺口",
      "避免复述原作或只靠角色名",
    ],
    [
      "248",
      "玄幻言情",
      "玄幻/仙侠",
      "宗门升级",
      "高概念世界中的情感羁绊和力量成长",
      "偏好强设定与情感回报",
      "用世界规则压力逼迫两人共同选择",
      "避免感情线脱离世界危机",
    ],
    [
      "23",
      "种田",
      "年代重生",
      "创业致富",
      "从家庭/资源困境到稳定生活与关系改善",
      "偏好经营、家庭和持续回报",
      "用一个马上会造成损失的生活难题开局",
      "避免只罗列生产流程",
    ],
    [
      "79",
      "年代",
      "年代重生",
      "创业致富",
      "时代机会、家庭关系和个人重启",
      "偏好时代代入和命运修正",
      "把前世遗憾与当下政策/资源机会绑定",
      "避免现代知识无视时代政策",
    ],
    [
      "267",
      "现言脑洞",
      "现言甜宠",
      "先婚后爱",
      "现实关系中的身份反差和情感确认",
      "偏好强钩子与高密度情绪反馈",
      "首章让契约关系立刻产生现实后果",
      "避免误会循环和纯撒糖",
    ],
    [
      "246",
      "宫斗宅斗",
      "古言宅斗",
      "家宅经营",
      "家族资源、名声与亲密关系的博弈",
      "偏好证据链、反转和情感代价",
      "给出一个可验证的家宅危机与有限资源",
      "避免靠降智反派推进",
    ],
    [
      "539",
      "悬疑脑洞",
      "都市脑洞",
      "异能规则",
      "关系与真相在日常异常中逐层揭开",
      "偏好悬念和情感绑定",
      "先给异常证据再给人物选择",
      "避免反转只靠隐瞒信息",
    ],
    [
      "253",
      "古言脑洞",
      "古言宅斗",
      "复仇逆袭",
      "古代规则漏洞与女性主体性反击",
      "偏好智斗、反转和身份成长",
      "首章明确旧债、证据和反击目标",
      "避免复仇清单化导致人物扁平",
    ],
    [
      "24",
      "快穿",
      "都市脑洞",
      "异能规则",
      "多世界任务中的关系修复与自我确认",
      "偏好高密度单元回报和长线谜团",
      "单元首章同时明确任务和情感缺口",
      "避免任务模板重复且主线停滞",
    ],
    [
      "749",
      "青春甜宠",
      "现言甜宠",
      "职场恋爱",
      "成长阶段的陪伴、选择和关系确认",
      "偏好轻松情绪和人物成长",
      "用具体成长目标制造关系靠近与阻碍",
      "避免只有暧昧没有行动",
    ],
    [
      "745",
      "星光璀璨",
      "现言甜宠",
      "职场恋爱",
      "事业曝光、竞争与亲密关系共同升级",
      "偏好娱乐行业反馈和情感拉扯",
      "首章给出事业机会与公开风险",
      "避免娱乐圈只写炫耀",
    ],
    [
      "747",
      "女频悬疑",
      "都市脑洞",
      "异能规则",
      "关系选择与真相追索互相施压",
      "偏好情感悬疑和女性视角",
      "先让亲密关系产生可信疑点",
      "避免用恋爱遮蔽案件因果",
    ],
    [
      "750",
      "职场婚恋",
      "现言甜宠",
      "职场恋爱",
      "职业成长与亲密边界同步建立",
      "偏好现实职场和成熟情感",
      "用职业目标与关系边界冲突开篇",
      "避免职场常识失真或权责悬空",
    ],
    [
      "748",
      "豪门总裁",
      "现言甜宠",
      "先婚后爱",
      "身份资源与真实情感的反差确认",
      "偏好强身份差和高反馈情绪",
      "先给契约/利益关系的明确条件",
      "避免霸总万能和重复误会",
    ],
    [
      "1017",
      "民国言情",
      "历史/架空",
      "庙堂权谋",
      "时代动荡中的爱情、身份与家国选择",
      "偏好历史氛围和情感牺牲",
      "让时代危机直接改变一段关系的选择",
      "避免时代只做服化道",
    ],
  ],
};

const EXPANSION_ROUTES: Record<NarrativeGenre, string[]> = {
  成长: ["能力边界改变", "身份责任升级", "价值选择定型"],
  悬疑: ["异常证据出现", "嫌疑网络重组", "真相改变人物立场"],
  冒险: ["未知规则试探", "环境与同伴关系变化", "终点目标被重新定义"],
  经营: ["单点方法验证", "团队与渠道成形", "制度和利益分配重构"],
  恋爱: ["边界试探", "信任通过行动验证", "共同选择承担现实后果"],
  权谋: ["局部筹码交换", "联盟与制度博弈", "新秩序接受代价检验"],
  竞技: ["短板训练验证", "对手与团队战术升级", "关键赛事改变职业位置"],
  生存: ["资源缺口求生", "安全区与协作规则建立", "灾变真相迫使长期选择"],
  复仇: ["证据与筹码积累", "责任网络逐层显形", "复仇结果接受人物底线检验"],
  群像: ["个体目标碰撞", "协作关系形成与破裂", "群体共同承担终局选择"],
};

function categoryComposition(name: string): { narrativeGenres: NarrativeGenre[]; genreElements: string[] } {
  if (name.includes("悬疑") || name.includes("灵异"))
    return { narrativeGenres: ["悬疑", "冒险"], genreElements: ["探案"] };
  if (name.includes("科幻") || name.includes("末世"))
    return { narrativeGenres: ["生存", "冒险"], genreElements: ["末世"] };
  if (name.includes("游戏") || name.includes("体育"))
    return { narrativeGenres: ["竞技", "成长"], genreElements: ["职场"] };
  if (name.includes("种田") || name.includes("年代"))
    return { narrativeGenres: ["经营", "成长"], genreElements: [name.includes("种田") ? "种田" : "年代"] };
  if (name.includes("历史") || name.includes("谍战") || name.includes("宫斗") || name.includes("宅斗"))
    return { narrativeGenres: ["权谋", "群像"], genreElements: [name.includes("历史") ? "古代" : "多主角"] };
  if (name.includes("甜宠") || name.includes("言情") || name.includes("婚恋") || name.includes("总裁"))
    return { narrativeGenres: ["恋爱", "成长"], genreElements: ["先婚后爱"] };
  if (name.includes("快穿") || name.includes("衍生"))
    return { narrativeGenres: ["冒险", "群像"], genreElements: [name.includes("快穿") ? "无限流" : "多主角"] };
  if (name.includes("战神") || name.includes("赘婿"))
    return { narrativeGenres: ["复仇", "成长"], genreElements: ["现代都市"] };
  return { narrativeGenres: ["成长", "冒险"], genreElements: [] };
}

export const FANQIE_CATEGORY_PROFILES: FanqieCategoryProfile[] = (
  Object.entries(seeds) as Array<[FanqieChannel, CategorySeed[]]>
).flatMap(([channel, items]) =>
  items.map(([categoryId, name, genre, recommendedSubtype, coreFantasy, audience, openingFocus, taboo]) => {
    const composition = categoryComposition(name);
    const expansionRoutes = composition.narrativeGenres
      .flatMap((item) => EXPANSION_ROUTES[item])
      .filter((item, index, all) => all.indexOf(item) === index);
    return {
      key: `${channel}:${categoryId}`,
      channel,
      categoryId,
      name,
      genre,
      recommendedSubtype,
      coreFantasy,
      audience,
      openingFocus,
      taboo,
      narrativeGenres: composition.narrativeGenres,
      genreElements: composition.genreElements,
      expansionRoutes,
      conflictEngine: `从${composition.narrativeGenres.join("、")}中选择一条主轴，制造目标、资源与代价不能同时满足的选择；每轮冲突必须改变${name}主线状态。`,
      payoffPattern: `先兑现“${openingFocus}”带来的首轮可见反馈，再把个人回报升级为关系、资源或身份变化。`,
      expansionAxis: `${name}不使用统一扩张公式；每阶段从这些路线中选择一条：${expansionRoutes.join("；")}。`,
      fatigueSignal: `连续两轮只重复相同胜负或情绪反馈，或出现“${taboo}”时，视为分类疲劳。`,
      qualityChecks: [
        `本章是否推进主线承诺、人物关系或必要信息中的至少一项，而非强行重复“${coreFantasy}”？`,
        `本章冲突是否产生可追踪的代价或状态变化，而非只重复${recommendedSubtype}表面桥段？`,
        `本章回报是否回应此前期待，并为${audience}建立下一轮明确期待？`,
        `是否触发分类禁忌：${taboo}？`,
      ],
    };
  }),
);

export function getFanqieCategoryProfile(key?: string) {
  return FANQIE_CATEGORY_PROFILES.find((profile) => profile.key === key);
}

export function fanqieRankUrl(channel: FanqieChannel, kind: FanqieRankKind, categoryId: string) {
  return `https://fanqienovel.com/rank/${channel === "男频" ? 1 : 0}_${kind === "阅读榜" ? 2 : 1}_${categoryId}`;
}
