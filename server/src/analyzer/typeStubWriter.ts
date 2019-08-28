/*
* typeStubWriter.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic to emit a type stub file for a corresponding parsed
* and analyzed python source file.
*/

import { ParseTreeWalker } from './parseTreeWalker';
import { SourceFile } from './sourceFile';

export class TypeStubWriter extends ParseTreeWalker {
    constructor(private _targetImportPath: string,
            private _typingsPath: string,
            private _sourceFile: SourceFile) {

        super();
    }

    write() {
        // TODO - need to implement
    }
}
