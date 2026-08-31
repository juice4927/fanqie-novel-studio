import { describe, expect, it } from "vitest";
import {
  approveContractDraft,
  findApprovedContractChange,
  missingContractApprovalFields,
  prepareContractUpdate,
} from "../src/shared/contract-service";
import type { StoryContract } from "../src/shared/types";

const timestamp = "2026-07-31T00:00:00.000Z";

function createContract(overrides: Partial<StoryContract> = {}): StoryContract {
  return {
    premise: "主角追查旧城事故",
    protagonistDesire: "查明真相",
    readerPromise: "持续调查并兑现线索",
    coreEmotion: "责任",
    ending: "主角公开真相并建立新规则",
    immutableRules: [],
    prohibitedPatterns: [],
    openingMechanism: "一次异常事故迫使主角重新调查",
    growthCarrier: "专业能力、关系网络与认知共同积累",
    primaryPayoff: "解决现实问题并改变人物处境",
    longFormEngine: "个人困境、组织阻力和规则真相逐轮升级",
    protagonistArc: "主角从逃避责任走到主动承担调查代价",
    keyRelationships: ["主角与搭档逐步互信", "主角与对手争夺解释权"],
    worldRules: ["异常必须有可验证的触发条件", "能力使用必有现实代价"],
    majorForces: ["主角调查团队", "掩盖真相的利益组织"],
    timelineAnchors: ["旧事故发生", "异常迫使主角调查", "中期证据曝光"],
    version: 3,
    approved: true,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("contract workflow rules", () => {
  it("treats omitted optional defaults and normalized defaults as unchanged", () => {
    const previous = createContract({
      aestheticProfile: undefined,
      majorStateChanges: undefined,
      secondaryGenres: undefined,
      genreElements: undefined,
      genreSubtype: undefined,
      fanqieCategoryKey: undefined,
    });
    const candidate = createContract({
      aestheticProfile: {
        narrativeDistance: "适中",
        emotionalTemperature: "均衡",
        proseTexture: "",
        dialogueStyle: "",
        emotionalExpression: "",
        signatureTechniques: [],
        avoidPatterns: [],
      },
      majorStateChanges: { include: [], exclude: [] },
      secondaryGenres: [],
      genreElements: [],
      genreSubtype: "",
      fanqieCategoryKey: "",
      version: 99,
      approved: false,
      updatedAt: "2099-01-01T00:00:00.000Z",
    });

    const update = prepareContractUpdate(previous, candidate, "ignored");

    expect(update.changed).toBe(false);
    expect(update.contract).toBe(previous);
  });

  it("increments the version and clears approval only when content changes", () => {
    const previous = createContract();
    const updatedAt = "2026-08-01T12:00:00.000Z";
    const update = prepareContractUpdate(
      previous,
      {
        ...previous,
        premise: "主角发现旧城事故仍在重复",
        aestheticProfile: undefined,
      },
      updatedAt,
    );

    expect(update).toMatchObject({
      changed: true,
      contract: {
        premise: "主角发现旧城事故仍在重复",
        version: 4,
        approved: false,
        updatedAt,
        aestheticProfile: {
          narrativeDistance: "适中",
          emotionalTemperature: "均衡",
        },
      },
    });
    expect(previous).toMatchObject({ version: 3, approved: true });
  });

  it("reports every missing field required for approval", () => {
    const incomplete = createContract({
      premise: " ",
      readerPromise: "",
      ending: "",
      openingMechanism: undefined,
      growthCarrier: undefined,
      primaryPayoff: undefined,
      longFormEngine: undefined,
      protagonistArc: "",
      keyRelationships: ["仅一条关系", "  "],
      worldRules: ["", "\t"],
      majorForces: [" ", ""],
      timelineAnchors: ["仅一个锚点", "", "  "],
    });

    expect(missingContractApprovalFields(incomplete)).toEqual([
      "故事前提",
      "读者承诺",
      "故事终局",
      "开局机制",
      "成长载体",
      "核心回报",
      "长篇发动机",
      "主角弧光",
      "关键关系（至少2条）",
      "世界规则（至少2条）",
      "主要势力（至少2个）",
      "时间锚点（至少3条）",
    ]);
    expect(() => approveContractDraft(incomplete, "ignored")).toThrow("创作契约尚未补全");
  });

  it("approves a complete contract with the supplied timestamp", () => {
    const contract = createContract({ approved: false });
    const updatedAt = "2026-08-02T08:30:00.000Z";

    const approved = approveContractDraft(contract, updatedAt);

    expect(approved).toEqual({ ...contract, approved: true, updatedAt });
    expect(approved).not.toBe(contract);
    expect(contract.approved).toBe(false);
  });

  it("selects the earliest matching approved change without mutating input", () => {
    const changes = [
      {
        id: "newer",
        targetKind: "创作契约" as const,
        targetId: "contract",
        baseVersion: 3,
        title: "较晚审批",
        reason: "测试",
        beforeValue: "旧",
        afterValue: "新",
        impact: "契约",
        rollback: "恢复",
        status: "已批准" as const,
        createdAt: "2026-08-02T00:00:00.000Z",
      },
      {
        id: "earlier",
        targetKind: "创作契约" as const,
        targetId: "contract",
        baseVersion: 3,
        title: "较早审批",
        reason: "测试",
        beforeValue: "旧",
        afterValue: "新",
        impact: "契约",
        rollback: "恢复",
        status: "已批准" as const,
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ];

    expect(findApprovedContractChange(changes, 3)?.id).toBe("earlier");
    expect(changes.map((change) => change.id)).toEqual(["newer", "earlier"]);
  });
});
