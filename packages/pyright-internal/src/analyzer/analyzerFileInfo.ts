/*
 * analyzerFileInfo.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Information associated with a source file that is used
 * by the binder and checker.
 */

import { DiagnosticRuleSet, ExecutionEnvironment } from '../common/configOptions';
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Scope } from './scope';
import { SymbolTable } from './symbol';

// Maps import paths to the symbol table for the imported module.
export type ImportLookup = (filePath: string) => ImportLookupResult | undefined;

export interface ImportLookupResult {
    symbolTable: SymbolTable;
    dunderAllNames: string[] | undefined;
    docString: string | undefined;
}

export interface AnalyzerFileInfo {
    importLookup: ImportLookup;
    futureImports: Map<string, boolean>;
    builtinsScope?: Scope | undefined;
    typingModulePath?: string | undefined;
    typeshedModulePath?: string | undefined;
    collectionsModulePath?: string | undefined;
    diagnosticSink: TextRangeDiagnosticSink;
    executionEnvironment: ExecutionEnvironment;
    diagnosticRuleSet: DiagnosticRuleSet;
    fileContents: string;
    lines: TextRangeCollection<TextRange>;
    filePath: string;
    moduleName: string;
    isStubFile: boolean;
    isTypingStubFile: boolean;
    isTypingExtensionsStubFile: boolean;
    isBuiltInStubFile: boolean;
    isInPyTypedPackage: boolean;
    accessedSymbolMap: Map<number, true>;
}
