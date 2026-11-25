/** In-memory documents shared by the trajectory tab and the right panel. */

import {
  computed,
  ref,
  shallowReactive,
  toValue,
  type ComputedRef,
  type MaybeRefOrGetter,
} from "vue";
import { trajectoryDocumentFrom } from "./documents.ts";
import type { TrajectoryDocument, TrajectoryDocumentOptions } from "./types.ts";

const documents = shallowReactive(new Map<string, TrajectoryDocument>());
const latestId = ref<string | null>(null);

/** Remember a normalized document; a tab and the panel read it by id. */
export function storeTrajectoryDocument(
  document: TrajectoryDocument,
  options: { latest?: boolean } = {},
): TrajectoryDocument {
  documents.set(document.id, document);
  if (options.latest !== false) latestId.value = document.id;
  return document;
}

/** Normalize and remember data from a command. */
export function putTrajectoryDocument(
  value: unknown,
  options: TrajectoryDocumentOptions = {},
): TrajectoryDocument {
  return storeTrajectoryDocument(trajectoryDocumentFrom(value, options));
}

export function trajectoryDocumentById(id: string): TrajectoryDocument | undefined {
  return documents.get(id);
}

/** Make an existing document the one the panel opens without an explicit id. */
export function focusTrajectoryDocument(id: string): TrajectoryDocument | undefined {
  const document = documents.get(id);
  if (document) latestId.value = id;
  return document;
}

/** The latest document set by a command or by opening a document file. */
export function latestTrajectoryDocument(): ComputedRef<TrajectoryDocument | undefined> {
  return computed(() => (latestId.value ? documents.get(latestId.value) : undefined));
}

/** One document by id; an absent id means the latest one. */
export function useTrajectoryDocument(
  id: MaybeRefOrGetter<string | null | undefined>,
): ComputedRef<TrajectoryDocument | undefined> {
  return computed(() => {
    const key = toValue(id);
    return key ? documents.get(key) : latestId.value ? documents.get(latestId.value) : undefined;
  });
}
