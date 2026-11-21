import { useToast } from "@/hooks/use-toast"
import { useLang } from "@/lib/app-i18n"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

export function Toaster() {
  const { toasts } = useToast()
  const lang = useLang()

  return (
    <ToastProvider label={lang === "my" ? "အသိပေးချက်များ" : "Notifications"}>
      {toasts.map(function ({ id, title, description, action, ...props }) {
        return (
          <Toast key={id} {...props}>
            <div className="grid gap-1">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && (
                <ToastDescription>{description}</ToastDescription>
              )}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport label={lang === "my" ? "အသိပေးချက်များ ({hotkey})" : "Notifications ({hotkey})"} />
    </ToastProvider>
  )
}
