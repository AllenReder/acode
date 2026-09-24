import type { SelectedLineRange } from "@pierre/diffs";
import type { FileOptions } from "@pierre/diffs/react";
import type { ScopedThreadRef } from "@awen/contracts";
import type { DraftId } from "~/composerDraftStore";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { PREFERRED_HIGHLIGHTER } from "~/lib/syntaxHighlighting";

import { FILE_LINK_REVEAL_UNSAFE_CSS } from "./fileSurfaceChrome";

export type FilePostRender = NonNullable<FileOptions<unknown>["onPostRender"]>;

export function shouldEnableCommentAnnotations(
  composerDraftTarget?: ScopedThreadRef | DraftId | undefined,
): boolean {
  return composerDraftTarget !== undefined;
}

export function buildFileEditorKey(
  relativePath: string,
  resolvedTheme: string,
  reloadKey: number,
): string {
  return `${relativePath}:${resolvedTheme}:${reloadKey}`;
}

export interface BuildEditableFileOptionsInput {
  enableCommentAnnotations: boolean;
  hasOpenCommentForm: boolean;
  wordWrap: boolean;
  resolvedTheme: "light" | "dark";
  onPostRender: FilePostRender;
  onGutterUtilityClick?: ((range: SelectedLineRange | null) => void) | undefined;
  onLineSelectionChange?: ((range: SelectedLineRange | null) => void) | undefined;
  onLineSelectionEnd?: ((range: SelectedLineRange | null) => void) | undefined;
}

export function buildEditableFileOptions({
  enableCommentAnnotations,
  hasOpenCommentForm,
  wordWrap,
  resolvedTheme,
  onPostRender,
  onGutterUtilityClick,
  onLineSelectionChange,
  onLineSelectionEnd,
}: BuildEditableFileOptionsInput): FileOptions<unknown> {
  const allowSelection = enableCommentAnnotations && !hasOpenCommentForm;
  return {
    disableFileHeader: true,
    enableGutterUtility: allowSelection,
    enableLineSelection: allowSelection,
    ...(allowSelection && onGutterUtilityClick ? { onGutterUtilityClick } : {}),
    ...(allowSelection && onLineSelectionChange ? { onLineSelectionChange } : {}),
    ...(allowSelection && onLineSelectionEnd ? { onLineSelectionEnd } : {}),
    overflow: wordWrap ? "wrap" : "scroll",
    theme: resolveDiffThemeName(resolvedTheme),
    preferredHighlighter: PREFERRED_HIGHLIGHTER,
    themeType: resolvedTheme,
    unsafeCSS: FILE_LINK_REVEAL_UNSAFE_CSS,
    onPostRender,
  };
}
