import { describe, expect, it } from "vitest";
import { parseAiProfileCredentialTargets } from "../electron/credential-store";

describe("凭据列举解析", () => {
  it("只保留来源前缀下的 id，忽略其他凭据", () => {
    const output = [
      "cn.local.fanqie.novelstudio/ai/profile-a",
      "cn.local.fanqie.novelstudio/model-api",
      "cn.local.fanqie.novelstudio/ai/profile-b",
      "",
      "  cn.local.fanqie.novelstudio/ai/profile-c  ",
    ].join("\r\n");
    expect(parseAiProfileCredentialTargets(output)).toEqual(["profile-a", "profile-b", "profile-c"]);
  });

  it("空输出返回空数组", () => {
    expect(parseAiProfileCredentialTargets("")).toEqual([]);
  });
});
