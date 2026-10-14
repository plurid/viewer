/** Portable definition plus its current on-disk revision; no machine credentials. */
export interface DefinitionDocument<T> {
  file: string;
  root: string;
  revision: string;
  definition: T;
}
