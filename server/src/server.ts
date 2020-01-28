/*
* server.ts
*
* Implements pyright language server.
*/

import { LanguageServerBase } from "./languageServerBase";

class Server extends LanguageServerBase {
    constructor() {
        super("Pyright");
    }
}

export const server = new Server();
