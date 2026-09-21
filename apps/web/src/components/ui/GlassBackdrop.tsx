import { cn } from "../../lib/utils";

/**
 * Frosted glass backdrop for popovers, modals, and dropdown overlays.
 */
export function GlassBackdrop({
  className = "popover-backdrop",
}: {
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 z-0 rounded-[inherit] backdrop-blur-xl bg-background/60",
        className,
      )}
    />
  );
}
