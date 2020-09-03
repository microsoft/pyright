// Stash the base directory into a global variable.
(global as any).__rootDirectory = __dirname + '/dist/';

import { main } from 'pyright-internal/pyright';

main();
