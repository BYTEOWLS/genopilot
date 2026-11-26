import {GenomeProviderRegistry} from './provider.js';
import {ncbiProvider} from './ncbi.js';

/** Packaged providers are registered here, never in screens or download dispatchers. */
export const genomeSources = new GenomeProviderRegistry([ncbiProvider]);
