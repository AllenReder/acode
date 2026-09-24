import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@awen/contracts";

import { environmentCatalog } from "../connection/catalog";
import type { ConnectionCatalogEntry } from "@awen/client-runtime/connection";

const EMPTY_CATALOG_SNAPSHOT = Object.freeze({
  isReady: false,
  entry: null,
});

export interface EnvironmentCatalogSnapshot {
  readonly isReady: boolean;
  readonly entry: ConnectionCatalogEntry | null;
}

export function useEnvironmentCatalogSnapshot(
  environmentId: EnvironmentId | null,
): EnvironmentCatalogSnapshot {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  if (environmentId === null) return EMPTY_CATALOG_SNAPSHOT;
  const entry = catalog.entries.get(environmentId) ?? null;
  return { isReady: catalog.isReady, entry };
}
