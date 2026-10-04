import type { ReactNode } from "react";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="grid min-h-[100dvh] place-items-center bg-surface px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-[15px] font-semibold tracking-tight">UniHelperProMax</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{subtitle}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </main>
  );
}
