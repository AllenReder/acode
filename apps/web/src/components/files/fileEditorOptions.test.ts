import { describe, expect, it, vi } from "vite-plus/test";
import {
  buildEditableFileOptions,
  buildFileEditorKey,
  shouldEnableCommentAnnotations,
} from "./fileEditorOptions";

describe("fileEditorOptions", () => {
  describe("shouldEnableCommentAnnotations", () => {
    it("returns true when composerDraftTarget is provided", () => {
      const threadRef = { environmentId: "local", threadId: "thread-1" } as any;
      expect(shouldEnableCommentAnnotations(threadRef)).toBe(true);
      expect(shouldEnableCommentAnnotations("draft-123" as any)).toBe(true);
    });

    it("returns false when composerDraftTarget is undefined", () => {
      expect(shouldEnableCommentAnnotations(undefined)).toBe(false);
    });
  });

  describe("buildEditableFileOptions", () => {
    const dummyPostRender = vi.fn();
    const dummyGutterClick = vi.fn();
    const dummyLineChange = vi.fn();
    const dummyLineEnd = vi.fn();

    it("disables gutter utility and line selection when comment annotations are disabled", () => {
      const options = buildEditableFileOptions({
        enableCommentAnnotations: false,
        hasOpenCommentForm: false,
        wordWrap: true,
        resolvedTheme: "dark",
        onPostRender: dummyPostRender,
        onGutterUtilityClick: dummyGutterClick,
        onLineSelectionChange: dummyLineChange,
        onLineSelectionEnd: dummyLineEnd,
      });

      expect(options.enableGutterUtility).toBe(false);
      expect(options.enableLineSelection).toBe(false);
      expect(options.onGutterUtilityClick).toBeUndefined();
      expect(options.onLineSelectionChange).toBeUndefined();
      expect(options.onLineSelectionEnd).toBeUndefined();
      expect(options.overflow).toBe("wrap");
    });

    it("enables gutter utility and line selection when comments enabled and no open comment form", () => {
      const options = buildEditableFileOptions({
        enableCommentAnnotations: true,
        hasOpenCommentForm: false,
        wordWrap: false,
        resolvedTheme: "light",
        onPostRender: dummyPostRender,
        onGutterUtilityClick: dummyGutterClick,
        onLineSelectionChange: dummyLineChange,
        onLineSelectionEnd: dummyLineEnd,
      });

      expect(options.enableGutterUtility).toBe(true);
      expect(options.enableLineSelection).toBe(true);
      expect(options.onGutterUtilityClick).toBe(dummyGutterClick);
      expect(options.onLineSelectionChange).toBe(dummyLineChange);
      expect(options.onLineSelectionEnd).toBe(dummyLineEnd);
      expect(options.overflow).toBe("scroll");
    });

    it("disables gutter utility and line selection when an open comment form exists", () => {
      const options = buildEditableFileOptions({
        enableCommentAnnotations: true,
        hasOpenCommentForm: true,
        wordWrap: true,
        resolvedTheme: "dark",
        onPostRender: dummyPostRender,
        onGutterUtilityClick: dummyGutterClick,
        onLineSelectionChange: dummyLineChange,
        onLineSelectionEnd: dummyLineEnd,
      });

      expect(options.enableGutterUtility).toBe(false);
      expect(options.enableLineSelection).toBe(false);
      expect(options.onGutterUtilityClick).toBeUndefined();
    });
  });

  describe("buildFileEditorKey", () => {
    it("remains stable between clean and dirty editing states to prevent remount on first edit", () => {
      const initialKey = buildFileEditorKey("src/app.ts", "dark", 0);
      const editedKey = buildFileEditorKey("src/app.ts", "dark", 0);
      expect(initialKey).toBe(editedKey);
    });

    it("changes when relativePath, resolvedTheme, or explicit reloadKey changes", () => {
      expect(buildFileEditorKey("src/app.ts", "dark", 0)).not.toBe(
        buildFileEditorKey("src/other.ts", "dark", 0),
      );
      expect(buildFileEditorKey("src/app.ts", "dark", 0)).not.toBe(
        buildFileEditorKey("src/app.ts", "light", 0),
      );
      expect(buildFileEditorKey("src/app.ts", "dark", 0)).not.toBe(
        buildFileEditorKey("src/app.ts", "dark", 1),
      );
    });
  });
});
