import {createCatalogStore, type CatalogMutation, type LoadedCatalog} from '../catalog-store.js';
import {
  emptyAccessionCatalog,
  parseAccessionCatalog,
  validateAccessionCatalog,
  type AccessionCatalog,
} from './catalog.js';

export type LoadedAccessionCatalog = LoadedCatalog<AccessionCatalog>;

export type AccessionCatalogMutation = CatalogMutation<AccessionCatalog>;

/** The catalog file exists but cannot be read or does not satisfy the schema. */
export class AccessionCatalogLoadError extends Error {
  readonly catalogPath: string;

  constructor(catalogPath: string, cause: unknown) {
    super(
      `The accession catalog at ${catalogPath} cannot be loaded and will not be changed until it ` +
        `is fixed or moved aside.\n${cause instanceof Error ? cause.message : String(cause)}`,
      {cause},
    );
    this.name = 'AccessionCatalogLoadError';
    this.catalogPath = catalogPath;
  }
}

/** Another writer changed the catalog after it was loaded, so the edit was not applied. */
export class AccessionCatalogChangedError extends Error {
  constructor() {
    super('The accession catalog was changed by another GenoPilot window. Reload it and try again.');
    this.name = 'AccessionCatalogChangedError';
  }
}

const store = createCatalogStore<AccessionCatalog>({
  parse: parseAccessionCatalog,
  validate: validateAccessionCatalog,
  empty: emptyAccessionCatalog,
  loadError: (path, cause) => new AccessionCatalogLoadError(path, cause),
  changedError: () => new AccessionCatalogChangedError(),
  busyMessage: 'Another GenoPilot window is saving the accession catalog. Try again.',
});

export const loadAccessionCatalog = store.load;

export const updateAccessionCatalog = store.update;
