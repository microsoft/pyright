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
export interface AbsoluteModuleDescriptor {
    importingFilePath: string;
    nameParts: string[];
}
export type ImportLookup = (filePathOrModule: string | AbsoluteModuleDescriptor) => ImportLookupResult | undefined;

export interface ImportLookupResult {
    symbolTable: SymbolTable;
    dunderAllNames: string[] | undefined;
    usesUnsupportedDunderAllForm: boolean;
    docString: string | undefined;
}

export interface AnalyzerFileInfo {
    importLookup: ImportLookup;
    futureImports: Map<string, boolean>;
    builtinsScope?: Scope | undefined;
    diagnosticSink: TextRangeDiagnosticSink;
    executionEnvironment: ExecutionEnvironment;
    diagnosticRuleSet: DiagnosticRuleSet;
    fileContents: string;
    lines: TextRangeCollection<TextRange>;
    typingSymbolAliases: Map<string, string>;
    filePath: string;
    moduleName: string;
    isStubFile: boolean;
    isTypingStubFile: boolean;
    isTypingExtensionsStubFile: boolean;
    isBuiltInStubFile: boolean;
    isInPyTypedPackage: boolean;
    isIPythonMode: boolean;
    accessedSymbolMap: Map<number, true>;
}
