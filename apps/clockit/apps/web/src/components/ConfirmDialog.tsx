import { useEffect } from "react";
import { useI18n } from "../i18n";

/**
 * B10: small reusable styled confirmation dialog to replace window.confirm().
 *
 * Usage:
 *   const [confirming, setConfirming] = useState(false);
 *   {confirming && (
 *     <ConfirmDialog
 *       title="Delete shared report"
 *       message="Delete this shared report? This cannot be undone."
 *       confirmLabel="Delete"
 *       danger
 *       onConfirm={() => { doDelete(); setConfirming(false); }}
 *       onCancel={() => setConfirming(false)}
 *     />
 *   )}
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Style the confirm button red for destructive actions */
  danger?: boolean;
  /** Disable buttons while the action is in flight */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();

  // Escape closes the dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onCancel}></div>

      {/* Dialog */}
      <div className="relative bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-sm p-6">
        {title && (
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-2">
            {title}
          </h3>
        )}
        <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"
          >
            {cancelLabel ?? t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            autoFocus
            className={`px-4 py-2 text-sm rounded text-white disabled:opacity-50 ${
              danger ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {confirmLabel ?? t("common.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
