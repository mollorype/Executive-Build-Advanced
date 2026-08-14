import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-slate-50">
      <div className="text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-slate-900">404 Page Not Found</h1>
        <p className="mt-2 text-sm text-slate-400">Did you forget to add the page to the router?</p>
      </div>
    </div>
  );
}
