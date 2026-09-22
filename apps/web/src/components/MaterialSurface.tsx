import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../lib/utils";

export const MATERIAL_SURFACE_KINDS = ["sidebar", "topbar", "workbench", "overlay"] as const;

export type MaterialSurfaceKind = (typeof MATERIAL_SURFACE_KINDS)[number];

const MATERIAL_SURFACE_CLASSES: Record<MaterialSurfaceKind, string> = {
  sidebar: "material-surface-sidebar",
  topbar: "material-surface-topbar",
  workbench: "material-surface-workbench",
  overlay: "material-surface-overlay",
};

export type MaterialSurfaceProps = ComponentPropsWithoutRef<"div"> & {
  readonly [dataAttribute: `data-${string}`]: string | number | boolean | undefined;
  readonly kind: MaterialSurfaceKind;
};

/** The single rendering entry point for layers that own background material. */
export function MaterialSurface({ children, className, kind, ...props }: MaterialSurfaceProps) {
  return (
    <div
      {...props}
      className={cn(MATERIAL_SURFACE_CLASSES[kind], className)}
      data-material-surface={kind}
    >
      {children}
    </div>
  );
}
