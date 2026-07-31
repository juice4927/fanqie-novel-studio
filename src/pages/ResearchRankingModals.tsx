import { Play, Trash2 } from "lucide-react";
import type { RankingCaptureSchedule } from "../shared/types";
import {
  Badge,
  Button,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
} from "../components/UI";
import { formatDate } from "../lib/format";
import styles from "./ResearchPage.module.css";

export const FANQIE_CATEGORIES = {
  男频: [
    ["1141", "西方奇幻"], ["1140", "东方仙侠"], ["8", "科幻末世"],
    ["261", "都市日常"], ["124", "都市修真"], ["1014", "都市高武"],
    ["273", "历史古代"], ["27", "战神赘婿"], ["263", "都市种田"],
    ["258", "传统玄幻"], ["272", "历史脑洞"], ["539", "悬疑脑洞"],
    ["262", "都市脑洞"], ["257", "玄幻脑洞"], ["751", "悬疑灵异"],
    ["504", "抗战谍战"], ["746", "游戏体育"], ["718", "动漫衍生"],
    ["1016", "男频衍生"],
  ],
  女频: [
    ["1139", "古风世情"], ["8", "科幻末世"], ["746", "游戏体育"],
    ["1015", "女频衍生"], ["248", "玄幻言情"], ["23", "种田"],
    ["79", "年代"], ["267", "现言脑洞"], ["246", "宫斗宅斗"],
    ["539", "悬疑脑洞"], ["253", "古言脑洞"], ["24", "快穿"],
    ["749", "青春甜宠"], ["745", "星光璀璨"], ["747", "女频悬疑"],
    ["750", "职场婚恋"], ["748", "豪门总裁"], ["1017", "民国言情"],
  ],
} as const;

export type FanqieGender = keyof typeof FANQIE_CATEGORIES;
export type FanqieRankKind = "阅读榜" | "新书榜";

interface RankingImportModalProps {
  open: boolean;
  rankingName: string;
  rankingCsv: string;
  onRankingNameChange: (value: string) => void;
  onRankingCsvChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}

