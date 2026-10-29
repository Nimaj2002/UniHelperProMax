import {
  CheckCircle as CircleCheckIcon,
  Info as InfoIcon,
  SpinnerGap as Loader2Icon,
  XCircle as OctagonXIcon,
  Warning as TriangleAlertIcon,
} from "@phosphor-icons/react"
import { useResolvedTheme } from "@/app/theme"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const theme = useResolvedTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      closeButton
      icons={{
        success: <CircleCheckIcon weight="fill" className="size-5 text-[var(--success)]" />,
        info: <InfoIcon weight="fill" className="size-5 text-[var(--accent)]" />,
        warning: <TriangleAlertIcon weight="fill" className="size-5 text-[var(--warning)]" />,
        error: <OctagonXIcon weight="fill" className="size-5 text-[var(--danger)]" />,
        loading: <Loader2Icon className="size-5 animate-spin text-[var(--text-muted)]" />,
      }}
      toastOptions={{
        classNames: {
          toast:
            "!items-start !gap-3 !rounded-xl !py-3.5 !pl-4 !pr-11 !shadow-[0_1px_2px_var(--shadow-tint),0_12px_32px_-8px_var(--shadow-tint),0_24px_48px_-12px_var(--shadow-tint)]",
          icon: "!mt-px !size-5 !m-0",
          title: "!text-sm !font-semibold !leading-5",
          description: "!text-[13px] !leading-5 !text-[var(--text-muted)]",
          closeButton:
            "!left-auto !right-2.5 !top-3 !size-6 !transform-none !rounded-md !border-0 !bg-transparent !text-[var(--text-muted)] transition-colors hover:!bg-[var(--surface-hover)] hover:!text-[var(--text-primary)] focus-visible:!outline-2 focus-visible:!outline-[var(--focus-ring)]",
          actionButton: "!rounded-md !bg-[var(--accent)] !text-[var(--accent-foreground)] !font-medium",
        },
      }}
      style={
        {
          // Solid project tokens; the old --popover/--border vars were undefined/too harsh → transparent toast
          "--normal-bg": "var(--surface-elevated)",
          "--normal-text": "var(--text-primary)",
          "--normal-border": "var(--divider)",
          "--border-radius": "0.75rem",
          "--width": "380px",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
