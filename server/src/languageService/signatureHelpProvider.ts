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

import { AnalyzerNodeInfo } from '../analyzer/analyzerNodeInfo';
import { ParseTreeUtils } from '../analyzer/parseTreeUtils';
import { ClassType, FunctionType, ObjectType,
    OverloadedFunctionType } from '../analyzer/types';
import { ClassMemberLookupFlags, TypeUtils } from '../analyzer/typeUtils';
import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { CallExpressionNode, ParseNode } from '../parser/parseNodes';
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
    static getSignatureHelpForPosition(parseResults: ParseResults, fileContents: string,
            position: DiagnosticTextPosition): SignatureHelpResults | undefined {

        const offset = convertPositionToOffset(position, parseResults.lines);
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

        if (offset > callNode.end) {
            return undefined;
        }

        const callType = AnalyzerNodeInfo.getExpressionType(callNode.leftExpression);
        if (callType === undefined) {
            return undefined;
        }

        // Determine which argument is currently "active".
        let activeParameter = 0;
        const args = callNode.arguments;
        for (let i = args.length - 1; i >= 0; i--) {
            if (offset > args[i].valueExpression.end) {
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

        TypeUtils.doForSubtypes(callType, subtype => {
            if (subtype instanceof FunctionType || subtype instanceof OverloadedFunctionType) {
                this._addSignatureToResults(results, subtype);
            } else if (subtype instanceof ClassType) {
                const methodType = this._getBoundMethod(subtype, '__init__');
                if (methodType) {
                    this._addSignatureToResults(results, methodType);
                }
            } else if (subtype instanceof ObjectType) {
                const methodType = this._getBoundMethod(subtype.getClassType(), '__call__');
                if (methodType) {
                    this._addSignatureToResults(results, methodType);
                }
            }

            return undefined;
        });

        return results;
    }

    private static _addSignatureToResults(results: SignatureHelpResults,
            type: FunctionType | OverloadedFunctionType) {

        if (type instanceof FunctionType) {
            results.signatures.push(this._makeSignature(type));
        } else if (type instanceof OverloadedFunctionType) {
            type.getOverloads().forEach(overload => {
                results.signatures.push(this._makeSignature(overload.type));
            });
        }
    }

    private static _getBoundMethod(classType: ClassType, memberName: string):
            FunctionType | OverloadedFunctionType | undefined {

        const aliasClass = classType.getAliasClass();
        if (aliasClass) {
            classType = aliasClass;
        }

        const memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
            ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass);

        if (memberInfo) {
            const unboundMethodType = memberInfo.symbolType;
            if (unboundMethodType instanceof FunctionType || unboundMethodType instanceof OverloadedFunctionType) {
                const boundMethod = TypeUtils.bindFunctionToClassOrObject(
                    new ObjectType(classType), unboundMethodType);
                if (boundMethod instanceof FunctionType || boundMethod instanceof OverloadedFunctionType) {
                    return boundMethod;
                }
            }
        }

        return undefined;
    }

    private static _makeSignature(functionType: FunctionType): SignatureInfo {
        const stringParts = functionType.asStringParts();
        const parameters: ParamInfo[] = [];
        let label = '(';

        stringParts[0].forEach((paramString, paramIndex) => {
            parameters.push({
                startOffset: label.length,
                endOffset: label.length + paramString.length
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
            documentation: functionType.getDocString()
        };

        return sigInfo;
    }

    private static _findContainingCallNode(node: ParseNode): CallExpressionNode | undefined {
        let curNode: ParseNode | undefined = node;

        while (curNode !== undefined) {
            if (curNode instanceof CallExpressionNode) {
                return curNode;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }
}
