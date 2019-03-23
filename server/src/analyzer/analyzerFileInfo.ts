/*
* analyzerFileInfo.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Input type common to multiple analyzer passes.
*/

import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { ParseResults } from '../parser/parser';
import { Scope } from './scope';

// Maps import paths to the parse tree for the imported module.
export type ImportMap = { [importPath: string]: ParseResults };

export interface AnalyzerFileInfo {
    importMap: ImportMap;
    builtinsScope?: Scope;
    diagnosticSink: TextRangeDiagnosticSink;
    executionEnvironment: ExecutionEnvironment;
    configOptions: ConfigOptions;
    lines: TextRangeCollection<TextRange>;
    filePath: string;
    isStubFile: boolean;
    isTypingStubFile: boolean;
    isCollectionsStubFile: boolean;
    console: ConsoleInterface;
}
