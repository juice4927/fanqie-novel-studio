import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conceptDiversityIssues } from "../electron/ai-definitions";
import { validateIpcArgs } from "../electron/ipc-validation";
import { createBrowserApi } from "../src/lib/browser-api";
import {
  candidateCountForPath,
  INCUBATION_STEPS,
  type IncubationPositioning,
  positioningToConceptInput,
  stepsForPath,
} from "../src/shared/incubation";

const positioning: IncubationPositioning = {
  genre: "都市脑洞",
  fanqieCategoryKey: "男频:262",
  subGenreIds: [],
  openingArchetype: "系统降临",
  lengthShape: "长线连续",
  narrativePerson: "第三人称限知",
  protagonistRoles: [],
  toneTags: [],
  secondaryGenres: ["成长"],
  genreElements: ["现代都市"],
  customGenreDirection: "",
  targetWords: 1_000_000,
  wordsPerChapter: 2500,
  updateCadence: "每日 2 章",
  safeStockLine: 10,
  readerPersona: "",
  readerPromise: "",
  commercialBoundary: "",
};

type DiversityCandidate = Parameters<typeof conceptDiversityIssues>[0][number];

const candidate = (overrides: {
  subtype: string;
  mechanism: string;
  carrier: string;
  payoff: string;
  axis: "资源" | "技艺";
}): DiversityCandidate => ({
  genreSubtype: overrides.subtype,
  secondaryGenres: ["成长"],
  openingMechanism: overrides.mechanism,
  growthCarrier: overrides.carrier,
  primaryPayoff: overrides.payoff,
  premise: `${overrides.mechanism}之后，主角必须用${overrides.carrier}换来${overrides.payoff}。`,
  longFormEngine: `${overrides.carrier}在三个阶段持续扩张，每次都要付出代价。`,
  openingDesign: {
    chapter1Hook: `${overrides.mechanism}当天，主角被迫做出一个不可逆的选择。`,
    firstThreeChaptersPromise: "前三章给出规则、代价与第一条可验证回报。",
    firstPayoffChapter: 2,
    retentionAnchors: ["规则边界", "代价来源"],
  },
  escalationLadder: [
    { stage: "第一级", conflict: "起步冲突", expansionAxis: overrides.axis, payoff: "小回报", cost: "小代价" },
    { stage: "第二级", conflict: "升级冲突", expansionAxis: overrides.axis, payoff: "中回报", cost: "中代价" },
    { stage: "第三级", conflict: "高位冲突", expansionAxis: overrides.axis, payoff: "大回报", cost: "大代价" },
  ],
});

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(() => null),
    length: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("开书路径", () => {
  it("每条路径只显示实际会走的步骤", () => {
    expect(stepsForPath("探索")).toEqual(INCUBATION_STEPS);
    expect(stepsForPath("定向")).toEqual(["定位", "证据", "候选", "体检", "骨架"]);
    expect(stepsForPath("直达")).toEqual(["定位", "骨架", "体检"]);
    expect(stepsForPath(undefined)).toEqual(INCUBATION_STEPS);
  });

  it("路径决定候选数量", () => {
    expect(candidateCountForPath("探索")).toBe(3);
    expect(candidateCountForPath("定向")).toBe(2);
    expect(candidateCountForPath("直达")).toBe(1);
  });

  it("定位输入带上候选数量，缺省三套", () => {
    expect(positioningToConceptInput(positioning, "").candidateCount).toBe(3);
    expect(positioningToConceptInput(positioning, "重回八零年代", {}, 1).candidateCount).toBe(1);
  });

  it("两案时差异门禁放宽到两个维度，三案仍要求四个", () => {
    const base = { subtype: "系统成长", mechanism: "系统降临", carrier: "任务积分", payoff: "身份跃迁" } as const;
    const identical = conceptDiversityIssues([
      candidate({ ...base, axis: "资源" }),
      candidate({ ...base, axis: "资源" }),
    ]);
    expect(identical.some((issue) => issue.includes("核心维度必须完全不同"))).toBe(true);

    const twoDimensions = conceptDiversityIssues([
      candidate({ ...base, axis: "资源" }),
      candidate({
        subtype: "悬案推理",
        mechanism: "悬案介入",
        carrier: "证据网络",
        payoff: "真相公开",
        axis: "技艺",
      }),
    ]);
    expect(twoDimensions.some((issue) => issue.includes("核心维度必须完全不同"))).toBe(false);
  });

  it("IPC 校验接受 1–3 套候选，拒绝越界", () => {
    const input = {
      genre: "都市脑洞",
      targetWords: 1_000_000,
      updateCadence: "每日 2 章",
      seed: "",
      secondaryGenres: ["成长"],
      genreElements: ["现代都市"],
      customGenreDirection: "",
    };
    expect(validateIpcArgs("generateBookConcepts", [{ ...input, candidateCount: 2 }])).toHaveLength(1);
    expect(() => validateIpcArgs("generateBookConcepts", [{ ...input, candidateCount: 4 }])).toThrow();
    expect(() => validateIpcArgs("generateBookConcepts", [{ ...input, candidateCount: 0 }])).toThrow();
  });

  it("浏览器回退按候选数量返回", async () => {
    const api = createBrowserApi();
    const input = {
      genre: "都市脑洞" as const,
      targetWords: 1_000_000,
      updateCadence: "每日 2 章",
      seed: "重回八零年代",
    };
    expect(await api.generateBookConcepts({ ...input, candidateCount: 1 })).toHaveLength(1);
    expect(await api.generateBookConcepts({ ...input, candidateCount: 2 })).toHaveLength(2);
    expect(await api.generateBookConcepts(input)).toHaveLength(3);
  });
});
