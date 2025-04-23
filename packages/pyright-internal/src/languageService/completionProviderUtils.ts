/*
 * completionProviderUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions for providing completions
 */

import { InsertTextFormat, MarkupContent, MarkupKind, TextEdit } from 'vscode-languageserver-types';

import { Declaration, DeclarationType } from '../analyzer/declaration';
import { isBuiltInModule } from '../analyzer/typeDocStringUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { isProperty } from '../analyzer/typeUtils';
import {
    ClassType,
    Type,
    TypeBase,
    TypeCategory,
    UnknownType,
    getTypeAliasInfo,
    isClassInstance,
    isFunctionOrOverloaded,
    isModule,
} from '../analyzer/types';
import { SignatureDisplayType } from '../common/configOptions';
import { TextEditAction } from '../common/editAction';
import { ServiceProvider } from '../common/serviceProvider';
import { Uri } from '../common/uri/uri';
import { getToolTipForType } from './tooltipUtils';

export interface Edits {
    format?: InsertTextFormat;
    textEdit?: TextEdit;
    additionalTextEdits?: TextEditAction[];
}

export interface CommonDetail {
    funcParensDisabled?: boolean;
    edits?: Edits;
    extraCommitChars?: boolean;
}

export interface SymbolDetail extends CommonDetail {
    autoImportSource?: string;
    autoImportAlias?: string;
    boundObjectOrClass?: ClassType;
}

export interface CompletionDetail extends CommonDetail {
    typeDetail?: string;
    documentation?: string;
    autoImportText?: {
        source: string;
        importText: string;
    };
    sortText?: string;
    itemDetail?: string;
    moduleUri?: Uri;
}

export function getTypeDetail(
    evaluator: TypeEvaluator,
    type: Type,
    primaryDecl: Declaration | undefined,
    name: string,
    detail: SymbolDetail | undefined,
    functionSignatureDisplay: SignatureDisplayType
) {
    if (!primaryDecl) {
        if (isModule(type)) {
            // Special casing import modules.
            // submodule imported through `import` statement doesn't have
            // corresponding decls. so use given name as it is.
            //
            // ex) import X.Y
            // X.[Y]
            return name;
        }

        return;
    }

    switch (primaryDecl.type) {
        case DeclarationType.Intrinsic:
        case DeclarationType.Variable:
        case DeclarationType.Param:
        case DeclarationType.TypeParam: {
            let expandTypeAlias = false;
            if (type && TypeBase.isInstantiable(type)) {
                const typeAliasInfo = getTypeAliasInfo(type);
                if (typeAliasInfo) {
                    if (typeAliasInfo.shared.name === name) {
                        expandTypeAlias = true;
                    }
                }
            }
            // Handle the case where type is a function and was assigned to a variable.
            if (type.category === TypeCategory.Overloaded || type.category === TypeCategory.Function) {
                return getToolTipForType(
                    type,
                    /* label */ '',
                    name,
                    evaluator,
                    /* isProperty */ false,
                    functionSignatureDisplay
                );
            } else {
                return name + ': ' + evaluator.printType(type, { expandTypeAlias });
            }
        }

        case DeclarationType.Function: {
            const functionType =
                detail?.boundObjectOrClass && isFunctionOrOverloaded(type)
                    ? evaluator.bindFunctionToClassOrObject(detail.boundObjectOrClass, type)
                    : type;
            if (!functionType) {
                return undefined;
            }

            if (isProperty(functionType) && detail?.boundObjectOrClass && isClassInstance(detail.boundObjectOrClass)) {
                const propertyType =
                    evaluator.getGetterTypeFromProperty(functionType as ClassType) || UnknownType.create();
                return name + ': ' + evaluator.printType(propertyType) + ' (property)';
            }

            return getToolTipForType(
                functionType,
                /* label */ '',
                name,
                evaluator,
                /* isProperty */ false,
                functionSignatureDisplay
            );
        }

        case DeclarationType.Class:
        case DeclarationType.SpecialBuiltInClass: {
            return 'class ' + name + '()';
        }

        case DeclarationType.Alias: {
            return name;
        }

        default: {
            return name;
        }
    }
}

export function getCompletionItemDocumentation(
    serviceProvider: ServiceProvider,
    typeDetail: string | undefined,
    documentation: string | undefined,
    markupKind: MarkupKind,
    declaration: Declaration | undefined
): MarkupContent | undefined {
    if (markupKind === MarkupKind.Markdown) {
        let markdownString = '```python\n' + typeDetail + '\n```\n';

        if (documentation) {
            markdownString += '---\n';
            markdownString += serviceProvider
                .docStringService()
                .convertDocStringToMarkdown(documentation, isBuiltInModule(declaration?.uri));
        }

        markdownString = markdownString.trimEnd();

        return {
            kind: MarkupKind.Markdown,
            value: markdownString,
        };
    } else if (markupKind === MarkupKind.PlainText) {
        let plainTextString = typeDetail + '\n';

        if (documentation) {
            plainTextString += '\n';
            plainTextString += serviceProvider.docStringService().convertDocStringToPlainText(documentation);
        }

        plainTextString = plainTextString.trimEnd();

        return {
            kind: MarkupKind.PlainText,
            value: plainTextString,
        };
    }
    return undefined;
}
