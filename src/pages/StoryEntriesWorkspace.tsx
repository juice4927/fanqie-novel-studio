import { History, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge, Button, EmptyState, Field, Input, Modal, Select, Textarea } from "../components/UI";
import { describeError } from "../lib/error-message";
import { detectMentions } from "../shared/mention-detection";
import { STORY_ENTRY_AI_CONTEXT_LABELS, STORY_ENTRY_KINDS } from "../shared/story-entry-service";
import type { AppApi, ProjectDetail, StoryContract, StoryEntry } from "../shared/types";

interface StoryEntriesPageProps {
  project: ProjectDetail;
  api: AppApi;
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}

function blankEntry(): StoryEntry {
  return {
    id: "",
    kind: "人物",
    name: "",
    aliases: [],
    summary: "",
    detail: "",
    aiContext: "detected",
    effectiveFrom: 1,
    effectiveTo: null,
    revealChapter: null,
    knownBy: [],
    exclusionTerms: [],
    sourceContractItem: null,
    pinned: false,
    updatedAt: "",
  };
}

function parseList(value: string) {
  return [
    ...new Set(
      value
        .split(/[、,，\n]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

function contractListCount(contract: StoryContract) {
  return [
    contract.keyRelationships,
    contract.worldRules,
    contract.majorForces,
    contract.timelineAnchors,
    ...(contract.genreSpecificSections ?? []).map((section) => section.items),
  ].reduce((total, items) => total + (items?.length ?? 0), 0);
}

/** 全书出现章节：章纲与正文分别扫描，命中合并到同一章。 */
function chapterAppearances(entry: StoryEntry, chapters: ProjectDetail["chapters"]) {
  const items: Array<{ number: number; title: string; count: number }> = [];
  for (const chapter of chapters) {
    const [hit] = detectMentions(
      [entry],
      [
        { source: "章纲", text: chapter.outline },
        { source: "草稿", text: chapter.content },
      ],
    );
    if (hit) items.push({ number: chapter.number, title: chapter.title, count: hit.count });
  }
  return items;
}

export function StoryEntriesPage({ project, api, reload, notify }: StoryEntriesPageProps) {
  const [draft, setDraft] = useState<StoryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<StoryEntry["kind"] | "全部">("全部");
  const [contextFilter, setContextFilter] = useState<StoryEntry["aiContext"] | "全部">("全部");
  const [appearances, setAppearances] = useState<{
    entry: StoryEntry;
    items: Array<{ number: number; title: string; count: number }>;
  } | null>(null);
  const entries = project.storyEntries ?? [];
  const seeded = entries.some((entry) => entry.sourceContractItem);
  const seedable = contractListCount(project.contract) > 0 && !seeded;
  const needle = query.trim().toLowerCase();
  const filtered = entries.filter((entry) => {
    if (kindFilter !== "全部" && entry.kind !== kindFilter) return false;
    if (contextFilter !== "全部" && entry.aiContext !== contextFilter) return false;
    if (!needle) return true;
    return [entry.name, ...entry.aliases, entry.summary, entry.detail].some((value) =>
      value.toLowerCase().includes(needle),
    );
  });

  const save = async () => {
    if (!draft?.name.trim()) return;
    setBusy(true);
    try {
      await api.saveStoryEntry(project.summary.id, draft);
      await reload();
      setDraft(null);
      notify("设定条目已保存");
    } catch (error) {
      notify(describeError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const seed = async () => {
    setBusy(true);
    try {
      const created = await api.seedStoryEntries(project.summary.id);
      await reload();
      notify(`已从契约生成设定条目，共 ${created.length} 条`);
    } catch (error) {
      notify(describeError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: StoryEntry) => {
    if (!window.confirm(`删除设定条目「${entry.name}」？删除后该条目不再参与生成。`)) return;
    try {
      await api.deleteStoryEntry(project.summary.id, entry.id);
      await reload();
      notify("设定条目已删除");
    } catch (error) {
      notify(describeError(error), "error");
    }
  };

  return (
    <div className="page">
      <section className="section-band">
        <div className="section-heading">
          <div>
            <h2>设定条目</h2>
            <p>
              条目只在被本章章纲、上一章末尾或当前草稿提及时注入，并按生效区间与揭示进度过滤；
              世界规则默认常驻，避免"没提到就不给"。
            </p>
          </div>
          <div className="story-entry-actions">
            {seedable && (
              <Button variant="secondary" icon={<Sparkles size={16} />} disabled={busy} onClick={() => void seed()}>
                从契约生成条目
              </Button>
            )}
            <Button icon={<Plus size={16} />} onClick={() => setDraft(blankEntry())}>
              新增条目
            </Button>
          </div>
        </div>
        <div className="expectation-stats">
          <div>
            <strong>{entries.length}</strong>
            <span>条目总数</span>
          </div>
          <div>
            <strong>{entries.filter((entry) => entry.pinned || entry.aiContext === "always").length}</strong>
            <span>常驻</span>
          </div>
          <div>
            <strong>{entries.filter((entry) => entry.aiContext === "detected").length}</strong>
            <span>命中才注入</span>
          </div>
        </div>
        {entries.length ? (
          <>
            <div className="issue-toolbar">
              <div className="story-entry-filters">
                <Input
                  value={query}
                  placeholder="搜索名称、别名、摘要或详述"
                  aria-label="搜索设定条目"
                  onChange={(event) => setQuery(event.target.value)}
                />
                <Select
                  value={kindFilter}
                  aria-label="按类型筛选"
                  onChange={(event) => setKindFilter(event.target.value as StoryEntry["kind"] | "全部")}
                >
                  <option>全部</option>
                  {STORY_ENTRY_KINDS.map((kind) => (
                    <option key={kind}>{kind}</option>
                  ))}
                </Select>
                <Select
                  value={contextFilter}
                  aria-label="按 AI 策略筛选"
                  onChange={(event) => setContextFilter(event.target.value as StoryEntry["aiContext"] | "全部")}
                >
                  <option>全部</option>
                  {Object.entries(STORY_ENTRY_AI_CONTEXT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <small>
                {filtered.length} / {entries.length} 条
              </small>
            </div>
            {filtered.length ? (
              <div className="expectation-list">
                {filtered.map((entry) => (
                  <div key={entry.id} className="story-entry-row">
                    <span>
                      <strong>{entry.name}</strong>
                      <small>{entry.summary || entry.detail.slice(0, 40) || "未填写摘要"}</small>
                    </span>
                    <span>
                      <Badge>{entry.kind}</Badge>
                      <small>
                        {STORY_ENTRY_AI_CONTEXT_LABELS[entry.aiContext]}
                        {entry.pinned ? " · 常驻" : ""}
                      </small>
                    </span>
                    <span>
                      <small>
                        第 {entry.effectiveFrom}
                        {entry.effectiveTo === null ? " 章起" : `–${entry.effectiveTo} 章`}
                      </small>
                      <small>{entry.revealChapter === null ? "无揭示章" : `第 ${entry.revealChapter} 章揭示`}</small>
                    </span>
                    <div className="story-entry-actions">
                      <Button
                        variant="ghost"
                        icon={<History size={15} />}
                        onClick={() => setAppearances({ entry, items: chapterAppearances(entry, project.chapters) })}
                      >
                        出现章节
                      </Button>
                      <Button variant="secondary" icon={<Pencil size={15} />} onClick={() => setDraft(entry)}>
                        编辑
                      </Button>
                      <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => void remove(entry)}>
                        删除
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted-line">没有符合筛选条件的条目</p>
            )}
          </>
        ) : (
          <EmptyState
            icon={<Sparkles size={20} />}
            title="还没有设定条目"
            description="从契约长列表生成条目后，关键设定会按提及注入，不再被上下文预算截断。"
            action={
              contractListCount(project.contract) > 0 ? (
                <Button icon={<Sparkles size={16} />} disabled={busy} onClick={() => void seed()}>
                  从契约生成条目
                </Button>
              ) : undefined
            }
          />
        )}
      </section>
      {appearances && (
        <Modal title={`出现章节 · ${appearances.entry.name}`} onClose={() => setAppearances(null)}>
          {appearances.items.length ? (
            <>
              <p className="muted">
                共出现在 {appearances.items.length} 章（章纲或正文命中主名/别名）。
                如果这里出现明显不该命中的章节，给条目加排除词。
              </p>
              <div className="expectation-list">
                {appearances.items.map((item) => (
                  <div key={item.number} className="story-entry-row">
                    <span>
                      <strong>第{item.number}章</strong>
                      <small>{item.title}</small>
                    </span>
                    <span>
                      <small>命中 {item.count} 次</small>
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="muted-line">还没有在任何章纲或正文里出现。</p>
          )}
        </Modal>
      )}
      {draft && (
        <Modal
          title={draft.id ? `编辑条目 · ${draft.name || "未命名"}` : "新增设定条目"}
          onClose={() => setDraft(null)}
        >
          <div className="form-grid two">
            <Field label="名称" hint="提及检测的主匹配词">
              <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
            </Field>
            <Field label="类型">
              <Select
                value={draft.kind}
                onChange={(event) => setDraft({ ...draft, kind: event.target.value as StoryEntry["kind"] })}
              >
                {STORY_ENTRY_KINDS.map((kind) => (
                  <option key={kind}>{kind}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="别名 / 称呼" hint="用顿号或逗号分隔，例如：小林、林队">
            <Input
              value={draft.aliases.join("、")}
              onChange={(event) => setDraft({ ...draft, aliases: parseList(event.target.value) })}
            />
          </Field>
          <div className="form-grid two">
            <Field label="AI 策略">
              <Select
                value={draft.aiContext}
                onChange={(event) => setDraft({ ...draft, aiContext: event.target.value as StoryEntry["aiContext"] })}
              >
                {Object.entries(STORY_ENTRY_AI_CONTEXT_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="常驻" hint="等价于无条件注入，可随时取消">
              <Select
                value={draft.pinned ? "是" : "否"}
                onChange={(event) => setDraft({ ...draft, pinned: event.target.value === "是" })}
              >
                <option>否</option>
                <option>是</option>
              </Select>
            </Field>
          </div>
          <div className="form-grid three">
            <Field label="生效起始章">
              <Input
                type="number"
                min={1}
                value={draft.effectiveFrom}
                onChange={(event) => setDraft({ ...draft, effectiveFrom: Number(event.target.value) || 1 })}
              />
            </Field>
            <Field label="生效结束章" hint="留空表示一直有效">
              <Input
                type="number"
                min={1}
                value={draft.effectiveTo ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, effectiveTo: event.target.value ? Number(event.target.value) : null })
                }
              />
            </Field>
            <Field label="揭示章" hint="读者知道该设定的章号；早于它只注入摘要">
              <Input
                type="number"
                min={1}
                value={draft.revealChapter ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, revealChapter: event.target.value ? Number(event.target.value) : null })
                }
              />
            </Field>
          </div>
          <Field label="知情角色" hint="用顿号分隔；用于渲染知情范围提示">
            <Input
              value={draft.knownBy.join("、")}
              onChange={(event) => setDraft({ ...draft, knownBy: parseList(event.target.value) })}
            />
          </Field>
          <Field label="排除词" hint="命中区间与排除词重叠时不注入，用于避免常见词误命中">
            <Input
              value={draft.exclusionTerms.join("、")}
              onChange={(event) => setDraft({ ...draft, exclusionTerms: parseList(event.target.value) })}
            />
          </Field>
          <Field label="摘要" hint="默认注入的一行内容">
            <Input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} />
          </Field>
          <Field label="详述" hint="命中且预算充足时注入">
            <Textarea
              rows={5}
              value={draft.detail}
              onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
            />
          </Field>
          <div className="modal-actions">
            <Button variant="secondary" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button disabled={busy || !draft.name.trim()} onClick={() => void save()}>
              保存条目
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
