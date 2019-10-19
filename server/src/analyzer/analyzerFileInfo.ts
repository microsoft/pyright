/*
* analyzerFileInfo.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Input type common to multiple analyzer passes.
*/

import { DiagnosticSettings, ExecutionEnvironment } from '../common/configOptions';
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Scope } from './scope';
import { SymbolTable } from './symbol';

// Maps import paths to the parse tree for the imported module.
export type ImportMap = Map<string, SymbolTable>;

export interface AnalyzerFileInfo {
    importMap: ImportMap;
    futureImports: StringMap<boolean>;
    builtinsScope?: Scope;
    typingModulePath?: string;
    diagnosticSink: TextRangeDiagnosticSink;
    executionEnvironment: ExecutionEnvironment;
    diagnosticSettings: DiagnosticSettings;
    lines: TextRangeCollection<TextRange>;
    filePath: string;
    isStubFile: boolean;
    isTypingStubFile: boolean;
    isBuiltInStubFile: boolean;
}
