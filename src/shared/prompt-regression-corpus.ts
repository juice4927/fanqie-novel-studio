import type { PromptFixture } from "./prompt-evaluation";
import { PROMPT_VERSION } from "./prompt-version";

export const PROMPT_REGRESSION_BASELINE = {
  promptVersion: PROMPT_VERSION,
  minimumAverageScore: 92,
  fixtures: [
    {
      fixture: {
        id: "draft-chapter",
        requiredKeys: ["title", "content"],
        forbiddenFacts: ["林舟已经知道密码"],
        maxCharacters: 5000,
      } satisfies PromptFixture,
      output: {
        title: "锁住的机房",
        content:
          "林舟检查门锁留下的划痕，确认有人刚刚进入。他没有猜测密码，而是先调取门禁记录。屏幕上缺失的十分钟，让新的问题浮出水面。",
      },
      inputTokens: 2400,
      outputTokens: 900,
    },
    {
      fixture: {
        id: "extract-chapter-facts",
        requiredKeys: ["facts"],
        forbiddenFacts: ["一百万元"],
        maxCharacters: 2500,
      } satisfies PromptFixture,
      output: {
        facts: [
          {
            kind: "能力",
            subject: "林舟",
            predicate: "使用代价",
            value: "失去近期记忆",
            knowledgeScope: "林舟",
            evidence: "每用一次能力，他就会失去一段近期记忆",
          },
        ],
      },
      inputTokens: 1800,
      outputTokens: 180,
    },
    {
      fixture: {
        id: "quality-review",
        requiredKeys: ["issues"],
        forbiddenFacts: ["不存在的契约条款"],
        maxCharacters: 3000,
      } satisfies PromptFixture,
      output: {
        issues: [
          { severity: "警告", category: "因果", message: "进入机房的行动缺少门禁依据", evidence: "他径直推门进入机房" },
        ],
      },
      inputTokens: 3200,
      outputTokens: 220,
    },
  ],
} as const;
