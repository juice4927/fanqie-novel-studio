import { Check, ChevronRight, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { describeError } from "../lib/error-message";
import type { CategoryTagStat } from "../shared/category-tags";
import {
  DEFAULT_WORDS_PER_CHAPTER,
  LENGTH_SHAPES,
  MAX_WORDS_PER_CHAPTER,
  MIN_WORDS_PER_CHAPTER,
  NARRATIVE_PERSONS,
  OPENING_ARCHETYPES,
  PROTAGONIST_ROLES,
  TONE_TAGS,
} from "../shared/creation-options";
import { FANQIE_CATEGORY_PROFILES, getFanqieCategoryProfile, listFanqieSubGenres } from "../shared/fanqie-taxonomy";
import { GENRE_ELEMENT_GROUPS, NARRATIVE_GENRES, type NarrativeGenre } from "../shared/genre-composition";
import { GENRE_PLUGINS } from "../shared/genre-plugins";
import type { IncubationPositioning } from "../shared/incubation";
import { positioningToConceptInput } from "../shared/incubation";
import { blockingFindings, reviewIncubationCandidate, summarizeFindings } from "../shared/incubation-review";
import type {
  AppApi,
  Genre,
  IncubationCandidate,
  IncubationDraft,
  InsightPack,
  MarketOpportunity,
  ProjectSummary,
} from "../shared/types";
import { Badge, Button, Field, Input, Modal, Segmented, Select, Textarea } from "./UI";

type CreateMode = "AI 从零开书" | "手动创建";

const TARGET_WORD_PRESETS = [1_000_000, 1_500_000, 3_000_000];

function defaultPositioning(): IncubationPositioning {
  const category = FANQIE_CATEGORY_PROFILES[0];
  return {
    genre: category.genre,
    fanqieCategoryKey: category.key,
    subGenreIds: [],
    openingArchetype: OPENING_ARCHETYPES[0],
    lengthShape: LENGTH_SHAPES[0].name,
    narrativePerson: NARRATIVE_PERSONS[0],
    protagonistRoles: [],
    toneTags: [],
    secondaryGenres: [...category.narrativeGenres],
    genreElements: [...category.genreElements],
    customGenreDirection: "",
    targetWords: 1_000_000,
    wordsPerChapter: DEFAULT_WORDS_PER_CHAPTER,
    updateCadence: "每日 2 章",
    safeStockLine: 10,
    readerPersona: category.readerAgeBand,
    readerPromise: category.baselineDelta?.readerPromise ?? "",
    commercialBoundary: "",
  };
}

function toggleValue<T>(list: T[], value: T, max?: number) {
  if (list.includes(value)) return list.filter((item) => item !== value);
  if (max && list.length >= max) return list;
  return [...list, value];
}

export function NewProjectModal({
  api,
  initialDraft = null,
  onClose,
  onCreated,
  notify,
}: {
  api: AppApi;
  initialDraft?: IncubationDraft | null;
  onClose: () => void;
  onCreated: (project: ProjectSummary) => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [mode, setMode] = useState<CreateMode>("AI 从零开书");
  const [draftId, setDraftId] = useState<string | null>(initialDraft?.id ?? null);
  const [positioning, setPositioning] = useState<IncubationPositioning>(
    () => initialDraft?.positioning ?? defaultPositioning(),
  );
  const [seed, setSeed] = useState(initialDraft?.seed ?? "");
  const [manualTitle, setManualTitle] = useState("");
  const [concepts, setConcepts] = useState<IncubationCandidate[]>(() => initialDraft?.candidates ?? []);
  const [selectedId, setSelectedId] = useState<string | null>(initialDraft?.selectedCandidateId ?? null);
  const [acknowledged, setAcknowledged] = useState<string[]>(() => initialDraft?.review.acknowledged ?? []);
  const [evidenceTags, setEvidenceTags] = useState<string[]>(() => initialDraft?.evidence.categoryTags ?? []);
  const [evidenceInsights, setEvidenceInsights] = useState<string[]>(() => initialDraft?.evidence.insightIds ?? []);
  const [evidenceOpportunities, setEvidenceOpportunities] = useState<string[]>(
    () => initialDraft?.evidence.marketOpportunityKeys ?? [],
  );
  const [tagStats, setTagStats] = useState<CategoryTagStat[]>([]);
  const [insightOptions, setInsightOptions] = useState<InsightPack[]>([]);
  const [opportunities, setOpportunities] = useState<MarketOpportunity[]>([]);
  const [signatures, setSignatures] = useState<Array<{ title: string; premise: string; openingMechanism: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [busyMessage, setBusyMessage] = useState("正在处理…");

  const category = getFanqieCategoryProfile(positioning.fanqieCategoryKey);
  const subGenreOptions = listFanqieSubGenres(positioning.fanqieCategoryKey);
  const plugin = GENRE_PLUGINS[positioning.genre];
  const selected = concepts.find((item) => item.id === selectedId) ?? null;
  const selectedSubGenres = subGenreOptions.filter((item) => selected?.subGenreIds.includes(item.id));
  const findings = useMemo(
    () =>
      selected
        ? reviewIncubationCandidate({
            candidate: selected,
            targetWords: positioning.targetWords,
            wordsPerChapter: positioning.wordsPerChapter,
            genreElements: selected.genreElements,
            category,
            subGenres: selectedSubGenres,
            skeleton: null,
            tagStats: category?.tags,
            existingContracts: signatures,
          })
        : [],
    [selected, positioning.targetWords, positioning.wordsPerChapter, category, selectedSubGenres, signatures],
  );
  const summary = summarizeFindings(findings);
  const blocking = blockingFindings(findings, acknowledged);

  useEffect(() => {
    let active = true;
    void api
      .getCategoryTags(positioning.fanqieCategoryKey)
      .then((next) => {
        if (active) setTagStats(next);
      })
      .catch(() => {
        if (active) setTagStats([]);
      });
    return () => {
      active = false;
    };
  }, [api, positioning.fanqieCategoryKey]);

  useEffect(() => {
    let active = true;
    void api
      .listInsights()
      .then((next) => {
        if (active) setInsightOptions(next);
      })
      .catch(() => {
        if (active) setInsightOptions([]);
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    void api
      .listProjectSignatures()
      .then((next) => {
        if (active) setSignatures(next);
      })
      .catch(() => {
        if (active) setSignatures([]);
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let active = true;
    void api
      .getRankingAnalytics()
      .then((next) => {
        if (active)
          setOpportunities(
            next.marketOpportunities.filter(
              (item) => !item.categoryKey || item.categoryKey === positioning.fanqieCategoryKey,
            ),
          );
      })
      .catch(() => {
        if (active) setOpportunities([]);
      });
    return () => {
      active = false;
    };
  }, [api, positioning.fanqieCategoryKey]);

  const patch = (next: Partial<IncubationPositioning>) => {
    setPositioning((current) => ({ ...current, ...next }));
    setConcepts([]);
    setSelectedId(null);
    setAcknowledged([]);
  };

  const selectCategory = (key: string) => {
    const profile = getFanqieCategoryProfile(key);
    if (!profile) return;
    patch({
      fanqieCategoryKey: key,
      genre: profile.genre,
      subGenreIds: [],
      secondaryGenres: [...profile.narrativeGenres],
      genreElements: [...profile.genreElements],
      wordsPerChapter: profile.typicalChapterWords[0],
      readerPersona: profile.readerAgeBand,
      readerPromise: profile.baselineDelta?.readerPromise ?? "",
    });
  };

  const generate = async () => {
    setBusyMessage("正在构思三套方案…");
    setBusy(true);
    try {
      const next = await api.generateBookConcepts(
        positioningToConceptInput(positioning, seed, {
          insightIds: evidenceInsights,
          notes: evidenceOpportunities,
        }),
      );
      setConcepts(next);
      setSelectedId(next[0]?.id ?? null);
      setAcknowledged([]);
    } catch (error) {
      notify(describeError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusyMessage(mode === "AI 从零开书" ? "正在完善人物与世界…" : "正在创建作品…");
    setBusy(true);
    try {
      let project: ProjectSummary;
      if (mode === "AI 从零开书" && selected) {
        if (draftId) {
          await api.saveIncubation(buildDraft({ selectedCandidateId: selected.id }));
          project = await api.promoteIncubation(draftId);
        } else {
          project = await api.createProjectFromConcept(
            positioningToConceptInput(positioning, seed, {
              insightIds: evidenceInsights,
              notes: evidenceOpportunities,
            }),
            selected,
          );
        }
      } else {
        project = await api.createProject({
          title: manualTitle.trim(),
          genre: positioning.genre,
          targetWords: positioning.targetWords,
          wordsPerChapter: positioning.wordsPerChapter,
          updateCadence: positioning.updateCadence,
          safeStockLine: positioning.safeStockLine,
          secondaryGenres: positioning.secondaryGenres,
          genreElements: positioning.genreElements,
          customGenreDirection: positioning.customGenreDirection,
        });
      }
      await onCreated(project);
    } catch (error) {
      notify(describeError(error), "error");
      setBusy(false);
    }
  };

  const buildDraft = (overrides: Partial<IncubationDraft> = {}): IncubationDraft => ({
    id: draftId ?? crypto.randomUUID(),
    status: "孵化中",
    step: "体检",
    positioning,
    evidence: {
      insightIds: evidenceInsights,
      marketOpportunityKeys: evidenceOpportunities,
      categoryTags: evidenceTags,
      skipped: evidenceTags.length === 0 && evidenceInsights.length === 0 && evidenceOpportunities.length === 0,
    },
    seed,
    candidates: concepts,
    selectedCandidateId: selectedId,
    skeleton: initialDraft?.skeleton ?? null,
    review: { acknowledged },
    createdProjectId: null,
    createdAt: initialDraft?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  const saveDraft = async () => {
    setBusyMessage("正在保存立项草稿…");
    setBusy(true);
    try {
      const saved = await api.saveIncubation(buildDraft());
      setDraftId(saved.id);
      notify("立项草稿已保存，可在多书总览继续");
    } catch (error) {
      notify(describeError(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={initialDraft ? "继续立项草稿" : "从 0 开始创建一本书"}
      onClose={() => !busy && onClose()}
      width={1020}
    >
      <div className="book-wizard">
        <Segmented
          options={["AI 从零开书", "手动创建"] as const}
          value={mode}
          onChange={(value) => {
            setMode(value);
            setConcepts([]);
            setSelectedId(null);
          }}
        />
        <details className="positioning-group" open>
          <summary>
            <ChevronRight size={15} /> 题材定位
          </summary>
          <div className="form-grid three">
            <Field label="番茄目标分类" hint="37 个官方榜单分类，选定后自动带出商业基线">
              <Select
                value={positioning.fanqieCategoryKey}
                onChange={(event) => selectCategory(event.target.value)}
                disabled={busy}
              >
                {(["男频", "女频"] as const).map((channel) => (
                  <optgroup key={channel} label={channel}>
                    {FANQIE_CATEGORY_PROFILES.filter((item) => item.channel === channel).map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            </Field>
            <Field label="平台主题材" hint="由分类自动推导，决定写作基线规则">
              <Select
                value={positioning.genre}
                onChange={(event) => patch({ genre: event.target.value as Genre })}
                disabled={busy}
              >
                {(Object.keys(GENRE_PLUGINS) as Genre[]).map((genre) => (
                  <option key={genre}>{genre}</option>
                ))}
              </Select>
            </Field>
            <Field label="二级流派" hint={`可选 1–2 个；${subGenreOptions.length} 个可选`}>
              <div className="genre-option-grid compact">
                {subGenreOptions.map((item) => (
                  <label key={item.id} className="check-row">
                    <input
                      type="checkbox"
                      checked={positioning.subGenreIds.includes(item.id)}
                      disabled={
                        busy || (!positioning.subGenreIds.includes(item.id) && positioning.subGenreIds.length >= 2)
                      }
                      onChange={() => patch({ subGenreIds: toggleValue(positioning.subGenreIds, item.id, 2) })}
                    />
                    {item.name}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          {category && (
            <div className="wizard-genre-note">
              <strong>
                {category.channel}·{category.name}
              </strong>
              <span>
                开篇抓手：{category.openingFocus}｜首章钩子：{category.chapterHookStyle}｜首个回报：第{" "}
                {category.firstPayoffWindow[0]}–{category.firstPayoffWindow[1]} 章｜单章参考：
                {category.typicalChapterWords[0]}–{category.typicalChapterWords[1]} 字
              </span>
              <span>常见毒点：{category.clicheTraps.join("；")}</span>
            </div>
          )}
        </details>
        <details className="positioning-group" open>
          <summary>
            <ChevronRight size={15} /> 证据（可跳过）
          </summary>
          {tagStats.length ? (
            <>
              <p className="muted-line">
                来自本地已采集的公开榜单快照，按新书占比与上榜比例排序；勾选后作为本次立项的定位参考。
              </p>
              <div className="genre-option-grid">
                {tagStats.slice(0, 24).map((stat) => (
                  <label
                    key={stat.tag}
                    className="check-row"
                    title={`样本 ${stat.count} 本 · 平均排名 ${stat.avgRank.toFixed(1)}`}
                  >
                    <input
                      type="checkbox"
                      checked={evidenceTags.includes(stat.tag)}
                      disabled={busy}
                      onChange={() => setEvidenceTags((current) => toggleValue(current, stat.tag))}
                    />
                    {stat.tag}
                    <small>{Math.round(stat.share * 100)}%</small>
                  </label>
                ))}
              </div>
            </>
          ) : (
            <p className="muted-line">该分类还没有本地榜单快照。可在“市场研究”采集榜单后再回来，或直接跳过证据。</p>
          )}
          <Field
            label="榜单机会"
            hint={
              opportunities.length
                ? "来自本地榜单快照的趋势统计（竞争度、新书率、动量），只作需求证据，不会机械追热点。"
                : "该分类还没有足够快照形成机会判断，可跳过。"
            }
          >
            {opportunities.length ? (
              <div className="choice-list compact">
                {opportunities.map((item) => (
                  <label key={item.listName}>
                    <input
                      type="checkbox"
                      checked={evidenceOpportunities.includes(item.recommendation)}
                      disabled={busy}
                      onChange={() => setEvidenceOpportunities((current) => toggleValue(current, item.recommendation))}
                    />
                    <span>
                      <strong>{item.categoryName}</strong>
                      <small>{item.recommendation}</small>
                    </span>
                    <Badge tone={item.competition === "高" ? "warning" : "accent"}>竞争 {item.competition}</Badge>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted-line">暂无榜单机会数据。</p>
            )}
          </Field>
          <Field
            label="脱敏市场洞察"
            hint={
              insightOptions.length
                ? "只读取研究区生成的脱敏洞察包，不涉及样本书名与原文；勾选后会作为需求证据进入三案生成。"
                : "还没有脱敏洞察包。可在“市场研究”拆书后生成，或直接跳过。"
            }
          >
            {insightOptions.length ? (
              <div className="choice-list compact">
                {insightOptions.map((insight) => (
                  <label key={insight.id}>
                    <input
                      type="checkbox"
                      checked={evidenceInsights.includes(insight.id)}
                      disabled={busy}
                      onChange={() => setEvidenceInsights((current) => toggleValue(current, insight.id))}
                    />
                    <span>
                      <strong>{insight.name}</strong>
                      <small>
                        {insight.genre} · {insight.marketGap}
                      </small>
                    </span>
                    <Badge>{insight.confidence}</Badge>
                  </label>
                ))}
              </div>
            ) : (
              <p className="muted-line">暂无洞察包。</p>
            )}
          </Field>
        </details>
        <details className="positioning-group" open>
          <summary>
            <ChevronRight size={15} /> 故事定位
          </summary>
          <div className="form-grid three">
            <Field label="开局形态">
              <Select
                value={positioning.openingArchetype}
                onChange={(event) => patch({ openingArchetype: event.target.value })}
                disabled={busy}
              >
                {OPENING_ARCHETYPES.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Field>
            <Field label="篇幅形态">
              <Select
                value={positioning.lengthShape}
                onChange={(event) => patch({ lengthShape: event.target.value })}
                disabled={busy}
              >
                {LENGTH_SHAPES.map((item) => (
                  <option key={item.name}>{item.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="视角">
              <Select
                value={positioning.narrativePerson}
                onChange={(event) => patch({ narrativePerson: event.target.value })}
                disabled={busy}
              >
                {NARRATIVE_PERSONS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="复合叙事类型" hint="最多 3 项；决定主要冲突与情绪体验">
            <div className="genre-option-grid">
              {NARRATIVE_GENRES.map((genre) => (
                <label key={genre} className="check-row">
                  <input
                    type="checkbox"
                    checked={positioning.secondaryGenres.includes(genre)}
                    disabled={
                      busy || (!positioning.secondaryGenres.includes(genre) && positioning.secondaryGenres.length >= 3)
                    }
                    onChange={() =>
                      patch({ secondaryGenres: toggleValue(positioning.secondaryGenres, genre as NarrativeGenre, 3) })
                    }
                  />
                  {genre}
                </label>
              ))}
            </div>
          </Field>
          {GENRE_ELEMENT_GROUPS.map((group) => (
            <Field key={group.label} label={group.label} hint="按需多选，不会要求每章都出现">
              <div className="genre-option-grid">
                {group.elements.map((element) => (
                  <label key={element} className="check-row">
                    <input
                      type="checkbox"
                      checked={positioning.genreElements.includes(element)}
                      disabled={
                        busy || (!positioning.genreElements.includes(element) && positioning.genreElements.length >= 8)
                      }
                      onChange={() => patch({ genreElements: toggleValue(positioning.genreElements, element, 8) })}
                    />
                    {element}
                  </label>
                ))}
              </div>
            </Field>
          ))}
          <div className="form-grid three">
            <Field label="主角身份" hint="最多 2 项">
              <div className="genre-option-grid compact">
                {PROTAGONIST_ROLES.map((role) => (
                  <label key={role} className="check-row">
                    <input
                      type="checkbox"
                      checked={positioning.protagonistRoles.includes(role)}
                      disabled={
                        busy ||
                        (!positioning.protagonistRoles.includes(role) && positioning.protagonistRoles.length >= 2)
                      }
                      onChange={() => patch({ protagonistRoles: toggleValue(positioning.protagonistRoles, role, 2) })}
                    />
                    {role}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="情绪基调" hint="最多 2 项">
              <div className="genre-option-grid compact">
                {TONE_TAGS.map((tone) => (
                  <label key={tone} className="check-row">
                    <input
                      type="checkbox"
                      checked={positioning.toneTags.includes(tone)}
                      disabled={busy || (!positioning.toneTags.includes(tone) && positioning.toneTags.length >= 2)}
                      onChange={() => patch({ toneTags: toggleValue(positioning.toneTags, tone, 2) })}
                    />
                    {tone}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <Field label="自定义创作方向" hint="补充列表里没有的混合方式、反套路要求或题材边界">
            <Input
              value={positioning.customGenreDirection}
              onChange={(event) => patch({ customGenreDirection: event.target.value })}
              placeholder="例如：医疗悬疑为主，不要系统，用群像推进真相"
              disabled={busy}
            />
          </Field>
        </details>
        <details className="positioning-group" open>
          <summary>
            <ChevronRight size={15} /> 规模与节奏
          </summary>
          <div className="form-grid three">
            <Field label="目标字数">
              <Select
                value={positioning.targetWords}
                onChange={(event) => patch({ targetWords: Number(event.target.value) })}
                disabled={busy}
              >
                {TARGET_WORD_PRESETS.map((words) => (
                  <option key={words} value={words}>
                    {words / 10000} 万字
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="单章字数" hint={`${MIN_WORDS_PER_CHAPTER}–${MAX_WORDS_PER_CHAPTER}`}>
              <Input
                type="number"
                min={MIN_WORDS_PER_CHAPTER}
                max={MAX_WORDS_PER_CHAPTER}
                step={100}
                value={positioning.wordsPerChapter}
                onChange={(event) => patch({ wordsPerChapter: Number(event.target.value) })}
                disabled={busy}
              />
            </Field>
            <Field label="安全存稿线">
              <Input
                type="number"
                min={0}
                max={1000}
                value={positioning.safeStockLine}
                onChange={(event) => patch({ safeStockLine: Number(event.target.value) })}
                disabled={busy}
              />
            </Field>
          </div>
          <Field label="更新节奏">
            <Input
              value={positioning.updateCadence}
              onChange={(event) => patch({ updateCadence: event.target.value })}
              disabled={busy}
            />
          </Field>
        </details>
        {mode === "手动创建" ? (
          <Field label="书名">
            <Input
              autoFocus
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              placeholder="输入暂定书名"
              disabled={busy}
            />
          </Field>
        ) : (
          <>
            <Field
              label="你已有的灵感（可不填）"
              hint={`系统以 ${positioning.genre} 与所选分类为商业基线；可只写一句人物、情境或想要的情绪。`}
            >
              <Textarea
                value={seed}
                onChange={(event) => setSeed(event.target.value)}
                placeholder="例如：女主重回八零年代，不想再替妹妹牺牲；留空则完全由 AI 提案。"
                disabled={busy}
              />
            </Field>
            <div className="wizard-genre-note">
              <strong>本次定位</strong>
              <span>{plugin.readerPromise}</span>
            </div>
            {!concepts.length ? (
              <div className="wizard-generate">
                <Sparkles size={24} />
                <div>
                  <strong>AI 会先给出 3 套完整开书方案</strong>
                  <span>每套包含书名候选、故事前提、开局设计、升级阶梯、差异化说明与未审批创作契约。</span>
                </div>
                <Button
                  icon={busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
                  disabled={busy}
                  onClick={generate}
                >
                  {busy ? "正在构思…" : "生成三套方案"}
                </Button>
              </div>
            ) : (
              <div className="book-concept-grid">
                {concepts.map((concept) => (
                  <button
                    type="button"
                    key={concept.id}
                    className={selectedId === concept.id ? "selected" : ""}
                    onClick={() => {
                      setSelectedId(concept.id);
                      setAcknowledged([]);
                    }}
                  >
                    <header>
                      <span>{concept.genreSubtype}</span>
                      {selectedId === concept.id && <Check size={17} />}
                    </header>
                    <h3>{concept.title}</h3>
                    <p>{concept.premise}</p>
                    <dl>
                      <dt>书名候选</dt>
                      <dd>{concept.titleOptions.map((item) => item.title).join(" / ")}</dd>
                      <dt>首章钩子</dt>
                      <dd>{concept.openingDesign.chapter1Hook}</dd>
                      <dt>前三章承诺</dt>
                      <dd>{concept.openingDesign.firstThreeChaptersPromise}</dd>
                      <dt>首个回报</dt>
                      <dd>第 {concept.openingDesign.firstPayoffChapter} 章</dd>
                      <dt>升级阶梯</dt>
                      <dd>
                        {concept.escalationLadder.map((step) => `${step.stage}（${step.expansionAxis}）`).join(" → ")}
                      </dd>
                      <dt>差异化</dt>
                      <dd>{concept.differentiation.against.join("；")}</dd>
                      <dt>建议标签</dt>
                      <dd>{concept.suggestedTags.join("、")}</dd>
                      <dt>长篇发动机</dt>
                      <dd>{concept.longFormEngine}</dd>
                    </dl>
                  </button>
                ))}
              </div>
            )}
            {selected && findings.length > 0 && (
              <section className="finding-panel">
                <div className="finding-summary">
                  <strong>立项体检</strong>
                  <span>
                    阻断 {summary.blocked} · 警告 {summary.warnings} · 提示 {summary.hints} · 通过 {summary.passed}
                  </span>
                </div>
                {findings
                  .filter((item) => item.level !== "通过")
                  .map((item) => {
                    const cleared = acknowledged.includes(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`finding-row ${item.level.toLowerCase()}${cleared ? " cleared" : ""}`}
                      >
                        <span className="finding-level">{item.level}</span>
                        <div>
                          <strong>{item.label}</strong>
                          <p>{item.detail}</p>
                          {item.suggestion && <small>{item.suggestion}</small>}
                        </div>
                        {item.level === "阻断" && (
                          <Button
                            variant="secondary"
                            disabled={busy}
                            onClick={() => setAcknowledged((current) => [...current, item.id])}
                          >
                            {cleared ? "已确认" : "人工确认"}
                          </Button>
                        )}
                      </div>
                    );
                  })}
              </section>
            )}
          </>
        )}
        <div className="modal-actions">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            取消
          </Button>
          {mode === "AI 从零开书" && (
            <Button variant="secondary" disabled={busy} onClick={saveDraft}>
              {draftId ? "更新立项草稿" : "保存为立项草稿"}
            </Button>
          )}
          {mode === "AI 从零开书" && concepts.length > 0 && (
            <Button variant="secondary" disabled={busy} icon={<Sparkles size={16} />} onClick={generate}>
              换一批
            </Button>
          )}
          <Button
            disabled={busy || (mode === "手动创建" ? !manualTitle.trim() : !selected || blocking.length > 0)}
            onClick={create}
          >
            {busy ? busyMessage : mode === "AI 从零开书" ? "采用此方案并创建" : "创建空白作品"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
