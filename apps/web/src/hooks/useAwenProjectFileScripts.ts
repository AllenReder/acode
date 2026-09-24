import {
  AWEN_PROJECT_FILE_NAME,
  type EnvironmentId,
  type AwenProjectFile,
  type AwenProjectFileScript,
} from "@awen/contracts";
import { parseAwenProjectFile } from "@awen/shared/awenProjectFile";
import { useMemo } from "react";

import { useProjectFileQuery } from "~/components/files/projectFilesQueryState";

const NO_SCRIPTS: ReadonlyArray<AwenProjectFileScript> = [];

export interface AwenProjectFileState {
  /**
   * - `valid`: awen.json exists and decoded.
   * - `invalid`: awen.json exists but fails to decode (the server then ignores
   *   the whole file, including `iconPath` and every script).
   * - `missing`: no readable awen.json at the workspace root.
   * - `loading`: the file query has not settled yet.
   */
  status: "loading" | "missing" | "invalid" | "valid";
  /** The decoded file when status is `valid`, null otherwise. */
  file: AwenProjectFile | null;
  scripts: ReadonlyArray<AwenProjectFileScript>;
}

/**
 * Decoded state of the project's checked-in `awen.json`, including whether the
 * file exists but is broken — which the runtime otherwise swallows silently.
 */
export function useAwenProjectFileState(
  environmentId: EnvironmentId,
  cwd: string | null,
): AwenProjectFileState {
  const query = useProjectFileQuery(environmentId, cwd ?? "", AWEN_PROJECT_FILE_NAME, cwd !== null);
  const contents = query.data && !query.data.truncated ? query.data.contents : null;
  const isPending = query.isPending;
  return useMemo(() => {
    if (contents === null) {
      return {
        status: isPending ? "loading" : "missing",
        file: null,
        scripts: NO_SCRIPTS,
      } as const;
    }
    const file = parseAwenProjectFile(contents);
    if (file === null) {
      return { status: "invalid", file: null, scripts: NO_SCRIPTS } as const;
    }
    return { status: "valid", file, scripts: file.scripts ?? NO_SCRIPTS } as const;
  }, [contents, isPending]);
}

/**
 * Scripts declared in the project's checked-in `awen.json`, offered in the
 * scripts menu for import. Missing, truncated, or invalid files resolve to
 * an empty list.
 */
export function useAwenProjectFileScripts(
  environmentId: EnvironmentId,
  cwd: string | null,
): ReadonlyArray<AwenProjectFileScript> {
  return useAwenProjectFileState(environmentId, cwd).scripts;
}