export function RankingImportModal({
  open,
  rankingName,
  rankingCsv,
  onRankingNameChange,
  onRankingCsvChange,
  onClose,
  onSave,
}: RankingImportModalProps) {
  if (!open) return null;
  return (
    <Modal title="导入榜单 CSV" onClose={onClose}>
      <div className="form-stack">
        <Field label="榜单名称">
          <Input
            value={rankingName}
            onChange={(event) => onRankingNameChange(event.target.value)}
          />
        </Field>
        <Field
          label="CSV 内容"
          hint="支持字段：排名、书名、作者、题材、字数、状态、标签、链接"
        >
          <Textarea
            rows={12}
            value={rankingCsv}
            onChange={(event) => onRankingCsvChange(event.target.value)}
            placeholder="排名,书名,作者,题材,字数,状态\n1,示例书名,作者,都市脑洞,100万,连载"
          />
        </Field>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!rankingCsv.trim()} onClick={onSave}>
            保存快照
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface PublicRankingModalProps {
  open: boolean;
  gender: FanqieGender;
  rankKind: FanqieRankKind;
  categoryId: string;
  rankingName: string;
  publicUrl: string;
  onSelectRanking: (
    gender: FanqieGender,
    kind: FanqieRankKind,
    categoryId: string,
  ) => void;
  onRankingNameChange: (value: string) => void;
  onClose: () => void;
  onCapture: () => void;
}

function PublicRankingModal({
  open,
  gender,
  rankKind,
  categoryId,
  rankingName,
  publicUrl,
  onSelectRanking,
  onRankingNameChange,
  onClose,
  onCapture,
}: PublicRankingModalProps) {
  if (!open) return null;
  const categories = FANQIE_CATEGORIES[gender];
  return (
    <Modal title="采集番茄公开榜单" onClose={onClose}>
      <div className="form-stack">
        <div className={`form-grid ${styles.fanqieRankingFilters}`}>
          <Field label="频道">
            <Select
              value={gender}
              onChange={(event) =>
                onSelectRanking(
                  event.target.value as FanqieGender,
                  rankKind,
                  "",
                )
              }
            >
              <option>男频</option>
              <option>女频</option>
            </Select>
          </Field>
          <Field label="榜型">
            <Select
              value={rankKind}
              onChange={(event) =>
                onSelectRanking(
                  gender,
                  event.target.value as FanqieRankKind,
                  categoryId,
                )
              }
            >
              <option>阅读榜</option>
              <option>新书榜</option>
            </Select>
          </Field>
          <Field label="题材">
            <Select
              value={categoryId}
              onChange={(event) =>
                onSelectRanking(gender, rankKind, event.target.value)
              }
            >
              {categories.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="榜单名称">
          <Input
            value={rankingName}
            onChange={(event) => onRankingNameChange(event.target.value)}
          />
        </Field>
        <p className="inline-warning">
          每次最多读取前 20 本的公开元数据与官方链接。系统不下载正文，不携带 Cookie，也不绕过登录、验证或访问限制。
        </p>
        <div className="modal-actions">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button disabled={!/^https?:\/\//.test(publicUrl)} onClick={onCapture}>
            开始采集
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface RankingScheduleModalProps {
  open: boolean;
  rankingName: string;
  publicUrl: string;
  frequency: RankingCaptureSchedule["frequency"];
  schedules: RankingCaptureSchedule[];
  onFrequencyChange: (value: RankingCaptureSchedule["frequency"]) => void;
  onClose: () => void;
  onAdd: () => void;
  onToggle: (schedule: RankingCaptureSchedule, enabled: boolean) => void;
  onRun: (schedule: RankingCaptureSchedule) => void;
  onDelete: (schedule: RankingCaptureSchedule) => void;
}

function RankingScheduleModal({
  open,
  rankingName,
  publicUrl,
  frequency,
  schedules,
  onFrequencyChange,
  onClose,
  onAdd,
  onToggle,
  onRun,
  onDelete,
}: RankingScheduleModalProps) {
  if (!open) return null;
  return (
    <Modal title="定时采集番茄榜单" onClose={onClose} width={720}>
      <div className="form-stack">
        <div className={styles.scheduleCreateRow}>
          <span>
            <strong>{rankingName}</strong>
            <small>{publicUrl}</small>
          </span>
          <Select
            value={frequency}
            onChange={(event) =>
              onFrequencyChange(
                event.target.value as RankingCaptureSchedule["frequency"],
              )
            }
          >
            <option>每日</option>
            <option>每周</option>
          </Select>
          <Button onClick={onAdd}>添加任务</Button>
        </div>
        <p className="inline-warning">
          仅在桌面应用运行时检查任务；失败会记录并顺延到下一周期，不会绕过验证或访问限制。
        </p>
        <div className={styles.rankingScheduleList}>
          {schedules.length ? (
            schedules.map((schedule) => (
              <article key={schedule.id}>
                <div>
                  <strong>{schedule.listName}</strong>
                  <small>
                    {schedule.frequency} · 下次 {formatDate(schedule.nextRunAt, true)}
                  </small>
                  {schedule.lastError && (
                    <small className={styles.errorText}>{schedule.lastError}</small>
                  )}
                </div>
                <Badge
                  tone={
                    schedule.lastStatus === "成功"
                      ? "success"
                      : schedule.lastStatus === "失败"
                        ? "danger"
                        : "neutral"
                  }
                >
                  {schedule.lastStatus}
                </Badge>
                <label
                  className={styles.scheduleToggle}
                  title={schedule.enabled ? "暂停任务" : "启用任务"}
                >
                  <input
                    type="checkbox"
                    checked={schedule.enabled}
                    onChange={(event) => onToggle(schedule, event.target.checked)}
                  />
                  <span>{schedule.enabled ? "运行中" : "已暂停"}</span>
                </label>
                <button
                  className="icon-button"
                  title="立即运行"
                  aria-label="立即运行"
                  onClick={() => onRun(schedule)}
                >
                  <Play size={15} />
                </button>
                <button
                  className="icon-button"
                  title="删除任务"
                  aria-label="删除任务"
                  onClick={() => onDelete(schedule)}
                >
                  <Trash2 size={15} />
                </button>
              </article>
            ))
          ) : (
            <p className="muted-line">
              还没有定时任务。上方会按当前频道、榜型和题材创建任务。
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

export interface ResearchRankingModalsProps {
  importModal: RankingImportModalProps;
  publicModal: PublicRankingModalProps;
  scheduleModal: RankingScheduleModalProps;
}

export function ResearchRankingModals({
  importModal,
  publicModal,
  scheduleModal,
}: ResearchRankingModalsProps) {
  return (
    <>
      <RankingImportModal {...importModal} />
      <PublicRankingModal {...publicModal} />
      <RankingScheduleModal {...scheduleModal} />
    </>
  );
}
