import type { Genre, ImportPreview, ResearchBook } from "./types";

export function assertLocalResearchImportRights(
  rightsConfirmed: boolean,
): void {
  if (!rightsConfirmed) {
    throw new Error("必须确认拥有材料的合法使用权");
  }
}

interface PrepareLocalResearchBookOptions {
  createId: () => string;
  currentTimestamp: () => string;
}

function researchBookTitle(fileName: string): string {
  const baseName = fileName.split(/[\\/]/).at(-1) ?? fileName;
  const extensionStart = baseName.lastIndexOf(".");
  return extensionStart > 0 ? baseName.slice(0, extensionStart) : baseName;
}

export function prepareLocalResearchBook(
  preview: ImportPreview,
  genre: Genre,
  rightsConfirmed: boolean,
  cloudConsent: boolean,
  options: PrepareLocalResearchBookOptions,
): ResearchBook {
  assertLocalResearchImportRights(rightsConfirmed);
  return {
    id: options.createId(),
    title: researchBookTitle(preview.fileName),
    author: "未标注",
    genre,
    sourceType: preview.sourceType,
    chapterCount: preview.chapters.length,
    wordCount: preview.totalWords,
    rightsConfirmed,
    cloudConsent,
    importedAt: options.currentTimestamp(),
    status: "待拆解",
  };
}
