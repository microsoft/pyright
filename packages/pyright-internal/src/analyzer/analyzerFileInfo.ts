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
import { PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Scope } from './scope';
import { IPythonMode } from './sourceFile';
import { SymbolTable } from './symbol';

// Maps import paths to the symbol table for the imported module.
export interface AbsoluteModuleDescriptor {
    importingFilePath: string;
    nameParts: string[];
}

export interface LookupImportOptions {
    skipFileNeededCheck: boolean;
}

export type ImportLookup = (
    filePathOrModule: string | AbsoluteModuleDescriptor,
    options?: LookupImportOptions
) => ImportLookupResult | undefined;

export interface ImportLookupResult {
    symbolTable: SymbolTable;
    dunderAllNames: string[] | undefined;
    usesUnsupportedDunderAllForm: boolean;
    docString: string | undefined;
    isInPyTypedPackage: boolean;
}

export interface AnalyzerFileInfo {
    importLookup: ImportLookup;
    futureImports: Set<string>;
    builtinsScope?: Scope | undefined;
    diagnosticSink: TextRangeDiagnosticSink;
    executionEnvironment: ExecutionEnvironment;
    diagnosticRuleSet: DiagnosticRuleSet;
    fileContents: string;
    lines: TextRangeCollection<TextRange>;
    typingSymbolAliases: Map<string, string>;
    definedConstants: Map<string, boolean | string>;
    filePath: string;
    moduleName: string;
    isStubFile: boolean;
    isTypingStubFile: boolean;
    isTypingExtensionsStubFile: boolean;
    isBuiltInStubFile: boolean;
    isInPyTypedPackage: boolean;
    ipythonMode: IPythonMode;
    accessedSymbolSet: Set<number>;
}

export function isAnnotationEvaluationPostponed(fileInfo: AnalyzerFileInfo) {
    if (fileInfo.isStubFile) {
        return true;
    }

    if (fileInfo.futureImports.has('annotations')) {
        return true;
    }

    // As of November 22, the Python steering council has tentatively
    // approved PEP 649 for Python 3.12.
    // https://discuss.python.org/t/pep-649-deferred-evaluation-of-annotations-tentatively-accepted/21331
    if (fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V3_12) {
        return true;
    }

    return false;
}
