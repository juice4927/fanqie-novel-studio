import { Field, Textarea } from "../components/UI";

export function DirectorNotesEditor({
  notes,
  note,
  onNoteChange,
  onRemove,
}: {
  notes: readonly string[];
  note: string;
  onNoteChange: (value: string) => void;
  onRemove: (note: string) => void;
}) {
  return (
    <>
      <details>
        <summary>导演备注（约束后续 AI 生成）</summary>
        {notes.length === 0 ? (
          <p className="muted-line">还没有备注；打回时填原因会自动沉淀到这里。</p>
        ) : (
          <ul style={{ paddingLeft: 18, marginTop: 6 }}>
            {notes.map((entry) => (
              <li key={entry} style={{ marginBottom: 4 }}>
                <span style={{ marginRight: 8 }}>{entry}</span>
                <button
                  type="button"
                  aria-label="删除导演备注"
                  onClick={() => onRemove(entry)}
                  style={{ color: "var(--muted)", cursor: "pointer" }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
      </details>
      <Field label="打回原因（可选，将沉淀为导演备注）">
        <Textarea
          rows={2}
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="例如：开头节奏太慢、别用“旋即”"
        />
      </Field>
    </>
  );
}
