import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";

import { ThreadEnvMode } from "./environment.ts";
import { ProjectScriptIcon } from "./orchestration.ts";

/** File name of the checked-in Awen project file, resolved at the workspace root. */
export const AWEN_PROJECT_FILE_NAME = "awen.json";

/** Public URL of the published JSON Schema for {@link AwenProjectFile}. */
export const AWEN_PROJECT_FILE_SCHEMA_URL = "https://awen.codes/schema/awen.json";

const AWEN_PROJECT_FILE_PATH_MAX_LENGTH = 512;
const AWEN_PROJECT_FILE_MAX_SCRIPTS = 50;

// Annotations go on the encoded (string) side so they survive into the
// published JSON Schema; decoding still trims and re-validates non-emptiness.
const trimmedNonEmpty = (annotations: { readonly description: string }, maxLength?: number) => {
  const annotated = Schema.String.annotate(annotations);
  const encoded =
    maxLength === undefined
      ? annotated.check(Schema.isNonEmpty())
      : annotated.check(Schema.isNonEmpty(), Schema.isMaxLength(maxLength));
  return encoded.pipe(Schema.decodeTo(encoded, SchemaTransformation.trim()));
};

export const AwenProjectFileScript = Schema.Struct({
  name: trimmedNonEmpty({
    description: "Display name for the script, shown in the Awen scripts menu.",
  }),
  command: trimmedNonEmpty({
    description: "Shell command executed in an Awen terminal at the Workspace root.",
  }),
  icon: Schema.optionalKey(
    ProjectScriptIcon.annotate({
      description: 'Icon shown next to the script in the scripts menu. Defaults to "play".',
    }),
  ),
  runOnWorktreeCreate: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, the script runs automatically after a worktree is created for a new Agent Session.",
    }),
  ),
  async: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Only for runOnWorktreeCreate scripts. When true (the default), the agent starts while the script is still running. Set false to hold the agent until the script exits.",
    }),
  ),
  previewUrl: Schema.optionalKey(
    trimmedNonEmpty({
      description:
        "URL opened in the in-app browser preview when this script runs. Only honored on the desktop build.",
    }),
  ),
  autoOpenPreview: Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "When true, automatically open the preview panel at `previewUrl` the moment the script starts.",
    }),
  ),
}).annotate({
  description: "A project script that team members can import into Awen.",
});
export type AwenProjectFileScript = typeof AwenProjectFileScript.Type;

export const AwenProjectFile = Schema.Struct({
  $schema: Schema.optionalKey(
    Schema.String.annotate({
      description: `URL of the JSON Schema for this file, typically "${AWEN_PROJECT_FILE_SCHEMA_URL}".`,
    }),
  ),
  iconPath: Schema.optionalKey(
    trimmedNonEmpty(
      {
        description:
          'Workspace-relative path to the project icon (e.g. "assets/logo.svg"). Checked before Awen\'s built-in icon locations.',
      },
      AWEN_PROJECT_FILE_PATH_MAX_LENGTH,
    ),
  ),
  defaultThreadEnvMode: Schema.optionalKey(
    ThreadEnvMode.annotate({
      description:
        'Where new Agent Sessions start for this Project: "worktree" for a fresh Git worktree, "local" for the current Workspace. A per-Project setting in Awen overrides this; when neither is set, the global default applies.',
    }),
  ),
  scripts: Schema.optionalKey(
    Schema.Array(AwenProjectFileScript)
      .annotate({
        description: "Project scripts shared with everyone who opens this Project in Awen.",
      })
      .check(Schema.isMaxLength(AWEN_PROJECT_FILE_MAX_SCRIPTS)),
  ),
}).annotate({
  title: "Awen project file",
  description:
    "Checked-in Project configuration for Awen (awen.json at the Workspace root). See https://awen.codes for documentation.",
});
export type AwenProjectFile = typeof AwenProjectFile.Type;
