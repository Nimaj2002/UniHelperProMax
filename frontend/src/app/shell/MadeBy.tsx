import { Heart } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card } from "./Card";
import { useLayout } from "./layout";

const AUTHOR_URL = "https://github.com/Nimaj2002";

/** The credit at the bottom of the side panel (labelled) and of the closed rail (icon); hidden on Settings. */
export function MadeBy({ variant = "full" }: { variant?: "full" | "icon" }) {
  // the Settings pages show the credit in their own bar under the card instead
  if (useLayout().creditStrip) return null;
  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="group size-8 text-muted-foreground" asChild>
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" aria-label="Made with love by Nima">
              <Heart size={18} weight="fill" className="text-danger motion-safe:group-hover:animate-heartbeat" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Made with ❤️ by Nima</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <p className="group px-2 text-center text-xs text-muted-foreground">
      Made with <span className="inline-block motion-safe:group-hover:animate-heartbeat">❤️</span> by{" "}
      <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">
        Nima
      </a>
    </p>
  );
}

/**
 * The fixed credit bar under the Settings card: as wide as that card, a fixed height, and it
 * never opens or resizes.
 */
export function CreditStrip() {
  return (
    <Card as="aside" label="Credits" className="h-11 shrink-0" body="fill">
      <a
        href={AUTHOR_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Made with love by Nima"
        className="group flex h-full items-center justify-center gap-2 rounded-[13px] px-4 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="whitespace-nowrap tracking-wide">
          Made with
        </span>
        <Heart
          size={16}
          weight="fill"
          aria-hidden
          className="shrink-0 text-danger motion-safe:group-hover:animate-heartbeat"
        />
        <span aria-hidden className="whitespace-nowrap tracking-wide">
          by <span className="font-medium text-foreground">Nima</span>
        </span>
      </a>
    </Card>
  );
}
