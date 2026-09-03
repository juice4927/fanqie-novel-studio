// 编译期契约：验证 defineIpcHandler 能由 Zod schema 推导参数与返回类型，
// 并在参数不匹配时报错（本文件不参与运行时打包，仅被 tsc 检查）。
import { defineIpcHandler, type IpcHandlerArgs } from "./ipc-validation";

// resolveIssue schema: [id, id, enum("待处理" | "已忽略" | "已解决")] -> Promise<void>
const resolveIssueHandler = defineIpcHandler("resolveIssue", (projectId, issueId, status) => {
  const idValue: string = projectId;
  const statusValue: "待处理" | "已忽略" | "已解决" = status;
  void idValue;
  void issueId;
  void statusValue;
  return Promise.resolve();
});
void resolveIssueHandler;

// @ts-expect-error getProject 只接受一个参数，两个参数应报错
defineIpcHandler("getProject", (first: string, second: string) => {
  void first;
  void second;
  return Promise.resolve({} as never);
});

type ChapterSaveArgs = IpcHandlerArgs<"saveChapter">;
const check: ChapterSaveArgs = ["", {} as never, "version"];
void check;
