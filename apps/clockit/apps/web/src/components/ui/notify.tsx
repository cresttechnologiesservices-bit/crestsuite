import { useEffect, useRef, useState } from "react";

/**
 * App-wide toasts and modal confirm/prompt dialogs replacing the browser
 * alert() / confirm() / prompt() primitives.
 *
 *   toast("Saved", "success");
 *   if (await confirmDialog({ message: "Delete this entry?", danger: true })) …
 *   const name = await promptDialog({ title: "New project", label: "Name" });
 *
 * <UiNotifyRoot/> must be mounted once (App.tsx) to render them.
 */

type ToastKind = "info" | "success" | "error";
interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title?: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
}

interface DialogRequest {
  id: number;
  kind: "confirm" | "prompt";
  confirm?: ConfirmOptions;
  prompt?: PromptOptions;
  resolve: (value: any) => void;
}

type Listener = () => void;

let nextId = 1;
let toasts: ToastItem[] = [];
let dialogs: DialogRequest[] = [];
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

export function toast(message: string, kind: ToastKind = "info") {
  const item = { id: nextId++, message, kind };
  toasts = [...toasts, item];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emit();
  }, 4500);
}

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { id: nextId++, kind: "confirm", confirm: options, resolve }];
    emit();
  });
}

export function promptDialog(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    dialogs = [...dialogs, { id: nextId++, kind: "prompt", prompt: options, resolve }];
    emit();
  });
}

function settle(dialog: DialogRequest, value: any) {
  dialogs = dialogs.filter((d) => d.id !== dialog.id);
  emit();
  dialog.resolve(value);
}

export function UiNotifyRoot() {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);

  const dialog = dialogs[0];

  return (
    <>
      {/* Toasts (top-right) */}
      <div className="fixed top-4 right-4 z-[100] space-y-2 w-80 pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`pointer-events-auto px-4 py-3 rounded-lg shadow-lg text-sm text-white flex items-start gap-2 ${
              t.kind === "error" ? "bg-red-600" : t.kind === "success" ? "bg-emerald-600" : "bg-slate-800"
            }`}
          >
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => {
                toasts = toasts.filter((x) => x.id !== t.id);
                emit();
              }}
              className="opacity-70 hover:opacity-100 font-bold leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {/* Confirm / prompt dialogs (one at a time) */}
      {dialog?.kind === "confirm" && dialog.confirm && (
        <ConfirmBox
          key={dialog.id}
          options={dialog.confirm}
          onResult={(ok) => settle(dialog, ok)}
        />
      )}
      {dialog?.kind === "prompt" && dialog.prompt && (
        <PromptBox
          key={dialog.id}
          options={dialog.prompt}
          onResult={(value) => settle(dialog, value)}
        />
      )}
    </>
  );
}

function ConfirmBox({ options, onResult }: { options: ConfirmOptions; onResult: (ok: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResult(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={() => onResult(false)} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        {options.title && <h3 className="text-base font-semibold text-slate-900 mb-2">{options.title}</h3>}
        <p className="text-sm text-slate-600 whitespace-pre-line">{options.message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onResult(false)}
            className="px-4 py-2 text-sm border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
          >
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => onResult(true)}
            className={`px-4 py-2 text-sm rounded text-white ${
              options.danger ? "bg-red-600 hover:bg-red-700" : "bg-indigo-600 hover:bg-indigo-700"
            }`}
          >
            {options.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptBox({ options, onResult }: { options: PromptOptions; onResult: (value: string | null) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => onResult(inputRef.current?.value.trim() || null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onResult(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onResult]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40" onClick={() => onResult(null)} />
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm p-6">
        {options.title && <h3 className="text-base font-semibold text-slate-900 mb-3">{options.title}</h3>}
        {options.label && <label className="block text-sm text-slate-600 mb-1">{options.label}</label>}
        <input
          ref={inputRef}
          type="text"
          autoFocus
          defaultValue={options.initialValue ?? ""}
          placeholder={options.placeholder}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full px-3 py-2 border rounded text-sm"
        />
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onResult(null)}
            className="px-4 py-2 text-sm border border-slate-300 rounded text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            className="px-4 py-2 text-sm rounded text-white bg-indigo-600 hover:bg-indigo-700"
          >
            {options.confirmLabel ?? "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
