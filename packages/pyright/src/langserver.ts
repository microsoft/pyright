import { main } from 'pyright-internal/nodeMain';

// Command line version doesn't use any worker threads.
main(/* maxWorkers */ 0);
