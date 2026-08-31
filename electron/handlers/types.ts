import type { AppApi } from "../../src/shared/types";

export type IpcInvokeChannel = Exclude<keyof AppApi, "onChapterFactsExtracted">;

// biome-ignore lint/suspicious/noExplicitAny: IPC 边界回调参数由 validateIpcArgs 在运行时校验
export type RegisterHandler = (channel: IpcInvokeChannel, callback: (...args: any[]) => unknown) => void;
