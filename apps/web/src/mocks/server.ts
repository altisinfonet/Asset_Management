import { setupServer } from 'msw/node';
import { handlers } from './handlers';

/** Node (vitest) mock server with the same handlers as the browser worker. */
export const server = setupServer(...handlers);
