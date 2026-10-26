// The workspace basket and saved collections.
import type { FileEntry } from '../../domain/contracts';
import { parentPath } from '../../domain/workspaces/planes';
import {
  collectionSchema,
  basketItemSchema,
  type Collection,
  type BasketItem,
} from '../../domain/workspaces/collections';
import { sourceVersion } from '../../domain/files/inspection';
import { activeWorkspace, changeWorkspace, uuid } from './core';
import { setActivePane } from './panes';

export function addToBasket(items: BasketItem[]): void {
  const existing = activeWorkspace().basket ?? [];
  const merged = new Map(existing.map((item) => [item.path, item]));
  for (const item of items) merged.set(item.path, basketItemSchema.parse(item));
  if (merged.size > 10000) throw new Error('The basket holds at most 10,000 files.');
  changeWorkspace((space) => ({ ...space, basket: [...merged.values()] }));
}
export function basketEntries(entries: readonly FileEntry[]) {
  addToBasket(entries.map((item) => ({ path: item.path, version: sourceVersion(item) })));
}
export function removeFromBasket(paths: string[]) {
  const removed = new Set(paths);
  changeWorkspace((space) => ({
    ...space,
    basket: (space.basket ?? []).filter((item) => !removed.has(item.path)),
  }));
}
export function saveCollection(value: Collection) {
  const collection = collectionSchema.parse(value);
  if (
    (activeWorkspace().collections?.length ?? 0) >= 200 &&
    !activeWorkspace().collections?.some((value) => value.id === collection.id)
  )
    throw new Error('Remove a collection before creating another.');
  changeWorkspace((space) => ({
    ...space,
    collections: [
      ...(space.collections ?? []).filter((item) => item.id !== collection.id),
      collection,
    ],
  }));
}
export function addCollectionPane(collectionID: string): string {
  const collection = activeWorkspace().collections?.find((value) => value.id === collectionID);
  if (!collection) throw new Error('This collection is unavailable.');
  if (activeWorkspace().panes.length >= 200)
    throw new Error('Close a plane before opening another.');
  const [source] = collection.sources;
  if (!source) throw new Error('This collection has no locations.');
  const id = uuid(),
    file = collection.kind === 'explicit' ? parentPath(source) : source;
  // The opened collection is the active plane, as a new search is.
  changeWorkspace((space) => ({
    ...space,
    panes: [...space.panes, { id, type: 'collection', path: file, collectionID }],
    roots: [...space.roots, id],
    activePane: id,
  }));
  setActivePane(id);
  return id;
}
