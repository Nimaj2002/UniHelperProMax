/**
 * 014 FR-033: an answer rendered as Markdown — `react-markdown` with `remark-gfm` and no raw HTML
 * (so nothing needs sanitising; the default `urlTransform` drops `javascript:` links). Links open
 * outside the app, remote images are never fetched, and code blocks show their language and a
 * Copy button. The text is split into top-level blocks, each memoised by its text, so only the
 * last block re-renders while an answer streams (research R13).
 */
import { Check, Copy, ImageBroken } from "@phosphor-icons/react";
import { isValidElement, memo, useMemo, useState, type ComponentProps, type ReactElement, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { splitBlocks } from "./markdownBlocks";

export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(what);
  } catch {
    toast.error("Couldn't copy to the clipboard.");
  }
}

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children);
  return "";
}

function CodeBlock({ children }: ComponentProps<"pre">) {
  const [copied, setCopied] = useState(false);
  const code = isValidElement(children) ? (children as ReactElement<{ className?: string; children?: ReactNode }>) : null;
  const lang = /language-([\w+#.-]+)/.exec(code?.props.className ?? "")?.[1];
  const text = textOf(code?.props.children ?? children).replace(/\n$/, "");
  return (
    <div className="my-2 overflow-hidden rounded-md border border-divider bg-surface-sunken">
      <div className="flex h-8 items-center justify-between gap-2 border-b border-divider pr-1 pl-3 text-xs text-muted-foreground">
        <span className="truncate font-mono">{lang ?? "code"}</span>
        <button
          type="button"
          aria-label="Copy code"
          title="Copy code"
          onClick={() => {
            void copyText(text, "Code copied").then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="inline-flex size-7 items-center justify-center rounded hover:bg-surface-hover hover:text-foreground"
        >
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[13px] leading-5">{children}</pre>
    </div>
  );
}

const components: Components = {
  a: ({ node: _node, href, children, ...rest }) => (
    <a {...rest} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
      {children}
    </a>
  ),
  // FR-033: remote images are never loaded on their own; the link opens them on request
  img: ({ src, alt }) => (
    <span className="my-1 inline-flex items-center gap-1.5 rounded border border-dashed border-strong-border px-2 py-1 text-xs text-muted-foreground">
      <ImageBroken size={14} aria-hidden />
      Remote image not loaded{alt ? ` (${alt})` : ""}
      {typeof src === "string" && src && (
        <>
          {" — "}
          <a href={src} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
            Open link
          </a>
        </>
      )}
    </span>
  ),
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
};

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </Markdown>
  );
});

/** Typography for answers, from theme tokens only. */
const PROSE = cn(
  "min-w-0 text-sm leading-6 break-words text-foreground",
  "[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_li]:my-0.5",
  "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
  "[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_h4]:mt-3 [&_h4]:font-medium",
  "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-strong-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_:not(pre)>code]:rounded [&_:not(pre)>code]:bg-surface-sunken [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.9em]",
  "[&_table]:my-2 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse [&_td]:border [&_td]:border-divider [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-divider [&_th]:bg-surface-sunken [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
  "[&_hr]:my-3 [&_hr]:border-divider [&>div>:first-child]:mt-0",
);

export function AnswerMarkdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => splitBlocks(text), [text]);
  return (
    <div className={cn(PROSE, className)}>
      {blocks.map((b, i) => (
        <div key={i}>
          <Block text={b} />
        </div>
      ))}
    </div>
  );
}
