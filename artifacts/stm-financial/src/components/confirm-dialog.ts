// Confirm and message boxes drawn by the page itself (same file in STM Financial
// and STM Daily).
//
// window.confirm() can be skipped without any sign: some phone browsers and
// in-app browsers never show it, and browsers can block a page's dialogs after
// a few in a row. confirm() then returns false and a Delete button simply does
// nothing. These boxes always show, follow the app language, and are plain DOM
// so they work anywhere — no provider or React tree needed.

type Lang = "en" | "my";

export type DialogOptions = {
  /** Red confirm button labelled "Delete" (unless confirmLabel is given). */
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Defaults to <html lang>. */
  lang?: Lang;
  /** STM Daily is dark; the portal is light (default). */
  theme?: "light" | "dark";
};

const LABELS: Record<Lang, { ok: string; confirm: string; del: string; cancel: string }> = {
  en: { ok: "OK", confirm: "Confirm", del: "Delete", cancel: "Cancel" },
  my: { ok: "ရပြီ", confirm: "အတည်ပြု", del: "ဖျက်ရန်", cancel: "မလုပ်တော့ပါ" },
};

const COLORS = {
  light: { panel: "#ffffff", text: "#0f172a", border: "#e2e8f0", cancelBg: "#ffffff", cancelText: "#334155", primary: "#2563eb" },
  dark: { panel: "#161b22", text: "#f0f6fc", border: "#30363d", cancelBg: "#0d1117", cancelText: "#c9d1d9", primary: "#2563eb" },
};

type Input = { placeholder?: string; label?: string };

function show(message: string, opts: DialogOptions, withCancel: boolean, input?: Input): Promise<{ ok: boolean; value: string }> {
  if (typeof document === "undefined") return Promise.resolve({ ok: false, value: "" });
  const lang: Lang = opts.lang ?? (document.documentElement.lang === "my" ? "my" : "en");
  const L = LABELS[lang];
  const c = COLORS[opts.theme ?? "light"];

  return new Promise(resolve => {
    const before = document.activeElement as HTMLElement | null;

    const root = document.createElement("div");
    Object.assign(root.style, {
      position: "fixed", inset: "0", zIndex: "1000", display: "flex", alignItems: "center", justifyContent: "center",
      padding: "16px", background: "rgba(0,0,0,0.6)",
    });
    root.dataset.testid = "app-dialog";

    const box = document.createElement("div");
    box.setAttribute("role", withCancel ? "alertdialog" : "dialog");
    box.setAttribute("aria-modal", "true");
    Object.assign(box.style, {
      width: "100%", maxWidth: "380px", background: c.panel, color: c.text, border: `1px solid ${c.border}`,
      borderRadius: "16px", padding: "20px", boxShadow: "0 10px 30px rgba(0,0,0,0.25)", fontFamily: "inherit",
    });

    const text = document.createElement("p");
    text.id = `app-dialog-${Date.now()}`;
    text.textContent = message;   // never HTML: names and notes come from the database
    Object.assign(text.style, { margin: "0 0 18px", fontSize: "15px", lineHeight: "1.55", whiteSpace: "pre-line", wordBreak: "break-word" });
    box.setAttribute("aria-describedby", text.id);
    box.appendChild(text);

    // A required note (e.g. why something is being deleted).
    let field: HTMLTextAreaElement | null = null;
    if (input) {
      field = document.createElement("textarea");
      field.rows = 3;
      field.maxLength = 500;
      field.placeholder = input.placeholder ?? "";
      field.setAttribute("aria-label", input.label ?? input.placeholder ?? "");
      field.dataset.testid = "app-dialog-input";
      Object.assign(field.style, {
        width: "100%", boxSizing: "border-box", margin: "-6px 0 16px", padding: "10px 12px", borderRadius: "12px",
        border: `1px solid ${c.border}`, background: c.cancelBg, color: c.text, fontSize: "16px", fontFamily: "inherit", resize: "vertical",
      });
      box.appendChild(field);
    }

    const row = document.createElement("div");
    Object.assign(row.style, { display: "flex", gap: "10px" });
    const button = (label: string, bg: string, fg: string, border: string) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      Object.assign(b.style, {
        flex: "1", minHeight: "44px", padding: "10px 12px", borderRadius: "12px", fontSize: "14px", fontWeight: "700",
        fontFamily: "inherit", cursor: "pointer", background: bg, color: fg, border: `1px solid ${border}`,
      });
      return b;
    };

    const finish = (ok: boolean) => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      before?.focus?.();
      resolve({ ok, value: field?.value.trim() ?? "" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(false); }
    };

    let cancel: HTMLButtonElement | null = null;
    if (withCancel) {
      cancel = button(opts.cancelLabel ?? L.cancel, c.cancelBg, c.cancelText, c.border);
      cancel.addEventListener("click", () => finish(false));
      row.appendChild(cancel);
    }
    const okColor = opts.danger ? "#dc2626" : c.primary;
    const ok = button(opts.confirmLabel ?? (withCancel ? (opts.danger ? L.del : L.confirm) : L.ok), okColor, "#ffffff", okColor);
    ok.addEventListener("click", () => finish(true));
    if (field) {
      // Can't confirm with an empty note.
      const sync = () => { ok.disabled = !field!.value.trim(); ok.style.opacity = ok.disabled ? "0.5" : "1"; };
      field.addEventListener("input", sync);
      sync();
    }
    row.appendChild(ok);
    box.appendChild(row);

    // A tap outside the box is "Cancel".
    root.addEventListener("click", e => { if (e.target === root) finish(false); });
    document.addEventListener("keydown", onKey, true);
    root.appendChild(box);
    document.body.appendChild(root);
    (field ?? cancel ?? ok).focus();   // a stray Enter never deletes
  });
}

/** Ask before doing something. Resolves true only when the user confirms. */
export function confirmDialog(message: string, opts: DialogOptions = {}): Promise<boolean> {
  return show(message, opts, true).then(r => r.ok);
}

/** Ask for a reason before doing something. Resolves the reason, or null if cancelled. */
export function reasonDialog(message: string, opts: DialogOptions & Input = {}): Promise<string | null> {
  return show(message, opts, true, { placeholder: opts.placeholder, label: opts.label }).then(r => (r.ok && r.value ? r.value : null));
}

/** Tell the user something (e.g. why a delete didn't happen). */
export function messageDialog(message: string, opts: DialogOptions = {}): Promise<void> {
  return show(message, opts, false).then(() => undefined);
}
