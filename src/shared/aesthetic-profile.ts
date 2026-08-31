import type { AestheticProfile } from "./types";

export const NEUTRAL_AESTHETIC_PROFILE: Readonly<AestheticProfile> = {
  narrativeDistance: "适中",
  emotionalTemperature: "均衡",
  proseTexture: "",
  dialogueStyle: "",
  emotionalExpression: "",
  signatureTechniques: [],
  avoidPatterns: [],
};

const NARRATIVE_DISTANCE_GUIDANCE: Record<AestheticProfile["narrativeDistance"], string> = {
  贴身: "优先呈现人物当下的感知、判断和即时反应，让信息受其认知边界约束。",
  适中: "在人物体验与清楚交代事件之间切换，不长期困在内心或退成全知说明。",
  远距: "保持更开阔、概括的观察距离，但关键选择仍要落到具体行动及其后果。",
};

const EMOTIONAL_TEMPERATURE_GUIDANCE: Record<AestheticProfile["emotionalTemperature"], string> = {
  冷峻: "允许节制和留白，以选择、代价与环境压力传达情绪；冷峻不等于人物没有反应。",
  克制: "情绪有清晰的身体或行动落点，避免连续宣泄和替人物总结感受。",
  均衡: "让行动、感受、对话和必要说明共同承担情绪，随场景强弱自然起伏。",
  热烈: "允许鲜明反应、直接关系碰撞和更高感官密度；避免把强烈写成重复喊叫或堆叠形容词。",
};

export function normalizeAestheticProfile(profile?: Partial<AestheticProfile> | null): AestheticProfile {
  return {
    narrativeDistance: profile?.narrativeDistance ?? "适中",
    emotionalTemperature: profile?.emotionalTemperature ?? "均衡",
    proseTexture: profile?.proseTexture?.trim() ?? "",
    dialogueStyle: profile?.dialogueStyle?.trim() ?? "",
    emotionalExpression: profile?.emotionalExpression?.trim() ?? "",
    signatureTechniques: profile?.signatureTechniques?.filter(Boolean) ?? [],
    avoidPatterns: profile?.avoidPatterns?.filter(Boolean) ?? [],
  };
}

export function compileAestheticGuidance(profile?: Partial<AestheticProfile> | null): string {
  if (!profile) {
    return "本项目尚未指定专项审美。保持叙事清楚、人物反应可信，不套用清冷、热烈或其他固定风格模板。";
  }
  const value = normalizeAestheticProfile(profile);
  return [
    `叙事距离：${value.narrativeDistance}。${NARRATIVE_DISTANCE_GUIDANCE[value.narrativeDistance]}`,
    `情绪温度：${value.emotionalTemperature}。${EMOTIONAL_TEMPERATURE_GUIDANCE[value.emotionalTemperature]}`,
    value.proseTexture && `文字质地：${value.proseTexture}`,
    value.dialogueStyle && `对话风格：${value.dialogueStyle}`,
    value.emotionalExpression && `情绪表达：${value.emotionalExpression}`,
    value.signatureTechniques.length && `标志手法：${value.signatureTechniques.join("；")}`,
    value.avoidPatterns.length && `审美避用：${value.avoidPatterns.join("；")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
