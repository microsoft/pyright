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

import { CancellationToken } from 'vscode-languageserver';

import { extractParameterDocumentation } from '../analyzer/docStringUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { FunctionType } from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertPositionToOffset } from '../common/positionUtils';
import { Position } from '../common/textRange';
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
    static getSignatureHelpForPosition(
        parseResults: ParseResults,
        position: Position,
        evaluator: TypeEvaluator,
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

        const callSignatureInfo = evaluator.getCallSignatureInfo(node, offset, parseResults.tokenizerOutput.tokens);
        if (!callSignatureInfo) {
            return undefined;
        }

        const signatures: SignatureInfo[] = [];
        let activeSignature: number | undefined;
        let activeParameter: number | undefined;

        callSignatureInfo.signatures.forEach((signature, index) => {
            signatures.push(this._makeSignature(signature.type, evaluator));

            // Unfortunately, the LSP specification only allows a single active overload
            // with a single active parameter. Since overloads in Python can have wildly
            // different looking signatures, this isn't enough, and having a per-overload
            // active parameter would be preferred. In lieu of this, just mark the first
            // overload containing the active parameter as active and hope for the best.
            if (activeSignature === undefined && signature.activeParam) {
                const paramIndex = signature.type.details.parameters.indexOf(signature.activeParam);
                if (paramIndex !== -1) {
                    activeSignature = index;
                    activeParameter = paramIndex;
                }
            }
        });

        return {
            signatures,
            activeSignature,
            activeParameter
        };
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
}
