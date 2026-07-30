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

export function normalizeAestheticProfile(
  profile?: Partial<AestheticProfile> | null,
): AestheticProfile {
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

export function compileAestheticGuidance(
  profile?: Partial<AestheticProfile> | null,
): string {
  if (!profile) {
    return "本项目尚未指定专项审美。保持叙事清楚、人物反应可信，不套用清冷、热烈或其他固定风格模板。";
  }
  const value = normalizeAestheticProfile(profile);
  return [
    `叙事距离：${value.narrativeDistance}`,
    `情绪温度：${value.emotionalTemperature}`,
    value.proseTexture && `文字质地：${value.proseTexture}`,
    value.dialogueStyle && `对话风格：${value.dialogueStyle}`,
    value.emotionalExpression && `情绪表达：${value.emotionalExpression}`,
    value.signatureTechniques.length && `标志手法：${value.signatureTechniques.join("；")}`,
    value.avoidPatterns.length && `审美避用：${value.avoidPatterns.join("；")}`,
  ].filter(Boolean).join("\n");
}
