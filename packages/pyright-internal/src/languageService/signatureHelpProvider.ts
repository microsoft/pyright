/*
 * signatureHelpProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that maps a position within a Python call node into info
 * that can be presented to the developer to help fill in the remaining
 * arguments for the call.
 */

import { CancellationToken, MarkupContent, MarkupKind } from 'vscode-languageserver';

import { convertDocStringToMarkdown, convertDocStringToPlainText } from '../analyzer/docStringConversion';
import { extractParameterDocumentation } from '../analyzer/docStringUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { getCallNodeAndActiveParameterIndex } from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { CallSignature, TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { PrintTypeFlags } from '../analyzer/typePrinter';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertPositionToOffset } from '../common/positionUtils';
import { Position } from '../common/textRange';
import { CallNode, NameNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { getDocumentationPartsForTypeAndDecl, getFunctionDocStringFromType } from './tooltipUtils';

export interface ParamInfo {
    startOffset: number;
    endOffset: number;
    text: string;
    documentation?: string | undefined;
}

export interface SignatureInfo {
    label: string;
    documentation?: MarkupContent | undefined;
    parameters?: ParamInfo[] | undefined;
    activeParameter?: number | undefined;
}

export interface SignatureHelpResults {
    signatures: SignatureInfo[];
    callHasParameters: boolean;
}

export class SignatureHelpProvider {
    static getSignatureHelpForPosition(
        parseResults: ParseResults,
        position: Position,
        sourceMapper: SourceMapper,
        evaluator: TypeEvaluator,
        format: MarkupKind,
        token: CancellationToken
    ): SignatureHelpResults | undefined {
        throwIfCancellationRequested(token);

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);

        // See if we can get to a "better" node by backing up a few columns.
        // A "better" node is defined as one that's deeper than the current
        // node.
        const initialNode = node;
        const initialDepth = node ? ParseTreeUtils.getNodeDepth(node) : 0;
        let curOffset = offset - 1;
        while (curOffset >= 0) {
            // Don't scan back across a comma because commas separate
            // arguments, and we don't want to mistakenly think that we're
            // pointing to a previous argument. Don't scan across open parenthesis so that
            // we don't go into the wrong function call
            const ch = parseResults.text.substr(curOffset, 1);
            if (ch === ',' || ch === '(') {
                break;
            }
            const curNode = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, curOffset);
            if (curNode && curNode !== initialNode) {
                if (ParseTreeUtils.getNodeDepth(curNode) > initialDepth) {
                    node = curNode;
                }
                break;
            }

            curOffset--;
        }

        if (node === undefined) {
            return undefined;
        }

        const callInfo = getCallNodeAndActiveParameterIndex(node, offset, parseResults.tokenizerOutput.tokens);
        if (!callInfo) {
            return;
        }

        const callSignatureInfo = evaluator.getCallSignatureInfo(
            callInfo.callNode,
            callInfo.activeIndex,
            callInfo.activeOrFake
        );
        if (!callSignatureInfo) {
            return undefined;
        }

        const signatures = callSignatureInfo.signatures.map((sig) =>
            this._makeSignature(callSignatureInfo.callNode, sig, sourceMapper, evaluator, format)
        );
        const callHasParameters = !!callSignatureInfo.callNode.arguments?.length;

        return {
            signatures,
            callHasParameters,
        };
    }

    private static _makeSignature(
        callNode: CallNode,
        signature: CallSignature,
        sourceMapper: SourceMapper,
        evaluator: TypeEvaluator,
        format: MarkupKind
    ): SignatureInfo {
        const functionType = signature.type;
        const stringParts = evaluator.printFunctionParts(functionType, PrintTypeFlags.ExpandTypedDictArgs);
        const parameters: ParamInfo[] = [];
        const functionDocString =
            getFunctionDocStringFromType(functionType, sourceMapper, evaluator) ??
            this._getDocStringFromCallNode(callNode, sourceMapper, evaluator);

        let label = '(';
        let activeParameter: number | undefined;
        const params = functionType.details.parameters;

        stringParts[0].forEach((paramString: string, paramIndex) => {
            let paramName = '';
            if (paramIndex < params.length) {
                paramName = params[paramIndex].name || '';
            } else if (params.length > 0) {
                paramName = params[params.length - 1].name || '';
            }

            if (paramName && !paramString.includes(paramName) && paramName === 'kwargs') {
                // Param string may have been expanded from kwargs.
                // Pull out the param name from the string.
                const match = /^(\w+):/.exec(paramString);
                if (match && match.length > 1) {
                    paramName = match[1];
                }
            }

            parameters.push({
                startOffset: label.length,
                endOffset: label.length + paramString.length,
                text: paramString,
                documentation: extractParameterDocumentation(functionDocString || '', paramName),
            });

            // Name match for active parameter as the set of parameters from the function
            // may not match the actual string output from the typeEvaluator (kwargs for TypedDict is an example).
            if (paramName && signature.activeParam && signature.activeParam.name === paramName) {
                activeParameter = paramIndex;
            }

            label += paramString;
            if (paramIndex < stringParts[0].length - 1) {
                label += ', ';
            }
        });

        label += ') -> ' + stringParts[1];

        if (signature.activeParam && activeParameter === undefined) {
            activeParameter = params.indexOf(signature.activeParam);
            if (activeParameter === -1) {
                activeParameter = undefined;
            }
        }

        const sigInfo: SignatureInfo = {
            label,
            parameters,
            activeParameter,
        };

        if (functionDocString) {
            if (format === MarkupKind.Markdown) {
                sigInfo.documentation = {
                    kind: MarkupKind.Markdown,
                    value: convertDocStringToMarkdown(functionDocString),
                };
            } else {
                sigInfo.documentation = {
                    kind: MarkupKind.PlainText,
                    value: convertDocStringToPlainText(functionDocString),
                };
            }
        }

        return sigInfo;
    }

    private static _getDocStringFromCallNode(
        callNode: CallNode,
        sourceMapper: SourceMapper,
        evaluator: TypeEvaluator
    ): string | undefined {
        // This is a heuristic to see whether we can get some docstring
        // from call node when all other methods failed.
        // It only works if call is off a name node.
        let name: NameNode | undefined;
        const expr = callNode.leftExpression;
        if (expr.nodeType === ParseNodeType.Name) {
            name = expr;
        } else if (expr.nodeType === ParseNodeType.MemberAccess) {
            name = expr.memberName;
        }

        if (!name) {
            return undefined;
        }

        for (const decl of evaluator.getDeclarationsForNameNode(name) ?? []) {
            const resolveDecl = evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
            if (!resolveDecl) {
                continue;
            }

            const type = evaluator.getType(name);
            if (!type) {
                continue;
            }

            const part = getDocumentationPartsForTypeAndDecl(sourceMapper, type, resolveDecl, evaluator);
            if (part) {
                return part;
            }
        }

        return undefined;
    }
}
