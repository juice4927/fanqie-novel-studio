import { useState } from "react";
import { Check, LoaderCircle, Sparkles } from "lucide-react";
import type { AppApi, BookConceptCandidate, BookConceptInput, Genre, ProjectSummary } from "../shared/types";
import { GENRES } from "../shared/types";
import { GENRE_PLUGINS } from "../shared/genre-plugins";
import { Button, Field, Input, Modal, Segmented, Select, Textarea } from "./UI";

type CreateMode = "AI 从零开书" | "手动创建";

export function NewProjectModal({ api, onClose, onCreated, notify }: {
  api: AppApi;
  onClose: () => void;
  onCreated: (project: ProjectSummary) => Promise<void>;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [mode, setMode] = useState<CreateMode>("AI 从零开书");
  const [input, setInput] = useState<BookConceptInput>({ genre: GENRES[0], targetWords: 1000000, updateCadence: "每日 2 章", seed: "" });
  const [manualTitle, setManualTitle] = useState("");
  const [concepts, setConcepts] = useState<BookConceptCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = concepts.find((item) => item.id === selectedId) ?? null;
  const plugin = GENRE_PLUGINS[input.genre];

  const generate = async () => {
    setBusy(true);
    try {
      const next = await api.generateBookConcepts(input);
      setConcepts(next);
      setSelectedId(next[0]?.id ?? null);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    setBusy(true);
    try {
      const project = mode === "AI 从零开书" && selected
        ? await api.createProjectFromConcept(input, selected)
        : await api.createProject({ title: manualTitle.trim(), genre: input.genre, targetWords: input.targetWords, updateCadence: input.updateCadence });
      await onCreated(project);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
      setBusy(false);
    }
  };

  return <Modal title="从 0 开始创建一本书" onClose={() => !busy && onClose()} width={920}>
    <div className="book-wizard">
      <Segmented options={["AI 从零开书", "手动创建"] as const} value={mode} onChange={(value) => { setMode(value); setConcepts([]); setSelectedId(null); }} />
      <div className="form-grid three">
        <Field label="番茄主题材"><Select value={input.genre} onChange={(event) => { setInput({ ...input, genre: event.target.value as Genre }); setConcepts([]); }} disabled={busy}>{GENRES.map((genre) => <option key={genre}>{genre}</option>)}</Select></Field>
        <Field label="目标字数"><Input type="number" min={100000} step={100000} value={input.targetWords} onChange={(event) => setInput({ ...input, targetWords: Number(event.target.value) })} disabled={busy} /></Field>
        <Field label="更新节奏"><Input value={input.updateCadence} onChange={(event) => setInput({ ...input, updateCadence: event.target.value })} disabled={busy} /></Field>
      </div>
      {mode === "手动创建" ? <Field label="书名"><Input autoFocus value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} placeholder="输入暂定书名" disabled={busy} /></Field> : <>
        <Field label="你已有的灵感（可不填）" hint={`系统会遵守 ${input.genre} 的读者承诺与禁忌；可只写一句人物、情境或想要的情绪。`}><Textarea value={input.seed} onChange={(event) => setInput({ ...input, seed: event.target.value })} placeholder="例如：女主重回八零年代，不想再替妹妹牺牲；留空则完全由 AI 提案。" disabled={busy} /></Field>
        <div className="wizard-genre-note"><strong>本题材默认方向</strong><span>{plugin.coreFantasies.join(" · ")}</span></div>
        {!concepts.length ? <div className="wizard-generate"><Sparkles size={24} /><div><strong>AI 会先给出 3 套完整开书方案</strong><span>每套包含书名、故事前提、核心卖点、目标读者、长篇发动机和未审批创作契约。</span></div><Button icon={busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} disabled={busy} onClick={generate}>{busy ? "正在构思…" : "生成三套方案"}</Button></div> : <div className="book-concept-grid">{concepts.map((concept) => <button type="button" key={concept.id} className={selectedId === concept.id ? "selected" : ""} onClick={() => setSelectedId(concept.id)}><header><span>{concept.genreSubtype}</span>{selectedId === concept.id && <Check size={17} />}</header><h3>{concept.title}</h3><p>{concept.premise}</p><dl><dt>商业钩子</dt><dd>{concept.commercialHook}</dd><dt>长篇发动机</dt><dd>{concept.longFormEngine}</dd><dt>核心情绪</dt><dd>{concept.coreEmotion}</dd></dl></button>)}</div>}
      </>}
      <div className="modal-actions"><Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>{mode === "AI 从零开书" && concepts.length > 0 && <Button variant="secondary" disabled={busy} icon={<Sparkles size={16} />} onClick={generate}>换一批</Button>}<Button disabled={busy || (mode === "手动创建" ? !manualTitle.trim() : !selected)} onClick={create}>{busy ? "正在创建…" : mode === "AI 从零开书" ? "采用此方案并创建" : "创建空白作品"}</Button></div>
    </div>
  </Modal>;
}
