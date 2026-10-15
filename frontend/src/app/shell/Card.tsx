import { forwardRef, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props extends Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "style" | "id"> {
  as?: "aside" | "main" | "section" | "div";
  id?: string;
  label?: string;
  /** Fixed rows above the body (title bar, tab row). */
  header?: ReactNode;
  /** Fixed rows below the body (e.g. the side panel's Account and Settings). */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** "scroll": the body scrolls with an inner margin; "fill": the page lays out the body itself. */
  body?: "scroll" | "fill";
  bodyClassName?: string;
  style?: CSSProperties;
  /** false: no rounded border and background (the home page's main column holds its own cards). */
  chrome?: boolean;
  /** Extra attributes for the element (data-*, inert, hidden). */
  [data: `data-${string}`]: string | undefined;
}

/**
 * One floating card of the layout (008 FR-002–FR-004): rounded, bordered, its content clipped to
 * the corners and scrolling on its own.
 */
export const Card = forwardRef<HTMLElement, Props>(function Card(
  { as: Tag = "div", id, label, header, footer, children, className, body = "scroll", bodyClassName, style, chrome = true, ...rest },
  ref,
) {
  return (
    <Tag
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- polymorphic landmark element
      ref={ref as any}
      {...rest}
      id={id}
      aria-label={label}
      style={style}
      className={cn(
        "relative flex min-h-0 min-w-0 flex-col overflow-hidden",
        chrome && "rounded-[14px] border border-strong-border bg-surface-elevated",
        className,
      )}
    >
      {header}
      <div
        className={cn(
          "relative min-h-0 flex-1",
          body === "scroll" ? "overflow-x-hidden overflow-y-auto [scroll-padding-block:8px]" : "flex flex-col",
          bodyClassName,
        )}
      >
        {children}
      </div>
      {footer}
    </Tag>
  );
});
