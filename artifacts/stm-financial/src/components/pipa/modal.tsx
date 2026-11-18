import type { ReactNode } from "react";
import { X } from "lucide-react";

/** Bottom sheet on phones, centred dialog on larger screens. */
export default function PipaModal({ title, subtitle, onClose, children, footer }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label={title}
        className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <h2 className="text-slate-900 font-bold text-base">{title}</h2>
            {subtitle && <p className="text-slate-500 text-xs mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="text-slate-500 hover:text-slate-900 p-1.5 -m-1.5 rounded-lg hover:bg-slate-100 transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-slate-100 shrink-0">{footer}</div>}
      </div>
    </div>
  );
}

export const fieldCls =
  "w-full bg-slate-50 border border-slate-200 text-slate-900 text-base sm:text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-300/50 placeholder:text-slate-400";
export const labelCls = "block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5";
export const primaryBtn =
  "w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold rounded-xl py-3 text-sm transition-colors";

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="bg-pale-red border border-red-200 rounded-xl px-3 py-2.5 text-xs text-pale-red-foreground">
      {children}
    </div>
  );
}
