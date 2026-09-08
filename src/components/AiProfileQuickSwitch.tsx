import { Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { describeError } from "../lib/error-message";
import type { AiProfileView } from "../shared/ai/types";
import type { AppApi } from "../shared/types";
import { Select } from "./UI";

/** 侧栏快速切换默认来源：切换只影响之后启动的任务，不影响在途任务。 */
export function AiProfileQuickSwitch({
  api,
  notify,
}: {
  api: AppApi;
  notify: (message: string, tone?: "success" | "error") => void;
}) {
  const supported = typeof api.listAiProfiles === "function";
  const [profiles, setProfiles] = useState<AiProfileView[]>([]);
  const [defaultId, setDefaultId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const [next, nextDefault] = await Promise.all([api.listAiProfiles(), api.getDefaultAiProfileId()]);
    setProfiles(next.filter((profile) => profile.enabled));
    setDefaultId(nextDefault);
  }, [api]);

  useEffect(() => {
    if (!supported) return;
    void reload().catch(() => {});
  }, [reload, supported]);

  if (!supported || profiles.length === 0) return null;

  return (
    <div className="quick-switch">
      <Zap size={14} />
      <Select
        aria-label="切换模型来源"
        value={defaultId ?? ""}
        disabled={busy}
        onChange={(event) => {
          const id = event.target.value;
          if (!id || id === defaultId) return;
          setBusy(true);
          void api
            .setDefaultAiProfile(id)
            .then(async () => {
              await reload();
              notify(`已切换到「${profiles.find((profile) => profile.id === id)?.name ?? id}」`);
            })
            .catch((error) => notify(describeError(error), "error"))
            .finally(() => setBusy(false));
        }}
      >
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {profile.defaultModel || "未设模型"}
          </option>
        ))}
      </Select>
    </div>
  );
}
