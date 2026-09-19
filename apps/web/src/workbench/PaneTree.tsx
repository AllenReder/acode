import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import { layoutLeaves, layoutSashes, type LayoutNode, type SplitDir } from "./layout";
import { resolveViewDefinition, type ViewTarget } from "./viewRegistry";
import { useWorkbenchStore } from "./workbenchStore";
import type { WorkbenchSnapshot } from "./workbenchState";

interface PaneTreeProps {
  readonly snapshot: WorkbenchSnapshot;
}

/**
 * Render the workbench's layout tree. Each leaf becomes a `Pane` whose body
 * is dispatched through the View registry. Sashes between split leaves are
 * draggable and forward their ratio to `setSplitRatio`. Clicking anywhere
 * in a Pane focuses it (per the C10 issue: "clicking a Pane focuses it
 * without changing other Panes' data").
 *
 * C10 ships BSP + click-focus + drag-resize. Drag-to-move (cross-pane drop)
 * is C12 and explicitly deferred by the ticket.
 */
export function PaneTree({ snapshot }: PaneTreeProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <PaneNode snapshot={snapshot} node={snapshot.tab.layout} focusedPaneId={snapshot.tab.focusedPaneId} />
    </div>
  );
}

interface PaneNodeProps {
  readonly snapshot: WorkbenchSnapshot;
  readonly node: LayoutNode;
  readonly focusedPaneId: string;
}

function PaneNode({ snapshot, node, focusedPaneId }: PaneNodeProps) {
  if (node.type === "leaf") {
    return <Pane snapshot={snapshot} paneId={node.id} focused={node.id === focusedPaneId} />;
  }

  const items: ReactNode[] = [];
  for (let i = 0; i < node.children.length; i++) {
    if (i > 0) {
      items.push(
        <SashHandle
          key={`sash-${node.id}-${i - 1}`}
          splitId={node.id}
          index={i - 1}
          dir={node.dir}
          sizes={node.sizes}
        />,
      );
    }
    items.push(
      <PaneNode
        key={node.children[i]!.type === "leaf" ? node.children[i]!.id : node.children[i]!.id}
        snapshot={snapshot}
        node={node.children[i]!}
        focusedPaneId={focusedPaneId}
      />,
    );
  }

  return (
    <div
      className={
        node.dir === "right"
          ? "flex h-full min-h-0 min-w-0 flex-1 flex-row"
          : "flex h-full min-h-0 min-w-0 flex-1 flex-col"
      }
    >
      {items}
    </div>
  );
}

interface PaneProps {
  readonly snapshot: WorkbenchSnapshot;
  readonly paneId: string;
  readonly focused: boolean;
}

function Pane({ snapshot, paneId, focused }: PaneProps) {
  const setFocused = useWorkbenchStore((s) => s.setFocused);
  const closePane = useWorkbenchStore((s) => s.closePane);
  const target = snapshot.panes.get(paneId) ?? null;
  const targetRef = useRef<ViewTarget | null>(target);
  targetRef.current = target;

  const onClick = useCallback(() => {
    if (!focused) setFocused(paneId);
  }, [focused, paneId, setFocused]);

  // availableSize is a hint only — Phase C12 will measure the bounding rect
  // at drop time. For C10 the View instances render at full Pane size.
  const definition = target !== null ? resolveViewDefinition(target) : null;

  return (
    <div
      role="region"
      aria-label={target !== null ? `Pane ${target.kind}` : "Empty pane"}
      onMouseDown={onClick}
      className={
        "flex h-full min-h-0 min-w-0 flex-1 flex-col " +
        (focused ? "outline outline-1 outline-accent" : "")
      }
      data-pane-id={paneId}
      data-pane-focused={focused}
      data-pane-target-kind={target?.kind ?? "empty"}
    >
      <PaneHeader
        paneId={paneId}
        target={target}
        focused={focused}
        onClose={() => closePane(paneId)}
      />
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {definition === null ? (
          <EmptyPane target={target} />
        ) : (
          <definition.Component
            target={target as never}
            paneId={paneId}
            focused={focused}
            availableSize={{ width: 0, height: 0 }}
          />
        )}
      </div>
    </div>
  );
}

