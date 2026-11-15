import { Check } from "lucide-react";
import { Badge } from "@/ui/Badge";
import { Spinner } from "@/ui/Spinner";
import styles from "./shared.module.css";

/** Numbered progress for flows that need more than one signature. `active` past the end means all done. */
export function Steps({ steps, active, working }: { steps: string[]; active: number; working?: boolean }) {
  return (
    <ol className={styles.steps} aria-label="Progress">
      {steps.map((label, n) => {
        const done = n < active;
        const current = n === active;
        return (
          <li
            key={label}
            className={done ? styles.stepDone : current ? styles.stepActive : undefined}
            aria-current={current ? "step" : undefined}
          >
            <Badge tone={done ? "ink" : current ? "mark" : "neutral"}>
              {done ? <Check size={12} aria-label="Done" /> : n + 1}
            </Badge>
            {label}
            {current && working && <Spinner size={12} />}
          </li>
        );
      })}
    </ol>
  );
}
