const HINTS: ReadonlyArray<{ match: RegExp; hint: string }> = [
  { match: /尚未配置 AI API 密钥|未配置 API 密钥/, hint: "请到“系统设置”填写并保存 API 密钥后重试。" },
  { match: /创作契约审批后才能生成正文|创作契约未审批/, hint: "请先到“故事圣经”完成并审批创作契约。" },
  { match: /请先填写本章章纲/, hint: "先补全本章章纲，再生成正文或运行质检。" },
  {
    match: /已定稿或进入发布流程的章节|只能通过匹配的已批准变更单修改/,
    hint: "如需修改，请先提交并批准改纲变更单。",
  },
  {
    match: /已有正文生成或修订任务正在运行|已有正文生成任务正在运行/,
    hint: "等当前任务结束，或到“系统设置 → AI 任务中心”取消后再试。",
  },
  { match: /未解决的硬性问题/, hint: "到“质检中心”处理硬性问题后才能继续。" },
  { match: /输出达到 Anthropic max_tokens|输出被截断/, hint: "可缩短章节目标字数，或更换输出上限更高的模型。" },
  { match: /超时|timed out|ETIMEDOUT|ECONNRESET/i, hint: "模型服务响应超时，可稍后重试或更换模型。" },
  {
    match: /无法连接|fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN/i,
    hint: "检查 API 基础地址、网络或代理设置。",
  },
  { match: /速率|rate limit|429/i, hint: "请求过于频繁，稍后再试或降低并发。" },
];

/** 把原始错误转成“发生了什么 + 可以怎么做”，不改变领域层已有的中文文案。 */
export function describeError(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error ?? "")).replace(/^Error:\s*/, "").trim();
  if (!raw) return "发生未知错误，请重试。";
  const hint = HINTS.find((item) => item.match.test(raw))?.hint;
  return hint ? `${raw}（${hint}）` : raw;
}