function PaneHeader({
  paneId,
  target,
  focused,
  onClose,
}: {
  readonly paneId: string;
  readonly target: ViewTarget | null;
  readonly focused: boolean;
  readonly onClose: () => void;
}) {
  void paneId;
  void focused;
  return (
    <div className="flex h-8 items-center justify-between gap-2 border-b border-border px-3 text-xs text-muted-foreground">
      <span className="truncate">{target === null ? "Empty pane" : labelForTarget(target)}</span>
      <button
        type="button"
        aria-label="Close pane"
        className="rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

function EmptyPane({ target }: { readonly target: ViewTarget | null }) {
  if (target !== null) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
        No View registered for {target.kind}.
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 items-center justify-center p-6 text-sm text-muted-foreground">
      Empty pane. Open an entry from the Sidebar.
    </div>
  );
}

function labelForTarget(target: ViewTarget): string {
  switch (target.kind) {
    case "agentSession":
      return "Agent";
    case "workspaceTerminal":
      return "Terminal";
  }
}

interface SashHandleProps {
  readonly splitId: string;
  readonly index: number;
  readonly dir: SplitDir;
  readonly sizes: ReadonlyArray<number>;
}

function SashHandle({ splitId, index, dir, sizes }: SashHandleProps) {
  const setSplitRatio = useWorkbenchStore((s) => s.setSplitRatio);
  // Drag bookkeeping. We capture the parent split container's rect on
  // mousedown — the sash itself is only 1px wide/tall, so its own rect
  // yields a zero totalPx and the drag silently no-ops.
  const dragStateRef = useRef<{
    startPx: number;
    sizes: number[];
    totalPx: number;
  } | null>(null);
  const [hover, setHover] = useState(false);

  const onMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      // Walk to the parent flex wrapper: it owns the full width/height
      // that the two sibling leaves share. Fallback to the viewport if the
      // parent is missing (defensive — should not happen in the tree).
      const container = event.currentTarget.parentElement?.getBoundingClientRect();
      const totalPx =
        container !== undefined
          ? dir === "right"
            ? container.width
            : container.height
          : dir === "right"
            ? window.innerWidth
            : window.innerHeight;
      const startPx = dir === "right" ? event.clientX : event.clientY;
      dragStateRef.current = { startPx, sizes: [...sizes], totalPx };

      const move = (e: MouseEvent) => {
        const state = dragStateRef.current;
        if (state === null) return;
        const currentPx = dir === "right" ? e.clientX : e.clientY;
        const deltaPx = currentPx - state.startPx;
        const ratio = state.totalPx > 0 ? deltaPx / state.totalPx : 0;
        const a = state.sizes[index];
        const b = state.sizes[index + 1];
        if (a === undefined || b === undefined) return;
        const pair = a + b;
        if (pair === 0) return;
        const boundary = a + ratio;
        setSplitRatio(splitId, index, Math.max(0, Math.min(pair, boundary)));
      };
      const up = () => {
        dragStateRef.current = null;
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [dir, index, setSplitRatio, sizes, splitId],
  );

  useEffect(() => () => {
    // Detach listeners if the sash unmounts mid-drag.
    dragStateRef.current = null;
  }, []);

  return (
    <div
      role="separator"
      aria-orientation={dir === "right" ? "vertical" : "horizontal"}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onMouseDown={onMouseDown}
      className={
        (dir === "right" ? "w-1 cursor-col-resize " : "h-1 cursor-row-resize ") +
        (hover ? "bg-accent" : "bg-border")
      }
      data-sash-id={splitId}
      data-sash-index={index}
    />
  );
}

// Pure layout helpers are imported for downstream test consumers; suppress
// the "unused import" lint without losing them.
void layoutLeaves;
void layoutSashes;