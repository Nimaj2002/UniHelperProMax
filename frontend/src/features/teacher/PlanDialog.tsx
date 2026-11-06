/**
 * 022 US4 (FR-026, FR-027): the lesson plan — the latest plan the teacher wrote, drawn as a
 * diagram with the step the lesson is on outlined.
 */
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MermaidBlock } from "@/features/chat/richMarkdown";
import type { Plan } from "./api";

/** The plan's source with its current node outlined (no fixed colours: width and dashes only). */
export function markCurrent(plan: Plan): string {
  if (!plan.current || !/^[\w-]+$/.test(plan.current)) return plan.mermaid;
  return `${plan.mermaid}\nclassDef uhCurrent stroke-width:4px,stroke-dasharray:6 3\nclass ${plan.current} uhCurrent`;
}

export function PlanDialog({ plan, open, onOpenChange }: { plan: Plan | undefined; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Dialog open={open && !!plan} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Lesson plan{plan && plan.version > 1 ? ` (version ${plan.version})` : ""}</DialogTitle>
          <DialogDescription>
            The ideas this lesson moves through, from what you already hold to your goal.
            {plan?.current ? ` The outlined step (${plan.current}) is where the lesson is now.` : ""}
          </DialogDescription>
        </DialogHeader>
        {plan && <MermaidBlock source={markCurrent(plan)} />}
      </DialogContent>
    </Dialog>
  );
}
