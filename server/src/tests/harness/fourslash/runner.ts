/*
* runner.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

import * as io from "../io"
import { combinePaths } from "../../../common/pathUtils";
import { parseTestData } from "./fourSlashParser";
import { TestState } from "./testState";
import * as ts from "typescript"

export function runFourSlashTest(basePath: string, fileName: string) {
    const content = (io.IO.readFile(fileName)!);
    runFourSlashTestContent(basePath, fileName, content);
}

export function runFourSlashTestContent(basePath: string, fileName: string, content: string) {
    // give file paths an absolute path for the virtual file system
    const absoluteBasePath = combinePaths("/", basePath);
    const absoluteFileName = combinePaths("/", fileName);

    // parse out the files and their metadata
    const testData = parseTestData(absoluteBasePath, content, absoluteFileName);
    const state = new TestState(absoluteBasePath, testData);
    const output = ts.transpileModule(content, { reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2015 } });
    if (output.diagnostics!.length > 0) {
        throw new Error(`Syntax error in ${ absoluteBasePath }: ${ output.diagnostics![0].messageText }`);
    }

    runCode(output.outputText, state);
}

function runCode(code: string, state: TestState): void {
    // Compile and execute the test
    const wrappedCode =
        `(function(helper) {
${ code }
})`;

    const f = eval(wrappedCode);
    f(state);
}