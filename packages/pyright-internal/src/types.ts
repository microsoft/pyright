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
    hoverContentFormat: MarkupKind;
    completionDocFormat: MarkupKind;
    completionSupportsSnippet: boolean;
    signatureDocFormat: MarkupKind;
    supportsDeprecatedDiagnosticTag: boolean;
    supportsUnnecessaryDiagnosticTag: boolean;
    supportsTaskItemDiagnosticTag: boolean;
    completionItemResolveSupportsAdditionalTextEdits: boolean;
    usingPullDiagnostics: boolean;
    requiresPullRelatedInformationCapability: boolean;
}

export type InitializationOptions = {
    diagnosticMode?: string;
    disablePullDiagnostics?: boolean;
};
