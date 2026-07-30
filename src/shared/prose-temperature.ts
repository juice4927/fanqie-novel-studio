export interface ProseTemperatureMetrics {
  characters: number;
  dialogueRatio: number;
  embodiedEmotionCount: number;
  sensoryCount: number;
  interactionCount: number;
  restraintTurnCount: number;
  embodiedEmotionPerThousand: number;
  sensoryPerThousand: number;
  lowTemperature: boolean;
}

const EMBODIED_EMOTION = /心跳|心口|胸口|喉咙|喉结|呼吸|喘息|发抖|颤|僵住|发麻|发白|脸色|血色|眼泪|落泪|哭|笑|咬牙|攥紧|肩头一缩|膝盖一软|惊|怒|害怕|恐惧|欢喜|悲苦|慌乱|茫然|惶恐|绝望|委屈|愤怒|心疼|庆幸|轻松|不安/g;
const SENSORY = /冰冷|滚烫|温热|刺痛|疼|痛|腥|臭|香|潮湿|黏|粗糙|刺眼|灼|甜|苦|咸|风声|雨声|烟气|火光|泥水|血腥/g;
const INTERACTION = /抱住|扶起|拉住|护住|递给|推开|握住|搂紧|拍了拍|顶撞|争辩|道歉|安慰|哀求|怒骂|低声劝|相视|对视/g;
const RESTRAINT_TURNS = /没有|并未|只是|仍然|仍旧|却没有|沉默片刻|看了.{0,6}一眼|声音(?:不高|低沉|平稳)|微微|缓缓/g;

function count(text: string, pattern: RegExp) {
  return text.match(pattern)?.length ?? 0;
}

const LOW_TEMPERATURE_THRESHOLDS: Record<
  AestheticProfile["emotionalTemperature"],
  { embodied: number; sensory: number }
> = {
  冷峻: { embodied: 0.8, sensory: 1.5 },
  克制: { embodied: 1.5, sensory: 2.5 },
  均衡: { embodied: 2.5, sensory: 4 },
  热烈: { embodied: 4, sensory: 6 },
};

export function analyzeProseTemperature(
  text: string,
  target: AestheticProfile["emotionalTemperature"] = "均衡",
): ProseTemperatureMetrics {
  const characters = [...text].filter((char) => !/\s/.test(char)).length;
  const scale = Math.max(characters / 1000, 0.001);
  const dialogueCharacters = [...text.matchAll(/“([^”]*)”/g)]
    .reduce((total, match) => total + [...match[1]].filter((char) => !/\s/.test(char)).length, 0);
  const embodiedEmotionCount = count(text, EMBODIED_EMOTION);
  const sensoryCount = count(text, SENSORY);
  const interactionCount = count(text, INTERACTION);
  const restraintTurnCount = count(text, RESTRAINT_TURNS);
  const embodiedEmotionPerThousand = embodiedEmotionCount / scale;
  const sensoryPerThousand = sensoryCount / scale;
  const threshold = LOW_TEMPERATURE_THRESHOLDS[target];
  return {
    characters,
    dialogueRatio: characters ? dialogueCharacters / characters : 0,
    embodiedEmotionCount,
    sensoryCount,
    interactionCount,
    restraintTurnCount,
    embodiedEmotionPerThousand,
    sensoryPerThousand,
    lowTemperature:
      characters >= 1200 &&
      embodiedEmotionPerThousand < threshold.embodied &&
      sensoryPerThousand < threshold.sensory,
  };
}
import type { AestheticProfile } from "./types";
