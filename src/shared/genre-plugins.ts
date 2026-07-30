import type { Genre } from "./types";

export interface GenrePluginDefinition {
  id: string;
  genre: Genre;
  readerPromise: string;
  deconstructionDimensions: string[];
  planningChecks: string[];
  qualityChecks: string[];
}

export const GENRE_PLUGINS: Record<Genre, GenrePluginDefinition> = {
  "都市脑洞": {
    id: "urban-imagination.v1", genre: "都市脑洞", readerPromise: "高概念进入现实后的快速反馈与持续升级",
    deconstructionDimensions: ["脑洞一句话解释成本", "金手指首次兑现", "现实锚点", "身份反差", "阶段性资源升级"],
    planningChecks: ["能力必须有边界或代价", "每阶段更换问题尺度", "现实身份与能力线同步推进"],
    qualityChecks: ["本章目标是否获得反馈", "能力使用是否越过已知边界", "围观反应是否重复"],
  },
  "玄幻/仙侠": {
    id: "fantasy-xianxia.v1", genre: "玄幻/仙侠", readerPromise: "清晰成长、世界展开与更高层次冲突",
    deconstructionDimensions: ["力量层级", "资源循环", "地图扩张", "功法与代价", "敌我层次"],
    planningChecks: ["升级必须改变解题方式", "新地图兑现旧伏笔", "资源获取有因果和代价"],
    qualityChecks: ["境界与战力一致", "资源来源可追溯", "新名词密度不过载"],
  },
  "历史/架空": {
    id: "history-alternate.v1", genre: "历史/架空", readerPromise: "个人选择撬动制度与局势的因果快感",
    deconstructionDimensions: ["时代约束", "势力格局", "信息优势", "制度阻力", "战争与民生代价"],
    planningChecks: ["改变历史必须产生连锁反应", "资源和交通符合时代条件", "不同势力拥有独立目标"],
    qualityChecks: ["称谓与制度一致", "时空距离合理", "重大胜利存在成本"],
  },
  "现言甜宠": {
    id: "modern-romance.v1", genre: "现言甜宠", readerPromise: "明确偏爱、双向成长与稳定的情绪回报",
    deconstructionDimensions: ["关系起点", "偏爱证据", "亲密升级", "外部压力", "误会处理"],
    planningChecks: ["关系变化必须由事件推动", "双方均有独立目标", "甜点与矛盾交替"],
    qualityChecks: ["情绪落点清晰", "人物边界受尊重", "误会不依赖失智或拒绝沟通"],
  },
  "古言宅斗": {
    id: "ancient-household.v1", genre: "古言宅斗", readerPromise: "礼法约束中的信息博弈、关系反转与生存成长",
    deconstructionDimensions: ["宗族结构", "礼法边界", "资源分配", "证据链", "盟友与名声"],
    planningChecks: ["计谋依赖可获得的信息", "胜负改变实际资源", "反派具有自身利益逻辑"],
    qualityChecks: ["人物称谓一致", "知情范围无越权", "证据出现时间可追溯"],
  },
  "年代重生": {
    id: "period-rebirth.v1", genre: "年代重生", readerPromise: "利用有限先知修正人生并获得时代成长红利",
    deconstructionDimensions: ["年代锚点", "先知边界", "家庭关系", "生计改善", "时代机会"],
    planningChecks: ["先知不等于全知", "改善过程符合物资条件", "个人变化影响关系网络"],
    qualityChecks: ["物价物资与时代一致", "前世信息来源明确", "价值观表达不悬浮"],
  },
};
