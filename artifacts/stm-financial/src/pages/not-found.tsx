import { AlertCircle } from "lucide-react";
import { makeT } from "@/lib/app-i18n";

const useT = makeT({
  title: { en: "404 Page Not Found", my: "404 စာမျက်နှာ မတွေ့ပါ" },
  body: { en: "This page doesn't exist. Use the menu to go back.", my: "ဤစာမျက်နှာ မရှိပါ။ Menu မှ ပြန်သွားပါ။" },
});

export default function NotFound() {
  const t = useT();
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-slate-900">{t("title")}</h1>
        <p className="mt-2 text-sm text-slate-400">{t("body")}</p>
      </div>
    </div>
  );
}
