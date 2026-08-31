import { ClipboardPaste, Clock3, FileInput, Link2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Segmented } from "../components/UI";
import { FANQIE_CATEGORY_PROFILES } from "../shared/fanqie-taxonomy";
import type {
  AiSettings,
  AppApi,
  Genre,
  ImportPreview,
  InsightPack,
  RankingAnalytics,
  RankingCaptureSchedule,
  RankingEntry,
  RankingSnapshot,
  ResearchAnalysisRecord,
  ResearchBook,
} from "../shared/types";
import { GENRES } from "../shared/types";
import { ResearchBooksView } from "./ResearchBooksView";
import { ResearchInsightsView } from "./ResearchInsightsView";
import { ResearchKnowledgeView } from "./ResearchKnowledgeView";
import styles from "./ResearchPage.module.css";
import {
  FANQIE_CATEGORIES,
  type FanqieGender,
  type FanqieRankKind,
  ResearchRankingModals,
} from "./ResearchRankingModals";
import { ResearchRankingView } from "./ResearchRankingView";
import { ResearchSampleModals } from "./ResearchSampleModals";

type ResearchTab = "榜单快照" | "样本拆书" | "脱敏洞察" | "商业知识";

export function ResearchPage({
  api,
  notify,
}: {
  api: AppApi;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const [tab, setTab] = useState<ResearchTab>("榜单快照");
  const [rankings, setRankings] = useState<RankingSnapshot[]>([]);
  const [analytics, setAnalytics] = useState<RankingAnalytics | null>(null);
  const [books, setBooks] = useState<ResearchBook[]>([]);
  const [insights, setInsights] = useState<InsightPack[]>([]);
  const [rankingModal, setRankingModal] = useState(false);
  const [rankingCsv, setRankingCsv] = useState("");
  const [fanqieGender, setFanqieGender] = useState<FanqieGender>("男频");
  const [fanqieRankKind, setFanqieRankKind] = useState<FanqieRankKind>("阅读榜");
  const [fanqieCategoryId, setFanqieCategoryId] = useState("262");
  const [rankingName, setRankingName] = useState("番茄男频阅读榜·都市脑洞");
  const [publicModal, setPublicModal] = useState(false);
  const [scheduleModal, setScheduleModal] = useState(false);
  const [rankingSchedules, setRankingSchedules] = useState<RankingCaptureSchedule[]>([]);
  const [scheduleFrequency, setScheduleFrequency] = useState<RankingCaptureSchedule["frequency"]>("每日");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pasteModal, setPasteModal] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [genre, setGenre] = useState<Genre>(GENRES[0]);
  const [rights, setRights] = useState(false);
  const [cloud, setCloud] = useState(false);
  const [busyBook, setBusyBook] = useState<string | null>(null);
  const [publicSampleEntry, setPublicSampleEntry] = useState<RankingEntry | null>(null);
  const [publicSampleGenre, setPublicSampleGenre] = useState<Genre>("都市脑洞");
  const [publicSampleCloud, setPublicSampleCloud] = useState(false);
  const [readingPublicSample, setReadingPublicSample] = useState(false);
  const [analysisBook, setAnalysisBook] = useState<ResearchBook | null>(null);
  const [analyses, setAnalyses] = useState<ResearchAnalysisRecord[]>([]);
  const [pendingDeconstruct, setPendingDeconstruct] = useState<ResearchBook | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings | null>(null);
  const fanqieCategories = FANQIE_CATEGORIES[fanqieGender];
  const fanqieCategory = fanqieCategories.find(([id]) => id === fanqieCategoryId) ?? fanqieCategories[0];
  const publicUrl = `https://fanqienovel.com/rank/${fanqieGender === "男频" ? 1 : 0}_${fanqieRankKind === "阅读榜" ? 2 : 1}_${fanqieCategory[0]}`;

  const selectFanqieRanking = (gender: FanqieGender, kind: FanqieRankKind, categoryId: string) => {
    const categories = FANQIE_CATEGORIES[gender];
    const category = categories.find(([id]) => id === categoryId) ?? categories[0];
    setFanqieGender(gender);
    setFanqieRankKind(kind);
    setFanqieCategoryId(category[0]);
    setRankingName(`番茄${gender}${kind}·${category[1]}`);
  };

  const reload = useCallback(async () => {
    const [rankingData, rankingAnalytics, bookData, insightData, schedules] = await Promise.all([
      api.listRankings(),
      api.getRankingAnalytics(),
      api.listResearchBooks(),
      api.listInsights(),
      api.listRankingSchedules(),
    ]);
    setRankings(rankingData);
    setAnalytics(rankingAnalytics);
    setBooks(bookData);
    setInsights(insightData);
    setRankingSchedules(schedules);
  }, [api]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const chooseFile = async () => {
    try {
      const result = await api.previewResearchFile();
      if (result) setPreview(result);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const commitImport = async () => {
    if (!preview) return;
    try {
      await api.importResearchBook(preview, genre, rights, cloud);
      setPreview(null);
      setRights(false);
      setCloud(false);
      await reload();
      notify("样本已导入研究隔离区");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const deconstruct = async (book: ResearchBook) => {
    setBusyBook(book.id);
    try {
      await api.deconstructResearchBook(book.id);
      await reload();
      setTab("脱敏洞察");
      notify("拆书完成，已生成脱敏洞察包");
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusyBook(null);
    }
  };
  const requestDeconstruct = async (book: ResearchBook) => {
    if (!book.cloudConsent) {
      await deconstruct(book);
      return;
    }
    setAiSettings(await api.getAiSettings());
    setPendingDeconstruct(book);
  };

  const openPublicSample = (snapshot: RankingSnapshot, entry: RankingEntry) => {
    const profile = FANQIE_CATEGORY_PROFILES.find(
      (item) => snapshot.listName.includes(item.channel) && snapshot.listName.includes(item.name),
    );
    setPublicSampleGenre(profile?.genre ?? "都市脑洞");
    setPublicSampleCloud(false);
    setPublicSampleEntry(entry);
  };

  const importAndDeconstructPublicSample = async () => {
    if (!publicSampleEntry?.sourceUrl) return;
    setReadingPublicSample(true);
    try {
      const book = await api.importPublicResearchSample(
        publicSampleEntry.sourceUrl,
        publicSampleGenre,
        publicSampleCloud,
      );
      setPublicSampleEntry(null);
      await reload();
      notify(`已读取《${book.title}》公开前 ${book.chapterCount} 章`);
      await requestDeconstruct(book);
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setReadingPublicSample(false);
    }
  };

  const importRankingSnapshot = async () => {
    try {
      await api.importRankingCsv(rankingCsv, rankingName);
      setRankingModal(false);
      setRankingCsv("");
      await reload();
      notify("榜单快照已保存");
    } catch (error) {
      notify(String(error), "error");
    }
  };

  const capturePublicRanking = async () => {
    try {
      const snapshot = await api.capturePublicRanking(publicUrl, rankingName);
      setPublicModal(false);
      await reload();
      notify(
        snapshot.status !== "失败"
          ? `已采集 ${snapshot.entries.length} 条公开书目`
          : `采集失败已记录：${snapshot.error}`,
        snapshot.status !== "失败" ? "success" : "error",
      );
    } catch (error) {
      notify(String(error), "error");
    }
  };

  const addRankingSchedule = async () => {
    try {
      await api.saveRankingSchedule({
        url: publicUrl,
        listName: rankingName,
        frequency: scheduleFrequency,
        enabled: true,
      });
      await reload();
      notify("定时采榜任务已保存");
    } catch (error) {
      notify(String(error), "error");
    }
  };

  const toggleRankingSchedule = async (schedule: RankingCaptureSchedule, enabled: boolean) => {
    try {
      await api.saveRankingSchedule({
        id: schedule.id,
        url: schedule.url,
        listName: schedule.listName,
        frequency: schedule.frequency,
        enabled,
      });
      await reload();
    } catch (error) {
      notify(String(error), "error");
    }
  };

  const runRankingSchedule = async (schedule: RankingCaptureSchedule) => {
    try {
      await api.runRankingSchedule(schedule.id);
      await reload();
      notify("榜单任务已运行");
    } catch (error) {
      notify(String(error), "error");
    }
  };

  const deleteRankingSchedule = async (schedule: RankingCaptureSchedule) => {
    try {
      await api.deleteRankingSchedule(schedule.id);
      await reload();
    } catch (error) {
      notify(String(error), "error");
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">市场研究区</p>
          <h1>榜单、样本与洞察</h1>
          <p>原始文本停留在研究库，创作区只接收脱敏后的结构洞察。</p>
        </div>
      </header>
      <div className="toolbar-row">
        <Segmented options={["榜单快照", "样本拆书", "脱敏洞察", "商业知识"] as const} value={tab} onChange={setTab} />
        <div className={styles.toolbarActions}>
          {tab === "榜单快照" && (
            <>
              <Button variant="secondary" icon={<Clock3 size={17} />} onClick={() => setScheduleModal(true)}>
                定时采榜
              </Button>
              <Button variant="secondary" icon={<Link2 size={17} />} onClick={() => setPublicModal(true)}>
                采集公开页
              </Button>
              <Button icon={<Upload size={17} />} onClick={() => setRankingModal(true)}>
                导入榜单 CSV
              </Button>
            </>
          )}
          {tab === "样本拆书" && (
            <>
              <Button variant="secondary" icon={<ClipboardPaste size={17} />} onClick={() => setPasteModal(true)}>
                粘贴文本
              </Button>
              <Button icon={<FileInput size={17} />} onClick={chooseFile}>
                导入样本
              </Button>
            </>
          )}
        </div>
      </div>

      {tab === "榜单快照" && (
        <ResearchRankingView
          analytics={analytics}
          rankings={rankings}
          onOpenPublicSample={openPublicSample}
          onOpenPublicRanking={() => setPublicModal(true)}
        />
      )}
      {tab === "样本拆书" && (
        <ResearchBooksView
          books={books}
          busyBookId={busyBook}
          onChooseFile={chooseFile}
          onOpenAnalysis={async (book) => {
            setAnalyses(await api.listResearchAnalyses(book.id));
            setAnalysisBook(book);
          }}
          onRequestDeconstruct={requestDeconstruct}
        />
      )}
      {tab === "脱敏洞察" && <ResearchInsightsView insights={insights} />}
      {tab === "商业知识" && <ResearchKnowledgeView />}

      <ResearchRankingModals
        importModal={{
          open: rankingModal,
          rankingName,
          rankingCsv,
          onRankingNameChange: setRankingName,
          onRankingCsvChange: setRankingCsv,
          onClose: () => setRankingModal(false),
          onSave: () => void importRankingSnapshot(),
        }}
        publicModal={{
          open: publicModal,
          gender: fanqieGender,
          rankKind: fanqieRankKind,
          categoryId: fanqieCategoryId,
          rankingName,
          publicUrl,
          onSelectRanking: selectFanqieRanking,
          onRankingNameChange: setRankingName,
          onClose: () => setPublicModal(false),
          onCapture: () => void capturePublicRanking(),
        }}
        scheduleModal={{
          open: scheduleModal,
          rankingName,
          publicUrl,
          frequency: scheduleFrequency,
          schedules: rankingSchedules,
          onFrequencyChange: setScheduleFrequency,
          onClose: () => setScheduleModal(false),
          onAdd: () => void addRankingSchedule(),
          onToggle: (schedule, enabled) => void toggleRankingSchedule(schedule, enabled),
          onRun: (schedule) => void runRankingSchedule(schedule),
          onDelete: (schedule) => void deleteRankingSchedule(schedule),
        }}
      />
      <ResearchSampleModals
        publicSampleModal={{
          entry: publicSampleEntry,
          cloudConsent: publicSampleCloud,
          reading: readingPublicSample,
          onCloudConsentChange: setPublicSampleCloud,
          onClose: () => setPublicSampleEntry(null),
          onImportAndDeconstruct: () => void importAndDeconstructPublicSample(),
        }}
        pasteModal={{
          open: pasteModal,
          text: pastedText,
          onTextChange: setPastedText,
          onClose: () => setPasteModal(false),
          onPreview: (nextPreview) => {
            setPreview(nextPreview);
            setPasteModal(false);
          },
        }}
        importPreviewModal={{
          preview,
          genre,
          rightsConfirmed: rights,
          cloudConsent: cloud,
          onGenreChange: setGenre,
          onRightsConfirmedChange: setRights,
          onCloudConsentChange: setCloud,
          onClose: () => setPreview(null),
          onCommit: () => void commitImport(),
        }}
        analysisModal={{
          book: analysisBook,
          analyses,
          onClose: () => setAnalysisBook(null),
        }}
        cloudDeconstructModal={{
          book: pendingDeconstruct,
          aiSettings,
          onClose: () => setPendingDeconstruct(null),
          onConfirm: () => {
            if (!pendingDeconstruct) return;
            const book = pendingDeconstruct;
            setPendingDeconstruct(null);
            void deconstruct(book);
          },
        }}
      />
    </div>
  );
}
