/*
 * importStatementCandidates.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shared helpers that enumerate the candidate names valid at an import-statement
 * position. These are the same candidate sources the completion provider uses,
 * extracted so that the change-spelling code action can offer near-name
 * replacements from the identical corpus instead of the auto-import index.
 */

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { ImportedModuleDescriptor, ImportResolver } from '../analyzer/importResolver';
import { ImplicitImport, ImportResult } from '../analyzer/importResult';
import { SymbolTable } from '../analyzer/symbol';
import { ExecutionEnvironment } from '../common/configOptions';
import { ProgramView } from '../common/extensibility';
import { Uri } from '../common/uri/uri';
import { ImportFromNode, ModuleNameNode } from '../parser/parseNodes';

// Builds the module descriptor used to enumerate module-name completion candidates
// for the module-name position (`import X`, `from X import ...`).
//
// When `enumerateAll` is true, the final (typed) name segment is dropped so the
// resolver returns the full set of siblings under the parent package. This is
// used by the change-spelling code action, where the typed segment is a
// misspelling rather than a prefix and must be matched by edit distance. When
// false (completion), the typed segment is kept and used as a prefix filter.
export function createModuleNameCompletionDescriptor(
    moduleNode: ModuleNameNode,
    enumerateAll = false
): ImportedModuleDescriptor {
    const nameParts = moduleNode.d.nameParts.map((part) => part.d.value);
    let hasTrailingDot = moduleNode.d.hasTrailingDot || false;

    if (enumerateAll && !hasTrailingDot && nameParts.length > 0) {
        // Drop the misspelled final segment and enumerate everything under its
        // parent so edit-distance matching has the full sibling corpus.
        nameParts.pop();
        hasTrailingDot = nameParts.length > 0 || moduleNode.d.leadingDots > 0;
    }

    return {
        leadingDots: moduleNode.d.leadingDots,
        hasTrailingDot,
        nameParts,
        importedSymbols: new Set<string>(),
    };
}

// Enumerates module-name completion candidates for the module-name position
// (`import X`, `from X import ...`). See `createModuleNameCompletionDescriptor`
// for the meaning of `enumerateAll`.
export function getModuleNameCompletionSuggestions(
    importResolver: ImportResolver,
    fileUri: Uri,
    execEnv: ExecutionEnvironment,
    moduleNode: ModuleNameNode,
    enumerateAll = false
): Map<string, Uri> {
    const moduleDescriptor = createModuleNameCompletionDescriptor(moduleNode, enumerateAll);
    return importResolver.getCompletionSuggestions(fileUri, execEnv, moduleDescriptor);
}

// Resolves the target module of a `from X import ...` statement and returns its
// top-level (module-scope) symbol table and implicit submodule imports. The symbol
// table is the raw module scope: it can include non-exported / underscore-private
// names and is not filtered by `__all__` or visibility. Callers that need
// completion-style filtering must apply it themselves.
export function getImportFromTarget(program: ProgramView, importFromNode: ImportFromNode): ImportFromTarget {
    const importInfo = AnalyzerNodeInfo.getImportInfo(importFromNode.d.module);
    if (!importInfo) {
        return { hasParseResults: false };
    }

    const resolvedPath =
        importInfo.resolvedUris.length > 0 ? importInfo.resolvedUris[importInfo.resolvedUris.length - 1] : Uri.empty();

    const parseResults = program.getParseResults(resolvedPath);
    if (!parseResults) {
        return { importInfo, hasParseResults: false, implicitImports: importInfo.implicitImports };
    }

    const symbolTable = AnalyzerNodeInfo.getScope(parseResults.parserOutput.parseTree)?.symbolTable;
    return { importInfo, hasParseResults: true, symbolTable, implicitImports: importInfo.implicitImports };
}

// Result of resolving the target of a `from X import ...` statement: the module's
// raw top-level (module-scope) symbol table plus its implicit submodule imports. The
// symbol table is not export/visibility filtered, so it can contain non-exported and
// underscore-private names.
export interface ImportFromTarget {
    importInfo?: ImportResult;
    // True if the target module's source was parsed. When false, only implicit
    // submodule imports are available (mirrors the completion provider's behavior).
    hasParseResults: boolean;
    symbolTable?: SymbolTable;
    implicitImports?: Map<string, ImplicitImport>;
}
