import { normalizeAestheticProfile } from "./aesthetic-profile";
import type { ChangeRequest, StoryContract } from "./types";

function contractContent(contract: StoryContract) {
  return {
    premise: contract.premise,
    genreSubtype: contract.genreSubtype ?? "",
    fanqieCategoryKey: contract.fanqieCategoryKey ?? "",
    secondaryGenres: contract.secondaryGenres ?? [],
    genreElements: contract.genreElements ?? [],
    customGenreDirection: contract.customGenreDirection ?? "",
    audience: contract.audience ?? "",
    commercialHook: contract.commercialHook ?? "",
    openingMechanism: contract.openingMechanism ?? "",
    growthCarrier: contract.growthCarrier ?? "",
    primaryPayoff: contract.primaryPayoff ?? "",
    longFormEngine: contract.longFormEngine ?? "",
    protagonistDesire: contract.protagonistDesire,
    protagonistArc: contract.protagonistArc ?? "",
    keyRelationships: contract.keyRelationships ?? [],
    worldRules: contract.worldRules ?? [],
    majorForces: contract.majorForces ?? [],
    timelineAnchors: contract.timelineAnchors ?? [],
    readerPromise: contract.readerPromise,
    coreEmotion: contract.coreEmotion,
    ending: contract.ending,
    immutableRules: contract.immutableRules,
    prohibitedPatterns: contract.prohibitedPatterns,
    majorStateChanges: contract.majorStateChanges ?? {
      include: [],
      exclude: [],
    },
    aestheticProfile: normalizeAestheticProfile(contract.aestheticProfile),
  };
}

export function contractContentChanged(
  previous: StoryContract,
  candidate: StoryContract,
) {
  return (
    JSON.stringify(contractContent(previous)) !==
    JSON.stringify(contractContent(candidate))
  );
}

export function prepareContractUpdate(
  previous: StoryContract,
  candidate: StoryContract,
  updatedAt: string,
) {
  if (!contractContentChanged(previous, candidate)) {
    return { changed: false as const, contract: previous };
  }
  return {
    changed: true as const,
    contract: {
      ...candidate,
      aestheticProfile: normalizeAestheticProfile(
        candidate.aestheticProfile,
      ),
      approved: false,
      version: previous.version + 1,
      updatedAt,
    } satisfies StoryContract,
  };
}

export function missingContractApprovalFields(contract: StoryContract) {
  const required: Array<[string, string | undefined]> = [
    ["故事前提", contract.premise],
    ["读者承诺", contract.readerPromise],
    ["故事终局", contract.ending],
    ["开局机制", contract.openingMechanism],
    ["成长载体", contract.growthCarrier],
    ["核心回报", contract.primaryPayoff],
    ["长篇发动机", contract.longFormEngine],
  ];
  const missing = required
    .filter(([, value]) => !value?.trim())
    .map(([label]) => label);
  if (!contract.protagonistArc?.trim()) missing.push("主角弧光");
  const meaningfulCount = (values: readonly string[] | undefined) =>
    values?.filter((value) => value.trim()).length ?? 0;
  if (meaningfulCount(contract.keyRelationships) < 2)
    missing.push("关键关系（至少2条）");
  if (meaningfulCount(contract.worldRules) < 2)
    missing.push("世界规则（至少2条）");
  if (meaningfulCount(contract.majorForces) < 2)
    missing.push("主要势力（至少2个）");
  if (meaningfulCount(contract.timelineAnchors) < 3)
    missing.push("时间锚点（至少3条）");
  return missing;
}

export function findApprovedContractChange(
  changes: readonly ChangeRequest[],
  baseVersion: number,
) {
  return changes
    .filter(
      (change) =>
        change.status === "已批准" &&
        change.targetKind === "创作契约" &&
        change.targetId === "contract" &&
        change.baseVersion === baseVersion,
    )
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
}

export function approveContractDraft(
  contract: StoryContract,
  updatedAt: string,
) {
  const missing = missingContractApprovalFields(contract);
  if (missing.length)
    throw new Error(`创作契约尚未补全：${missing.join("、")}`);
  return { ...contract, approved: true, updatedAt };
}
