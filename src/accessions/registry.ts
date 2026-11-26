import {GenomeProviderRegistry} from './provider.js';
import {ncbiProvider} from './provider/ncbi/index.js';

/** Packaged providers are registered here, never in screens or download dispatchers. */
export const genomeSources = new GenomeProviderRegistry([ncbiProvider]);
