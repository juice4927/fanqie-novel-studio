import { GENRE_PLUGINS, type GenreStage } from "./genre-plugins";
import type { ChapterFunction, Genre } from "./types";

/**
 * 题材商业知识的按需检索。
 *
 * 设计原则：默认不注入任何通用商业知识。只有当本章出现明确信号时才取一条，
 * 并带上"为什么取它"，让模型知道这是针对当前问题的提示而不是必须完成的清单。
 */

export interface GuidanceSignal {
  chapterNumber: number;
  chapterFunction: ChapterFunction;
  isKeyChapter: boolean;
  phase: GenreStage;
  /** 是否存在已批准的宏观阶段或分卷；有则本书有自己的节奏目标，不需要题材阶段兜底。 */
  hasApprovedStructure: boolean;
  /** 本章章纲与商业意图，用于判断是否命中某条知识。 */
  chapterText: string;
  /** 最近若干章的章纲，用于识别重复机制。 */
  recentChapterTexts: readonly string[];
}

export interface RetrievedGuidance {
  id: string;
  source: string;
  text: string;
  reason: string;
}

export const MAX_RETRIEVED_GUIDANCE = 2;
const RECENT_WINDOW = 6;
const REPEAT_THRESHOLD = 2;
const MAX_ITEM_CHARACTERS = 200;

function repeatCount(texts: readonly string[], signals: readonly string[]) {
  return texts.filter((text) => signals.some((signal) => text.includes(signal))).length;
}

function clip(text: string) {
  return text.length > MAX_ITEM_CHARACTERS ? `${text.slice(0, MAX_ITEM_CHARACTERS)}…` : text;
}

export function retrieveGuidance(genre: Genre, signal: GuidanceSignal): RetrievedGuidance[] {
  const plugin = GENRE_PLUGINS[genre];
  const items: RetrievedGuidance[] = [];

  // 1. 重复疲劳：近窗口内同一机制反复出现，这是最值得当场提醒的信号。
  for (const rule of plugin.fatigueRules) {
    const hits = repeatCount(signal.recentChapterTexts.slice(-RECENT_WINDOW), rule.signals);
    if (hits >= REPEAT_THRESHOLD) {
      items.push({
        id: `fatigue:${rule.name}`,
        source: "重复疲劳",
        text: clip(rule.recovery),
        reason: `近 ${RECENT_WINDOW} 章有 ${hits} 章使用「${rule.name}」型机制`,
      });
      break;
    }
  }

  // 2. 关键章 / 高潮 / 揭秘：给一条回报形态，避免"关键章却没有实际回报"。
  if (signal.isKeyChapter || signal.chapterFunction === "高潮" || signal.chapterFunction === "揭秘") {
    const reward = plugin.rewardLadder[signal.chapterNumber % plugin.rewardLadder.length];
    items.push({
      id: "reward",
      source: "回报参考",
      text: clip(reward),
      reason: signal.isKeyChapter ? "本章是关键章" : `${signal.chapterFunction}章通常需要一次兑现`,
    });
  }

  // 3. 没有任何已批准结构（宏观阶段或分卷）时，用题材节奏参考兜底。
  if (!signal.hasApprovedStructure) {
    const phaseRule = plugin.stages[signal.phase];
    items.push({
      id: `stage:${signal.phase}`,
      source: "阶段参考",
      text: clip(`${phaseRule.objective}；${phaseRule.payoff}`),
      reason: "尚无已批准的阶段或分卷规划，用题材节奏兜底",
    });
  }

  return items.slice(0, MAX_RETRIEVED_GUIDANCE);
}

export function formatRetrievedGuidance(items: readonly RetrievedGuidance[]): string {
  return items.map((item) => `${item.source}（${item.reason}）：${item.text}`).join("\n");
}
