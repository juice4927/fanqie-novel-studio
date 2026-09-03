import type { QualityIssue } from "./types";

export interface DraftChangeStats {
  previousCharacters: number;
  generatedCharacters: number;
  addedCharacters: number;
  previousParagraphs: number;
  generatedParagraphs: number;
}

const characterCount = (value: string) => value.replace(/\s/g, "").length;
const paragraphCount = (value: string) => value.split(/\n\s*\n/).filter((item) => item.trim()).length;

export function summarizeDraftChange(previousContent: string, generatedContent: string): DraftChangeStats {
  return {
    previousCharacters: characterCount(previousContent),
    generatedCharacters: characterCount(generatedContent),
    addedCharacters: Math.max(0, characterCount(generatedContent) - characterCount(previousContent)),
    previousParagraphs: paragraphCount(previousContent),
    generatedParagraphs: paragraphCount(generatedContent),
  };
}

export interface QualityOverview {
  hard: number;
  warning: number;
  suggestion: number;
  total: number;
  needsHumanJudgment: boolean;
}

export function summarizeQualityOverview(issues: readonly Pick<QualityIssue, "severity">[]): QualityOverview {
  const hard = issues.filter((issue) => issue.severity === "硬性").length;
  const warning = issues.filter((issue) => issue.severity === "警告").length;
  const suggestion = issues.filter((issue) => issue.severity === "建议").length;
  return { hard, warning, suggestion, total: issues.length, needsHumanJudgment: hard > 0 };
}

export function canAcceptGeneratedDraft(issues: readonly Pick<QualityIssue, "severity">[]): boolean {
  return !issues.some((issue) => issue.severity === "硬性");
}

export function hasMeaningfulDraft(content: string): boolean {
  return characterCount(content) >= 200;
}
