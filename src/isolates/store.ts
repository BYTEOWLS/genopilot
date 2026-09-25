import {createCatalogStore, type CatalogMutation, type LoadedCatalog} from '../catalog-store.js';
import {emptyIsolateCatalog, parseIsolateCatalog, validateIsolateCatalog, type IsolateCatalog} from './catalog.js';

export type LoadedIsolateCatalog = LoadedCatalog<IsolateCatalog>;

export type IsolateCatalogMutation = CatalogMutation<IsolateCatalog>;

/** The catalog file exists but cannot be read or does not satisfy the schema. */
export class IsolateCatalogLoadError extends Error {
  readonly catalogPath: string;

  constructor(catalogPath: string, cause: unknown) {
    super(
      `The isolate catalog at ${catalogPath} cannot be loaded and will not be changed until it is ` +
        `fixed or moved aside.\n${cause instanceof Error ? cause.message : String(cause)}`,
      {cause},
    );
    this.name = 'IsolateCatalogLoadError';
    this.catalogPath = catalogPath;
  }
}

/** Another writer changed the catalog after it was loaded, so the edit was not applied. */
export class IsolateCatalogChangedError extends Error {
  constructor() {
    super('The isolate catalog was changed by another GenoPilot window. Reload it and try again.');
    this.name = 'IsolateCatalogChangedError';
  }
}

const store = createCatalogStore<IsolateCatalog>({
  parse: parseIsolateCatalog,
  validate: validateIsolateCatalog,
  empty: emptyIsolateCatalog,
  loadError: (path, cause) => new IsolateCatalogLoadError(path, cause),
  changedError: () => new IsolateCatalogChangedError(),
  busyMessage: 'Another GenoPilot window is saving the isolate catalog. Try again.',
});

export const loadIsolateCatalog = store.load;

export const updateIsolateCatalog = store.update;
