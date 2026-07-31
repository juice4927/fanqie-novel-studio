import type { AppApi } from "../../src/shared/types";

export type IpcInvokeChannel = Exclude<
  keyof AppApi,
  "onChapterFactsExtracted"
>;

export type RegisterHandler = (
  channel: IpcInvokeChannel,
  callback: (...args: any[]) => unknown,
) => void;
