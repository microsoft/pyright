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

import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { CallExpressionNode, ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ParseTreeUtils } from './parseTreeUtils';
import { ClassType, FunctionType, ObjectType, OverloadedFunctionType } from './types';
import { TypeUtils } from './typeUtils';

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

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const callNode = this._findContainingCallNode(node);
        if (callNode === undefined) {
            return undefined;
        }

        const callType = AnalyzerNodeInfo.getExpressionType(callNode.leftExpression);
        if (callType === undefined) {
            return undefined;
        }

        const results: SignatureHelpResults = {
            signatures: []
        };

        TypeUtils.doForSubtypes(callType, subtype => {
            if (subtype instanceof FunctionType) {
                results.signatures.push(this._makeSignature(subtype));
            } else if (subtype instanceof OverloadedFunctionType) {
                subtype.getOverloads().forEach(overload => {
                    results.signatures.push(this._makeSignature(overload.type));
                });
            } else if (subtype instanceof ClassType) {
                // TODO - need to implement
            } else if (subtype instanceof ObjectType) {
                // TODO - need to implement
            }

            return undefined;
        });

        return results;
    }

    private static _makeSignature(functionType: FunctionType): SignatureInfo {
        const sigInfo: SignatureInfo = {
            label: functionType.asString()
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
