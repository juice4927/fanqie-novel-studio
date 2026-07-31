import { useEffect, useState } from "react";
import {
  Check,
  LoaderCircle,
  LockKeyhole,
  Save,
  Sparkles,
} from "lucide-react";
import type {
  AestheticProfile,
  AestheticProfileSuggestion,
  AppApi,
  ProjectDetail,
  StoryContract,
} from "../shared/types";
import { normalizeAestheticProfile } from "../shared/aesthetic-profile";
import { GENRE_PLUGINS } from "../shared/genre-plugins";
import {
  FANQIE_CATEGORY_PROFILES,
  getFanqieCategoryProfile,
} from "../shared/fanqie-taxonomy";
import {
  GENRE_ELEMENT_GROUPS,
  NARRATIVE_GENRES,
} from "../shared/genre-composition";
import {
  Badge,
  Button,
  Field,
  Input,
  Select,
  Textarea,
} from "../components/UI";

interface StoryBiblePageProps {
  project: ProjectDetail;
  api: AppApi;
  reload: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}

function splitLines(value: string) {
  return value
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function StoryBiblePage({ project, api, reload, notify }: StoryBiblePageProps) {
  const normalizeContract = (value: StoryContract): StoryContract => ({
    ...value,
    secondaryGenres: value.secondaryGenres ?? [],
    genreElements: value.genreElements ?? [],
    customGenreDirection: value.customGenreDirection ?? "",
    audience: value.audience ?? "",
    commercialHook: value.commercialHook ?? "",
    openingMechanism: value.openingMechanism ?? "",
    growthCarrier: value.growthCarrier ?? "",
    primaryPayoff: value.primaryPayoff ?? "",
    longFormEngine: value.longFormEngine ?? "",
    protagonistArc: value.protagonistArc ?? "",
    keyRelationships: value.keyRelationships ?? [],
    worldRules: value.worldRules ?? [],
    majorForces: value.majorForces ?? [],
    timelineAnchors: value.timelineAnchors ?? [],
    majorStateChanges: value.majorStateChanges ?? { include: [], exclude: [] },
    aestheticProfile: normalizeAestheticProfile(value.aestheticProfile),
  });
  const [contract, setContract] = useState<StoryContract>(() => normalizeContract(project.contract));
  const [aestheticSuggestion, setAestheticSuggestion] = useState<AestheticProfileSuggestion | null>(null);
  const [optimizingAesthetic, setOptimizingAesthetic] = useState(false);
  useEffect(() => setContract(normalizeContract(project.contract)), [project.contract]);
  const set = (key: keyof StoryContract, value: string | string[]) =>
    setContract((current) => ({ ...current, [key]: value }));
  const setAesthetic = <K extends keyof AestheticProfile,>(
    key: K,
    value: AestheticProfile[K],
  ) => setContract((current) => ({
    ...current,
    aestheticProfile: {
      ...normalizeAestheticProfile(current.aestheticProfile),
      [key]: value,
    },
  }));
  const save = async () => {
    try {
      setContract(await api.saveContract(project.summary.id, contract));
      setAestheticSuggestion(null);
      await reload();
      notify("创作契约已保存为新版本");
    } catch (error) {
      notify(String(error), "error");
    }
  };
  const optimizeAesthetic = async () => {
    setOptimizingAesthetic(true);
    setAestheticSuggestion(null);
    try {
      const suggestion = await api.suggestAestheticProfile(project.summary.id, contract);
      setAestheticSuggestion(suggestion);
      notify("审美优化提案已生成，请审阅后采用");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setOptimizingAesthetic(false);
    }
  };
  const genrePlugin = GENRE_PLUGINS[project.summary.genre];
  const compatibleFanqieCategories = FANQIE_CATEGORY_PROFILES.filter(
    (profile) => profile.genre === project.summary.genre,
  );
  const selectedFanqieCategory = getFanqieCategoryProfile(contract.fanqieCategoryKey);
  return (
    <div className="page project-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">新书设计区</p>
          <h1>故事圣经</h1>
          <p>创作契约是全书最高约束，改动会自动产生版本记录。</p>
        </div>
        <div className="heading-actions">
          <Badge tone={contract.approved ? "success" : "warning"}>
            {contract.approved
              ? `已审批 · v${contract.version}`
              : `待审批 · v${contract.version}`}
          </Badge>
          <Button variant="secondary" icon={<Save size={16} />} onClick={save}>
            保存新版本
          </Button>
          <Button
            icon={<LockKeyhole size={16} />}
            disabled={contract.approved}
            onClick={async () => {
              try {
                await api.approveContract(project.summary.id);
                await reload();
                notify("创作契约已锁定审批");
              } catch (error) {
                notify(
                  error instanceof Error ? error.message : String(error),
                  "error",
                );
              }
            }}
          >
            审批契约
          </Button>
        </div>
      </header>
      <section className="section-band bible-form">
        <Field
          label="番茄目标分类"
          hint="把番茄官方细分类映射到本项目的生成、规划与质检规则"
        >
          <Select
            value={contract.fanqieCategoryKey ?? ""}
            onChange={(event) => {
              const profile = getFanqieCategoryProfile(event.target.value);
              setContract((current) => ({
                ...current,
                fanqieCategoryKey: event.target.value,
                genreSubtype: current.genreSubtype || profile?.recommendedSubtype || "",
                secondaryGenres: current.secondaryGenres?.length ? current.secondaryGenres : profile?.narrativeGenres ?? [],
                genreElements: current.genreElements?.length ? current.genreElements : profile?.genreElements ?? [],
              }));
            }}
          >
            <option value="">尚未选择</option>
            {(["男频", "女频"] as const).map((channel) => (
              <optgroup key={channel} label={channel}>
                {compatibleFanqieCategories.filter((item) => item.channel === channel).map((profile) => (
                  <option key={profile.key} value={profile.key}>{profile.name}</option>
                ))}
              </optgroup>
            ))}
          </Select>
        </Field>
        {selectedFanqieCategory && (
          <div className="fanqie-category-summary">
            <div><span>核心幻想</span><strong>{selectedFanqieCategory.coreFantasy}</strong></div>
            <div><span>目标读者</span><strong>{selectedFanqieCategory.audience}</strong></div>
            <div><span>开篇抓手</span><strong>{selectedFanqieCategory.openingFocus}</strong></div>
            <div><span>禁忌边界</span><strong>{selectedFanqieCategory.taboo}</strong></div>
            <div><span>叙事主轴</span><strong>{selectedFanqieCategory.narrativeGenres.join(" + ")}</strong></div>
          </div>
        )}
        <Field
          label="题材子类型"
          hint="可采用推荐项，也可输入更贴合作品的原创概括"
        >
          <Input
            list="genre-subtype-options"
            value={contract.genreSubtype ?? ""}
            onChange={(event) => set("genreSubtype", event.target.value)}
            placeholder="例如：医疗探案、宗门经营、职场群像"
          />
          <datalist id="genre-subtype-options">
            {genrePlugin.subtypes.map((subtype) => (
              <option key={subtype.name} value={subtype.name} />
            ))}
          </datalist>
        </Field>
        {contract.genreSubtype &&
          genrePlugin.subtypes.find(
            (item) => item.name === contract.genreSubtype,
          ) && (
            <div className="subtype-summary">
              {(() => {
                const subtype = genrePlugin.subtypes.find(
                  (item) => item.name === contract.genreSubtype,
                )!;
                return (
                  <>
                    <div>
                      <span>核心幻想</span>
                      <strong>{subtype.coreFantasy}</strong>
                    </div>
                    <div>
                      <span>目标读者</span>
                      <strong>{subtype.targetAudience}</strong>
                    </div>
                    <div>
                      <span>禁忌边界</span>
                      <strong>{subtype.tabooBoundary}</strong>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        <div className="genre-composer contract-genre-composer">
          <Field label="复合叙事类型" hint="最多选择 3 项；只描述故事如何运转，不改变平台分类">
            <div className="genre-option-grid">
              {NARRATIVE_GENRES.map((genre) => <label key={genre} className="check-row"><input type="checkbox" checked={contract.secondaryGenres?.includes(genre) ?? false} disabled={!(contract.secondaryGenres?.includes(genre)) && (contract.secondaryGenres?.length ?? 0) >= 3} onChange={() => setContract((current) => { const selected = current.secondaryGenres ?? []; return { ...current, secondaryGenres: selected.includes(genre) ? selected.filter((item) => item !== genre) : [...selected, genre] }; })} />{genre}</label>)}
            </div>
          </Field>
          {GENRE_ELEMENT_GROUPS.map((group) => <Field key={group.label} label={group.label} hint="按需选择，规则编译时不会要求全部同时出现">
            <div className="genre-option-grid">
              {group.elements.map((element) => <label key={element} className="check-row"><input type="checkbox" checked={contract.genreElements?.includes(element) ?? false} disabled={!(contract.genreElements?.includes(element)) && (contract.genreElements?.length ?? 0) >= 8} onChange={() => setContract((current) => { const selected = current.genreElements ?? []; return { ...current, genreElements: selected.includes(element) ? selected.filter((item) => item !== element) : [...selected, element] }; })} />{element}</label>)}
            </div>
          </Field>)}
          <Field label="自定义创作方向" hint="优先于题材惯例，用来写混合逻辑、反套路方向和明确边界">
            <Textarea rows={3} value={contract.customGenreDirection ?? ""} onChange={(event) => set("customGenreDirection", event.target.value)} placeholder="例如：以基层医疗案件推动群像成长，不使用系统，不把恋爱作为主线" />
          </Field>
        </div>
        <div className="form-grid two">
          <Field label="故事前提">
            <Textarea
              rows={4}
              value={contract.premise}
              onChange={(event) => set("premise", event.target.value)}
              placeholder="用一句清晰因果描述主角、变化与核心问题"
            />
          </Field>
          <Field label="主角核心欲望">
            <Textarea
              rows={4}
              value={contract.protagonistDesire}
              onChange={(event) => set("protagonistDesire", event.target.value)}
              placeholder="主角真正想获得、守住或摆脱什么"
            />
          </Field>
          <Field label="读者承诺">
            <Textarea
              rows={4}
              value={contract.readerPromise}
              onChange={(event) => set("readerPromise", event.target.value)}
              placeholder="读者持续追读能稳定得到什么体验"
            />
          </Field>
          <Field label="核心爽感 / 情绪价值">
            <Textarea
              rows={4}
              value={contract.coreEmotion}
              onChange={(event) => set("coreEmotion", event.target.value)}
            />
          </Field>
        </div>
        <Field label="故事终局">
          <Textarea
            rows={5}
            value={contract.ending}
            onChange={(event) => set("ending", event.target.value)}
            placeholder="终局状态、主角代价与主题落点"
          />
        </Field>
        <div className="bible-subsection-heading">
          <div>
            <h2>叙事发动机</h2>
            <p>从开局到长篇扩张持续生效，规划台会直接读取这些约束。</p>
          </div>
        </div>
        <div className="form-grid two">
          <Field label="目标读者">
            <Textarea rows={3} value={contract.audience ?? ""} onChange={(event) => set("audience", event.target.value)} placeholder="谁会追读，以及他们最在意什么" />
          </Field>
          <Field label="商业钩子">
            <Textarea rows={3} value={contract.commercialHook ?? ""} onChange={(event) => set("commercialHook", event.target.value)} placeholder="一句话说明最容易被感知的独特卖点" />
          </Field>
          <Field label="开局机制">
            <Textarea rows={3} value={contract.openingMechanism ?? ""} onChange={(event) => set("openingMechanism", event.target.value)} placeholder="什么具体事件打破原有生活并迫使主角行动" />
          </Field>
          <Field label="成长载体">
            <Textarea rows={3} value={contract.growthCarrier ?? ""} onChange={(event) => set("growthCarrier", event.target.value)} placeholder="能力、关系、认知、资源或事业如何积累" />
          </Field>
          <Field label="核心回报">
            <Textarea rows={3} value={contract.primaryPayoff ?? ""} onChange={(event) => set("primaryPayoff", event.target.value)} placeholder="读者最主要看到什么状态改变" />
          </Field>
          <Field label="长篇发动机">
            <Textarea rows={3} value={contract.longFormEngine ?? ""} onChange={(event) => set("longFormEngine", event.target.value)} placeholder="至少三轮冲突、关系或世界范围如何变化" />
          </Field>
        </div>
        <div className="bible-subsection-heading">
          <div>
            <h2>人物与世界骨架</h2>
            <p>只记录会跨阶段约束故事的骨架信息，细节在状态账本持续演化。</p>
          </div>
        </div>
        <Field label="主角弧光">
          <Textarea rows={3} value={contract.protagonistArc ?? ""} onChange={(event) => set("protagonistArc", event.target.value)} placeholder="起点认知、关键转变、代价与终局状态" />
        </Field>
        <div className="form-grid two">
          {([
            ["keyRelationships", "关键关系", "每行一条：人物双方、初始张力与不可替代作用"],
            ["worldRules", "世界规则", "每行一条：能力、职业、社会或超自然规则及边界"],
            ["majorForces", "主要势力", "每行一条：势力目标、资源与冲突位置"],
            ["timelineAnchors", "时间锚点", "每行一条：故事前史或未来必须发生的节点"],
          ] as const).map(([key, label, placeholder]) => (
            <Field key={key} label={label} hint="每行一条">
              <Textarea rows={4} value={(contract[key] ?? []).join("\n")} onChange={(event) => set(key, event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} placeholder={placeholder} />
            </Field>
          ))}
        </div>
        <div className="bible-subsection-heading">
          <div>
            <h2>审美设定</h2>
            <p>仅约束当前作品；生成、语义质检和 AI 修改会共同读取这里。</p>
          </div>
          <Button
            variant="secondary"
            icon={optimizingAesthetic ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />}
            disabled={optimizingAesthetic}
            onClick={optimizeAesthetic}
          >
            {optimizingAesthetic ? "正在分析本书" : "AI 优化本书审美"}
          </Button>
        </div>
        {aestheticSuggestion && (
          <div className="aesthetic-suggestion" aria-live="polite">
            <div>
              <strong>本书审美诊断</strong>
              <Badge tone="warning">待采用</Badge>
            </div>
            <p>{aestheticSuggestion.diagnosis}</p>
            <ul>
              {aestheticSuggestion.rationale.map((item) => <li key={item}>{item}</li>)}
            </ul>
            <dl className="aesthetic-proposal-preview">
              <div><dt>叙事距离</dt><dd>{aestheticSuggestion.profile.narrativeDistance}</dd></div>
              <div><dt>情绪温度</dt><dd>{aestheticSuggestion.profile.emotionalTemperature}</dd></div>
              <div><dt>文字质地</dt><dd>{aestheticSuggestion.profile.proseTexture}</dd></div>
              <div><dt>对话风格</dt><dd>{aestheticSuggestion.profile.dialogueStyle}</dd></div>
              <div><dt>情绪表达</dt><dd>{aestheticSuggestion.profile.emotionalExpression}</dd></div>
              <div><dt>标志手法</dt><dd>{aestheticSuggestion.profile.signatureTechniques.join("；")}</dd></div>
              <div><dt>审美避用</dt><dd>{aestheticSuggestion.profile.avoidPatterns.join("；")}</dd></div>
            </dl>
            {contract.approved && (
              <p className="aesthetic-approval-note">
                当前契约已经审批。采用后仍需先提交并批准创作契约变更单，才能保存为新版本。
              </p>
            )}
            <div className="aesthetic-suggestion-actions">
              <Button variant="ghost" onClick={() => setAestheticSuggestion(null)}>
                放弃提案
              </Button>
              <Button
                variant="secondary"
                icon={<Check size={15} />}
                onClick={() => {
                  setContract((current) => ({
                    ...current,
                    aestheticProfile: normalizeAestheticProfile(aestheticSuggestion.profile),
                  }));
                  setAestheticSuggestion(null);
                  notify(
                    contract.approved
                      ? "提案已采用到表单；保存前需先批准创作契约变更单"
                      : "审美提案已采用到表单，请确认后保存",
                    contract.approved ? "error" : "success",
                  );
                }}
              >
                采用提案
              </Button>
            </div>
          </div>
        )}
        <div className="form-grid two">
          <Field label="叙事距离" hint="镜头与人物内心的常态距离">
            <Select
              value={contract.aestheticProfile!.narrativeDistance}
              onChange={(event) => setAesthetic(
                "narrativeDistance",
                event.target.value as AestheticProfile["narrativeDistance"],
              )}
            >
              <option value="贴身">贴身</option>
              <option value="适中">适中</option>
              <option value="远距">远距</option>
            </Select>
          </Field>
          <Field label="情绪温度" hint="本地质检会据此调整温度阈值">
            <Select
              value={contract.aestheticProfile!.emotionalTemperature}
              onChange={(event) => setAesthetic(
                "emotionalTemperature",
                event.target.value as AestheticProfile["emotionalTemperature"],
              )}
            >
              <option value="冷峻">冷峻</option>
              <option value="克制">克制</option>
              <option value="均衡">均衡</option>
              <option value="热烈">热烈</option>
            </Select>
          </Field>
          <Field label="文字质地">
            <Textarea
              rows={4}
              value={contract.aestheticProfile!.proseTexture}
              onChange={(event) => setAesthetic("proseTexture", event.target.value)}
              placeholder="如：短句利落，动作具体，少用抽象判断"
            />
          </Field>
          <Field label="对话风格">
            <Textarea
              rows={4}
              value={contract.aestheticProfile!.dialogueStyle}
              onChange={(event) => setAesthetic("dialogueStyle", event.target.value)}
              placeholder="如：言外有意，身份差异清楚，避免解释性对白"
            />
          </Field>
        </div>
        <Field label="情绪表达">
          <Textarea
            rows={4}
            value={contract.aestheticProfile!.emotionalExpression}
            onChange={(event) => setAesthetic("emotionalExpression", event.target.value)}
            placeholder="说明本书如何呈现情绪，以及主角、配角是否需要形成温差"
          />
        </Field>
        <div className="form-grid two">
          <Field label="标志性手法" hint="每行一条">
            <Textarea
              rows={6}
              value={contract.aestheticProfile!.signatureTechniques.join("\n")}
              onChange={(event) => setAesthetic("signatureTechniques", splitLines(event.target.value))}
            />
          </Field>
          <Field label="审美避用" hint="每行一条；用于生成与语义质检，不作为硬性禁写词匹配">
            <Textarea
              rows={6}
              value={contract.aestheticProfile!.avoidPatterns.join("\n")}
              onChange={(event) => setAesthetic("avoidPatterns", splitLines(event.target.value))}
            />
          </Field>
        </div>
        <div className="form-grid two">
          <Field label="不可破坏规则" hint="每行一条">
            <Textarea
              rows={7}
              value={contract.immutableRules.join("\n")}
              onChange={(event) =>
                set("immutableRules", splitLines(event.target.value))
              }
            />
          </Field>
          <Field label="禁写清单" hint="每行一条；命中正文将触发硬性门禁">
            <Textarea
              rows={7}
              value={contract.prohibitedPatterns.join("\n")}
              onChange={(event) =>
                set("prohibitedPatterns", splitLines(event.target.value))
              }
            />
          </Field>
        </div>
        <div className="form-grid two">
          <Field label="重大状态追加词" hint="每行一条；命中章纲时强制逐章审批">
            <Textarea
              rows={5}
              value={contract.majorStateChanges!.include.join("\n")}
              onChange={(event) => setContract((current) => ({
                ...current,
                majorStateChanges: { ...current.majorStateChanges!, include: splitLines(event.target.value) },
              }))}
            />
          </Field>
          <Field label="重大状态忽略词" hint="每行一条；用于移除主题材默认词">
            <Textarea
              rows={5}
              value={contract.majorStateChanges!.exclude.join("\n")}
              onChange={(event) => setContract((current) => ({
                ...current,
                majorStateChanges: { ...current.majorStateChanges!, exclude: splitLines(event.target.value) },
              }))}
            />
          </Field>
        </div>
      </section>
    </div>
  );
}
