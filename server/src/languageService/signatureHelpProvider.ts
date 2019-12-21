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

import { extractParameterDocumentation } from '../analyzer/docStringUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { FunctionType, OverloadedFunctionType,
    TypeCategory } from '../analyzer/types';
import { doForSubtypes } from '../analyzer/typeUtils';
import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { CallNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export interface ParamInfo {
    startOffset: number;
    endOffset: number;
    documentation?: string;
}

export interface SignatureInfo {
    label: string;
    documentation?: string;
    parameters?: ParamInfo[];
}

export interface SignatureHelpResults {
    signatures: SignatureInfo[];
    activeSignature?: number;
    activeParameter?: number;
}

export class SignatureHelpProvider {
    static getSignatureHelpForPosition(parseResults: ParseResults, position: DiagnosticTextPosition,
            evaluator: TypeEvaluator):
                SignatureHelpResults | undefined {

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
        let curOffset = offset;
        while (curOffset >= 0) {
            curOffset--;
            const curNode = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, curOffset);
            if (curNode && curNode !== initialNode) {
                if (ParseTreeUtils.getNodeDepth(curNode) > initialDepth) {
                    node = curNode;
                }
                break;
            }
        }

        if (node === undefined) {
            return undefined;
        }

        const callNode = this._findContainingCallNode(node);
        if (callNode === undefined) {
            return undefined;
        }

        if (offset > TextRange.getEnd(callNode)) {
            return undefined;
        }

        const callType = evaluator.getType(callNode.leftExpression);
        if (callType === undefined) {
            return undefined;
        }

        // Determine which argument is currently "active".
        let activeParameter = 0;
        const args = callNode.arguments;
        for (let i = args.length - 1; i >= 0; i--) {
            if (offset > TextRange.getEnd(args[i].valueExpression)) {
                activeParameter = i + 1;
                break;
            }

            if (offset >= args[i].valueExpression.start) {
                activeParameter = i;
                break;
            }
        }

        const results: SignatureHelpResults = {
            signatures: [],
            activeParameter
        };

        doForSubtypes(callType, subtype => {
            switch (subtype.category) {
                case TypeCategory.Function:
                case TypeCategory.OverloadedFunction: {
                    this._addSignatureToResults(results, subtype, evaluator);
                    break;
                }

                case TypeCategory.Class: {
                    // Try to get the __new__ method first. We skip the base "object",
                    // which typically provides the __new__ method. We'll fall back on
                    // the __init__ if there is no custom __new__.
                    let methodType = evaluator.getBoundMethod(subtype, '__new__', true);
                    if (!methodType) {
                        methodType = evaluator.getBoundMethod(subtype, '__init__', false);
                    }
                    if (methodType) {
                        this._addSignatureToResults(results, methodType, evaluator);
                    }
                    break;
                }

                case TypeCategory.Object: {
                    const methodType = evaluator.getBoundMethod(
                        subtype.classType, '__call__', false);
                    if (methodType) {
                        this._addSignatureToResults(results, methodType, evaluator);
                    }
                    break;
                }
            }

            return undefined;
        });

        return results;
    }

    private static _addSignatureToResults(results: SignatureHelpResults,
            type: FunctionType | OverloadedFunctionType, evaluator: TypeEvaluator) {

        if (type.category === TypeCategory.Function) {
            results.signatures.push(this._makeSignature(type, evaluator));
        } else if (type.category === TypeCategory.OverloadedFunction) {
            type.overloads.forEach(overload => {
                results.signatures.push(this._makeSignature(overload, evaluator));
            });
        }
    }

    private static _makeSignature(functionType: FunctionType, evaluator: TypeEvaluator): SignatureInfo {
        const stringParts = evaluator.printFunctionParts(functionType);
        const parameters: ParamInfo[] = [];
        const functionDocString = functionType.details.docString;
        let label = '(';

        stringParts[0].forEach((paramString: string, paramIndex) => {
            const paramName = functionType.details.parameters[paramIndex].name || '';
            parameters.push({
                startOffset: label.length,
                endOffset: label.length + paramString.length,
                documentation: extractParameterDocumentation(functionDocString || '', paramName)
            });

            label += paramString;
            if (paramIndex < stringParts[0].length - 1) {
                label += ', ';
            }
        });

        label += ') -> ' + stringParts[1];

        const sigInfo: SignatureInfo = {
            label,
            parameters,
            documentation: functionDocString
        };

        return sigInfo;
    }

    private static _findContainingCallNode(node: ParseNode): CallNode | undefined {
        let curNode: ParseNode | undefined = node;

        while (curNode !== undefined) {
            if (curNode.nodeType === ParseNodeType.Call) {
                return curNode;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }
}
