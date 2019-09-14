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

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ClassType, FunctionType, ObjectType, OverloadedFunctionType,
    printFunctionParts, TypeCategory } from '../analyzer/types';
import * as TypeUtils from '../analyzer/typeUtils';
import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { CallExpressionNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
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

        if (offset > TextRange.getEnd(callNode)) {
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

        TypeUtils.doForSubtypes(callType, subtype => {
            if (subtype.category === TypeCategory.Function || subtype.category === TypeCategory.OverloadedFunction) {
                this._addSignatureToResults(results, subtype);
            } else if (subtype.category === TypeCategory.Class) {
                const methodType = this._getBoundMethod(subtype, '__init__');
                if (methodType) {
                    this._addSignatureToResults(results, methodType);
                }
            } else if (subtype.category === TypeCategory.Object) {
                const methodType = this._getBoundMethod(subtype.classType, '__call__');
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

        if (type.category === TypeCategory.Function) {
            results.signatures.push(this._makeSignature(type));
        } else if (type.category === TypeCategory.OverloadedFunction) {
            type.overloads.forEach(overload => {
                results.signatures.push(this._makeSignature(overload.type));
            });
        }
    }

    private static _getBoundMethod(classType: ClassType, memberName: string):
            FunctionType | OverloadedFunctionType | undefined {

        const aliasClass = ClassType.getAliasClass(classType);
        if (aliasClass) {
            classType = aliasClass;
        }

        const memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
            TypeUtils.ClassMemberLookupFlags.SkipInstanceVariables |
                TypeUtils.ClassMemberLookupFlags.SkipObjectBaseClass);

        if (memberInfo) {
            const unboundMethodType = memberInfo.symbolType;
            if (unboundMethodType.category === TypeCategory.Function ||
                    unboundMethodType.category === TypeCategory.OverloadedFunction) {

                const boundMethod = TypeUtils.bindFunctionToClassOrObject(
                    ObjectType.create(classType), unboundMethodType);

                if (boundMethod.category === TypeCategory.Function ||
                        boundMethod.category === TypeCategory.OverloadedFunction) {

                    return boundMethod;
                }
            }
        }

        return undefined;
    }

    private static _makeSignature(functionType: FunctionType): SignatureInfo {
        const stringParts = printFunctionParts(functionType);
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
            documentation: FunctionType.getDocString(functionType)
        };

        return sigInfo;
    }

    private static _findContainingCallNode(node: ParseNode): CallExpressionNode | undefined {
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
