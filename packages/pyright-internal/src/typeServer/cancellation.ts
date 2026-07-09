import { LSPErrorCodes, ResponseError } from 'vscode-languageserver';

export class ServerCanceledException extends ResponseError<void> {
    constructor(message?: string | undefined) {
        super(LSPErrorCodes.ServerCancelled, message || 'server cancelled');
    }

    static is(e: any): e is ServerCanceledException {
        return e.code === LSPErrorCodes.ServerCancelled;
    }
}
