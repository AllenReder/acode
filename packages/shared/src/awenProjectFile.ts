import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";

import { AwenProjectFile, AWEN_PROJECT_FILE_SCHEMA_URL } from "@awen/contracts";

import { fromLenientJson } from "./schemaJson.ts";

/**
 * Codec between the raw `awen.json` file contents (lenient JSONC string) and the
 * decoded {@link AwenProjectFile}.
 */
export const AwenProjectFileFromJson = fromLenientJson(AwenProjectFile);

const decodeAwenProjectFile = Schema.decodeExit(AwenProjectFileFromJson);

/**
 * Decode raw `awen.json` contents, treating invalid or malformed files as
 * absent. Clients use this to read optional defaults (scripts, thread env
 * mode) without surfacing decode errors to the user.
 */
export function parseAwenProjectFile(contents: string): AwenProjectFile | null {
  const decoded = decodeAwenProjectFile(contents);
  return Exit.isSuccess(decoded) ? decoded.value : null;
}

/**
 * Build the publishable JSON Schema document for `awen.json` (draft 2020-12).
 *
 * Served from the marketing site at {@link AWEN_PROJECT_FILE_SCHEMA_URL} so
 * editors get LSP support via a `$schema` reference.
 */
export function buildAwenProjectFileJsonSchema(): Record<string, unknown> {
  const document = Schema.toJsonSchemaDocument(AwenProjectFile);
  const jsonSchema: Record<string, unknown> = {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: AWEN_PROJECT_FILE_SCHEMA_URL,
    ...document.schema,
  };
  if (document.definitions && Object.keys(document.definitions).length > 0) {
    jsonSchema.$defs = document.definitions;
  }
  return jsonSchema;
}
