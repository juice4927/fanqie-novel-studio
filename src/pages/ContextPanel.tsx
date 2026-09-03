import { AlertTriangle, Trash2 } from "lucide-react";
import { Badge, IconButton } from "../components/UI";
import { CONTEXT_SECTION_LABELS } from "../shared/context-diagnostics";
import { TOKEN_ESTIMATE_WARNING } from "../shared/token-estimator";
import type { ContextPackage } from "../shared/types";

export function ContextPanel({ context, onClose }: { context: ContextPackage; onClose: () => void }) {
  return (
    <aside className="context-panel">
      <div className="context-head">
        <span>
          <strong>上下文包</strong>
          <small>约 {context.estimatedTokens} tokens</small>
          <small>{TOKEN_ESTIMATE_WARNING}</small>
        </span>
        <IconButton label="关闭上下文" onClick={() => onClose()}>
          <Trash2 size={16} />
        </IconButton>
      </div>
      {context.diagnostics && (
        <div className="context-diagnostics">
          {context.diagnostics.warnings.length > 0 && (
            <div className="context-warnings" role="alert">
              <AlertTriangle size={16} />
              <span>{context.diagnostics.warnings.join("；")}</span>
            </div>
          )}
          <div className="context-diagnostic-list">
            {context.diagnostics.sections.map((section) => (
              <div key={section.key} className={`context-diagnostic context-${section.status}`}>
                <span>
                  <strong>{section.label}</strong>
                  <small>{section.source}</small>
                </span>
                <span>
                  <Badge tone={section.status === "缺失" ? "warning" : "neutral"}>{section.status}</Badge>
                  <small>
                    {section.includedItems}/{section.totalItems} 项 · {section.characters} 字
                  </small>
                </span>
                <p>{section.reason}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      {Object.entries(context)
        .filter(([key]) => key !== "estimatedTokens" && key !== "diagnostics")
        .map(([key, value]) => (
          <details
            key={key}
            open={
              key === "contract" ||
              key === "chapterIntent" ||
              key === "expectationLedger" ||
              key === "forbiddenKnowledge"
            }
          >
            <summary>{CONTEXT_SECTION_LABELS[key as keyof typeof CONTEXT_SECTION_LABELS]}</summary>
            <pre>{value || "无"}</pre>
          </details>
        ))}
    </aside>
  );
}
