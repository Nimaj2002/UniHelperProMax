import { Heart } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const AUTHOR_URL = "https://github.com/Nimaj2002";

/** The credit at the bottom of the side panel (labelled) and of the closed rail (icon). */
export function MadeBy({ variant = "full" }: { variant?: "full" | "icon" }) {
  if (variant === "icon") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 text-muted-foreground" asChild>
            <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" aria-label="Made with love by Nima">
              <Heart size={18} weight="fill" className="text-red-500" />
            </a>
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">Made with ❤️ by Nima</TooltipContent>
      </Tooltip>
    );
  }
  return (
    <p className="px-2 text-center text-xs text-muted-foreground">
      Made with ❤️ by{" "}
      <a href={AUTHOR_URL} target="_blank" rel="noopener noreferrer" className="font-medium text-foreground underline-offset-4 hover:underline">
        Nima
      </a>
    </p>
  );
}
