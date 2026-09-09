import type { AiProfile } from "../../src/shared/ai/types";

export interface CredentialPresenceInput {
  profiles: readonly AiProfile[];
  defaultProfileId: string | null;
  /** 旧版单密钥（仅在没有配置任何来源时兜底）。 */
  legacyApiKey: string;
  credentialFor: (profileId: string) => string;
}

/**
 * 是否已配置可用的 AI 凭据：有来源时按来源判断（默认来源 → 任一启用来源），
 * 没有任何来源时回退旧版单密钥。只回答「是否已配置」，
 * 具体角色用哪个来源的密钥仍由路由解析决定。
 */
export function hasUsableAiCredential(input: CredentialPresenceInput): boolean {
  if (!input.profiles.length) return Boolean(input.legacyApiKey);
  const candidates = [
    input.defaultProfileId ? (input.profiles.find((item) => item.id === input.defaultProfileId) ?? null) : null,
    ...input.profiles.filter((item) => item.enabled),
  ];
  return candidates.some(
    (profile) => profile && (profile.authScheme === "none" || Boolean(input.credentialFor(profile.id))),
  );
}
