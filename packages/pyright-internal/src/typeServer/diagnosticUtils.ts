/*
 * diagnosticUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Converts Pyright's internal diagnostics into LSP diagnostics for the type server.
 * This mirrors `LanguageServerBase._convertDiagnostics`; the Pylance-only VS "task item"
 * ranking is omitted (task-item diagnostics are dropped, matching Pyright's own server).
 */

import {
    Diagnostic,
    DiagnosticRelatedInformation,
    DiagnosticSeverity,
    DiagnosticTag,
    Location,
} from 'vscode-languageserver';

import { Diagnostic as PyrightDiagnostic, DiagnosticCategory } from '../common/diagnostic';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { convertUriToLspUriString } from '../common/uri/uriUtils';
import { canNavigateToFile } from '../languageService/navigationUtils';

function convertCategoryToSeverity(category: DiagnosticCategory): DiagnosticSeverity {
    switch (category) {
        case DiagnosticCategory.Error:
            return DiagnosticSeverity.Error;

        case DiagnosticCategory.Warning:
            return DiagnosticSeverity.Warning;

        case DiagnosticCategory.Information:
        case DiagnosticCategory.TaskItem:
            return DiagnosticSeverity.Information;

        case DiagnosticCategory.UnusedCode:
        case DiagnosticCategory.UnreachableCode:
        case DiagnosticCategory.Deprecated:
            return DiagnosticSeverity.Hint;
    }
}

export function convertFromPyrightDiagnostic(
    diag: PyrightDiagnostic,
    fs: ReadOnlyFileSystem,
    supportsUnnecessaryDiagnosticTag: boolean,
    supportsTaskItemDiagnosticTag: boolean
): Diagnostic | undefined {
    const severity = convertCategoryToSeverity(diag.category);
    const rule = diag.getRule();
    const vsDiag = Diagnostic.create(diag.range, diag.message, severity, rule, 'pyright');

    // Save all of the actions in the data.
    const actions = diag.getActions();
    if (actions?.length) {
        vsDiag.data = { ...vsDiag.data, actions: actions };
    }

    if (diag.category === DiagnosticCategory.UnusedCode || diag.category === DiagnosticCategory.UnreachableCode) {
        vsDiag.tags = [DiagnosticTag.Unnecessary];
        vsDiag.severity = DiagnosticSeverity.Hint;
        vsDiag.data = { ...vsDiag.data, category: diag.category, rule: rule };

        // If the client doesn't support "unnecessary" tags, don't report unused code.
        if (!supportsUnnecessaryDiagnosticTag) {
            return undefined;
        }
    } else if (diag.category === DiagnosticCategory.Deprecated) {
        vsDiag.tags = [DiagnosticTag.Deprecated];
        vsDiag.severity = DiagnosticSeverity.Hint;

        // If the client doesn't support "deprecated" tags, don't report.
        if (!supportsUnnecessaryDiagnosticTag) {
            return undefined;
        }
    } else if (diag.category === DiagnosticCategory.TaskItem) {
        // Task items are a Pylance/VS-only concept; drop them unless the client opted in.
        if (!supportsTaskItemDiagnosticTag) {
            return undefined;
        }
    }

    const relatedInfo = diag.getRelatedInfo();
    if (relatedInfo.length > 0) {
        vsDiag.relatedInformation = relatedInfo
            .filter((info) => canNavigateToFile(fs, info.uri))
            .map((info) =>
                DiagnosticRelatedInformation.create(
                    Location.create(convertUriToLspUriString(fs, info.uri), info.range),
                    info.message
                )
            );
    }

    return vsDiag;
}
