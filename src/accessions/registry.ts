import {GenomeProviderRegistry} from './provider.js';
import {ncbiProvider} from './provider/ncbi/index.js';
import {veupathdbProvider} from './provider/veupathdb/index.js';

/** Packaged providers are registered here, never in screens or download dispatchers. */
export const accessionSources = new GenomeProviderRegistry([ncbiProvider, veupathdbProvider]);
