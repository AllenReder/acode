import type { EnvironmentAcodeProject } from "@t3tools/client-runtime/state/models";
import { FolderOpenIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { readLocalApi } from "../../localApi";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

export interface AddWorkspaceDialogProps {
  readonly project: EnvironmentAcodeProject | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAssociate: (path: string) => Promise<void>;
}

export function AddWorkspaceDialog({
  project,
  open,
  onOpenChange,
  onAssociate,
}: AddWorkspaceDialogProps) {
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setPath("");
    setPending(false);
    setError(null);
    if (typeof window !== "undefined") {
      const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [open]);

  const handleBrowse = useCallback(async () => {
    const api = readLocalApi();
    if (!api) return;
    try {
      const selected = await api.dialogs.pickFolder();
      if (selected) {
        setPath(selected);
        setError(null);
      }
    } catch {
      // Ignore picker cancellation or failures
    }
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const trimmedPath = path.trim();
      if (!trimmedPath) {
        setError("Please enter or select a worktree path.");
        return;
      }
      setPending(true);
      setError(null);
      try {
        await onAssociate(trimmedPath);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add workspace.");
      } finally {
        setPending(false);
      }
    },
    [onAssociate, onOpenChange, path],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogPopup className="max-w-lg" data-testid="add-workspace-dialog">
        <DialogHeader>
          <DialogTitle>Add Workspace</DialogTitle>
          <DialogDescription>
            Attach an existing Git worktree to{" "}
            <span className="font-medium text-foreground">{project?.title ?? "Project"}</span>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogPanel className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="add-workspace-path">Worktree Path</Label>
              <div className="flex gap-2">
                <Input
                  ref={inputRef}
                  id="add-workspace-path"
                  data-testid="add-workspace-path-input"
                  placeholder="/path/to/worktree"
                  value={path}
                  disabled={pending}
                  onChange={(e) => {
                    setPath(e.target.value);
                    if (error) setError(null);
                  }}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={handleBrowse}
                  data-testid="add-workspace-browse-btn"
                >
                  <FolderOpenIcon className="size-4 mr-1.5" />
                  Browse…
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Path of an existing Git worktree checkout directory on your machine.
              </p>
            </div>
            {error ? (
              <p className="text-xs text-destructive font-medium" data-testid="add-workspace-error">
                {error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || !path.trim()}
              data-testid="add-workspace-submit-btn"
            >
              {pending ? "Adding…" : "Add Workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export interface NewWorkspaceDialogProps {
  readonly project: EnvironmentAcodeProject | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCreate: (input: {
    readonly newBranch?: string | undefined;
    readonly baseRef?: string | undefined;
    readonly path?: string | undefined;
  }) => Promise<void>;
}

export function NewWorkspaceDialog({
  project,
  open,
  onOpenChange,
  onCreate,
}: NewWorkspaceDialogProps) {
  const [newBranch, setNewBranch] = useState("");
  const [baseRef, setBaseRef] = useState("HEAD");
  const [path, setPath] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setNewBranch("");
    setBaseRef("HEAD");
    setPath("");
    setPending(false);
    setError(null);
    if (typeof window !== "undefined") {
      const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
      return () => window.cancelAnimationFrame(frame);
    }
  }, [open]);

  const handleBrowse = useCallback(async () => {
    const api = readLocalApi();
    if (!api) return;
    try {
      const selected = await api.dialogs.pickFolder();
      if (selected) {
        setPath(selected);
      }
    } catch {
      // Ignore picker cancellation or failures
    }
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setPending(true);
      setError(null);
      try {
        await onCreate({
          ...(newBranch.trim() ? { newBranch: newBranch.trim() } : {}),
          ...(baseRef.trim() ? { baseRef: baseRef.trim() } : {}),
          ...(path.trim() ? { path: path.trim() } : {}),
        });
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create workspace.");
      } finally {
        setPending(false);
      }
    },
    [baseRef, newBranch, onCreate, onOpenChange, path],
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (pending ? undefined : onOpenChange(next))}>
      <DialogPopup className="max-w-lg" data-testid="new-workspace-dialog">
        <DialogHeader>
          <DialogTitle>New Workspace</DialogTitle>
          <DialogDescription>
            Create a new Git worktree for{" "}
            <span className="font-medium text-foreground">{project?.title ?? "Project"}</span>.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <DialogPanel className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-workspace-branch">New Branch Name</Label>
              <Input
                ref={inputRef}
                id="new-workspace-branch"
                data-testid="new-workspace-branch-input"
                placeholder="e.g. feature-login (leave blank for detached HEAD)"
                value={newBranch}
                disabled={pending}
                onChange={(e) => setNewBranch(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Branch to create and check out. Leave blank to check out at a detached HEAD.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-workspace-base-ref">Base Ref</Label>
              <Input
                id="new-workspace-base-ref"
                data-testid="new-workspace-base-ref-input"
                placeholder="HEAD"
                value={baseRef}
                disabled={pending}
                onChange={(e) => setBaseRef(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Branch, tag, or commit the new worktree starts from (defaults to HEAD).
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-workspace-path">Destination Path (Optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="new-workspace-path"
                  data-testid="new-workspace-path-input"
                  placeholder="Default managed worktrees folder"
                  value={path}
                  disabled={pending}
                  onChange={(e) => setPath(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={handleBrowse}
                  data-testid="new-workspace-browse-btn"
                >
                  <FolderOpenIcon className="size-4 mr-1.5" />
                  Browse…
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Destination folder path. Leave blank for the managed worktrees directory.
              </p>
            </div>

            {error ? (
              <p className="text-xs text-destructive font-medium" data-testid="new-workspace-error">
                {error}
              </p>
            ) : null}
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending}
              data-testid="new-workspace-submit-btn"
            >
              {pending ? "Creating…" : "Create Workspace"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
