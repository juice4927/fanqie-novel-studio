import type { GenrePluginDefinition } from "../src/shared/genre-plugins";
import type {
  Chapter,
  ContextPackage,
  ImportPreview,
  MetricSnapshot,
  QualityIssue,
  RankingSnapshot,
} from "../src/shared/types";

export interface RankingSourceAdapter {
  readonly id: string;
  readonly displayName: string;
  fetchPublicSnapshot(): Promise<RankingSnapshot>;
}

export interface DocumentImporter {
  readonly extensions: string[];
  preview(filePath: string): Promise<ImportPreview>;
}

export interface ModelProvider {
  readonly id: string;
  generateStructured<T>(task: string, system: string, input: unknown): Promise<T>;
  generateLongText(task: string, context: ContextPackage): Promise<string>;
  embed(texts: string[]): Promise<number[][]>;
}

export interface GenrePlugin extends GenrePluginDefinition {}

export interface ContextCompiler {
  compile(projectId: string, chapter: Chapter): Promise<ContextPackage>;
}

export interface QualityRule {
  readonly id: string;
  check(projectId: string, chapter: Chapter): Promise<QualityIssue[]>;
}

export interface MetricImporter {
  preview(csvText: string): Promise<string[]>;
  map(csvText: string, mapping: Record<string, string>): Promise<MetricSnapshot[]>;
}

export interface ExportAdapter {
  readonly format: "txt" | "md" | "docx";
  export(projectId: string, destination: string): Promise<void>;
}
