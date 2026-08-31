import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useStore } from "../store";

export const Toasts = () => {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>
          {t.kind === "error" ? (
            <AlertCircle size={15} />
          ) : t.kind === "success" ? (
            <CheckCircle2 size={15} />
          ) : (
            <Info size={15} />
          )}
          {t.message}
        </button>
      ))}
    </div>
  );
};
