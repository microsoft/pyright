/*
 * types.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Types used for language server capabilities.
 */
import { MarkupKind } from 'vscode-languageserver-types';

export interface ClientCapabilities {
    hasConfigurationCapability: boolean;
    hasVisualStudioExtensionsCapability: boolean;
    hasWorkspaceFoldersCapability: boolean;
    hasWatchFileCapability: boolean;
    hasWatchFileRelativePathCapability: boolean;
    hasActiveParameterCapability: boolean;
    hasSignatureLabelOffsetCapability: boolean;
    hasHierarchicalDocumentSymbolCapability: boolean;
    hasWindowProgressCapability: boolean;
    hasGoToDeclarationCapability: boolean;
    hasDocumentChangeCapability: boolean;
    hasDocumentAnnotationCapability: boolean;
    hasCompletionCommitCharCapability: boolean;
    // Client supports `CompletionList.itemDefaults.data` (LSP 3.17) together with
    // `CompletionList.applyKind` merge semantics (LSP 3.18). When set, the server can
    // hoist the shared completion item `data` (uri/position) into `itemDefaults.data`
    // and request a shallow merge, avoiding sending the same data on every item.
    hasCompletionItemDataDefaultCapability: boolean;
    hoverContentFormat: MarkupKind;
    completionDocFormat: MarkupKind;
    completionSupportsSnippet: boolean;
    signatureDocFormat: MarkupKind;
    supportsDeprecatedDiagnosticTag: boolean;
    supportsUnnecessaryDiagnosticTag: boolean;
    supportsTaskItemDiagnosticTag: boolean;
    completionItemResolveSupportsAdditionalTextEdits: boolean;
    supportsPullDiagnostics: boolean;
    requiresPullRelatedInformationCapability: boolean;
}

export type InitializationOptions = {
    diagnosticMode?: string;
    disablePullDiagnostics?: boolean;
};
