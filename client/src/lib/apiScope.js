// Shared screens (comments, file links, the bell) talk to the internal API by default.
// Inside the client portal they must use /portal/* instead (D-40): PortalLayout sets
// this to '/portal', and the hooks read it.
import { createContext, useContext } from 'react';

export const ApiScopeContext = createContext('');
/** '' for the internal app, '/portal' inside the client portal. */
export const useApiBase = () => useContext(ApiScopeContext);
