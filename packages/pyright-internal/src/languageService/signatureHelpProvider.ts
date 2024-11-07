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

import {
    CancellationToken,
    MarkupContent,
    MarkupKind,
    ParameterInformation,
    SignatureHelp,
    SignatureHelpContext,
    SignatureHelpTriggerKind,
    SignatureInformation,
} from 'vscode-languageserver';

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { getParamListDetails, ParamKind } from '../analyzer/parameterUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { getCallNodeAndActiveParamIndex } from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { isBuiltInModule } from '../analyzer/typeDocStringUtils';
import { CallSignature, TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { PrintTypeFlags } from '../analyzer/typePrinter';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { DocStringService } from '../common/docStringService';
import { ProgramView } from '../common/extensibility';
import { convertPositionToOffset } from '../common/positionUtils';
import { Position } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { CallNode, NameNode, ParseNodeType } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';
import { Tokenizer } from '../parser/tokenizer';
import { getDocumentationPartsForTypeAndDecl, getFunctionDocStringFromType } from './tooltipUtils';

export class SignatureHelpProvider {
    private readonly _parseResults: ParseFileResults | undefined;
    private readonly _sourceMapper: SourceMapper;

    constructor(
        private _program: ProgramView,
        private _fileUri: Uri,
        private _position: Position,
        private _format: MarkupKind,
        private _hasSignatureLabelOffsetCapability: boolean,
        private _hasActiveParameterCapability: boolean,
        private _context: SignatureHelpContext | undefined,
        private _docStringService: DocStringService,
        private _token: CancellationToken
    ) {
        this._parseResults = this._program.getParseResults(this._fileUri);
        this._sourceMapper = this._program.getSourceMapper(this._fileUri, this._token, /* mapCompiled */ true);
    }

    getSignatureHelp(): SignatureHelp | undefined {
        return this._convert(this._getSignatureHelp());
    }

    private get _evaluator(): TypeEvaluator {
        return this._program.evaluator!;
    }

    private _getSignatureHelp(): SignatureHelpResults | undefined {
        throwIfCancellationRequested(this._token);
        if (!this._parseResults) {
            return undefined;
        }

        const offset = convertPositionToOffset(this._position, this._parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(this._parseResults.parserOutput.parseTree, offset);

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
            const ch = this._parseResults.text.substr(curOffset, 1);
            if (ch === ',' || ch === '(') {
                break;
            }
            const curNode = ParseTreeUtils.findNodeByOffset(this._parseResults.parserOutput.parseTree, curOffset);
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

        const callInfo = getCallNodeAndActiveParamIndex(node, offset, this._parseResults.tokenizerOutput.tokens);
        if (!callInfo) {
            return;
        }

        const callSignatureInfo = this._evaluator.getCallSignatureInfo(
            callInfo.callNode,
            callInfo.activeIndex,
            callInfo.activeOrFake
        );
        if (!callSignatureInfo) {
            return undefined;
        }

        const signatures = callSignatureInfo.signatures.map((sig) =>
            this._makeSignature(callSignatureInfo.callNode, sig)
        );

        const callHasParameters = !!callSignatureInfo.callNode.d.args?.length;
        return {
            signatures,
            callHasParameters,
        };
    }

    private _convert(signatureHelpResults: SignatureHelpResults | undefined) {
        if (!signatureHelpResults) {
            return undefined;
        }

        const signatures = signatureHelpResults.signatures.map((sig) => {
            let paramInfo: ParameterInformation[] = [];
            if (sig.parameters) {
                paramInfo = sig.parameters.map((param) => {
                    return {
                        label: this._hasSignatureLabelOffsetCapability
                            ? [param.startOffset, param.endOffset]
                            : param.text,
                        documentation: {
                            kind: this._format,
                            value: param.documentation ?? '',
                        },
                    };
                });
            }

            const sigInfo = SignatureInformation.create(sig.label, /* documentation */ undefined, ...paramInfo);
            if (sig.documentation !== undefined) {
                sigInfo.documentation = sig.documentation;
            }

            if (sig.activeParameter !== undefined) {
                sigInfo.activeParameter = sig.activeParameter;
            }
            return sigInfo;
        });

        // A signature is active if it contains an active parameter,
        // or if both the signature and its invocation have no parameters.
        const isActive = (sig: SignatureInformation) =>
            sig.activeParameter !== undefined || (!signatureHelpResults.callHasParameters && !sig.parameters?.length);

        let activeSignature: number | undefined = signatures.findIndex(isActive);
        if (activeSignature === -1) {
            activeSignature = undefined;
        }

        let activeParameter = activeSignature !== undefined ? signatures[activeSignature].activeParameter! : undefined;

        // Check if we should reuse the user's signature selection. If the retrigger was not "invoked"
        // (i.e., the signature help call was automatically generated by the client due to some navigation
        // or text change), check to see if the previous signature is still "active". If so, we mark it as
        // active in our response.
        //
        // This isn't a perfect method. For nested calls, we can't tell when we are moving between them.
        // Ideally, we would include a token in the signature help responses to compare later, allowing us
        // to know when the user's navigated to a nested call (and therefore the old signature's info does
        // not apply), but for now manually retriggering the signature help will work around the issue.
        if (this._context?.isRetrigger && this._context.triggerKind !== SignatureHelpTriggerKind.Invoked) {
            const prevActiveSignature = this._context.activeSignatureHelp?.activeSignature;
            if (prevActiveSignature !== undefined && prevActiveSignature < signatures.length) {
                const sig = signatures[prevActiveSignature];
                if (isActive(sig)) {
                    activeSignature = prevActiveSignature;
                    activeParameter = sig.activeParameter ?? undefined;
                }
            }
        }

        if (this._hasActiveParameterCapability || activeSignature === undefined) {
            // If there is no active parameter, then we want the client to not highlight anything.
            // Unfortunately, the LSP spec says that "undefined" or "out of bounds" values should be
            // treated as 0, which is the first parameter. That's not what we want, but thankfully
            // VS Code (and potentially other clients) choose to handle out of bounds values by
            // not highlighting them, which is what we want.
            //
            // The spec defines activeParameter as uinteger, so use the maximum length of any
            // signature's parameter list to ensure that the value is always out of range.
            //
            // We always set this even if some signature has an active parameter, as this
            // value is used as the fallback for signatures that don't explicitly specify an
            // active parameter (and we use "undefined" to mean "no active parameter").
            //
            // We could apply this hack to each individual signature such that they all specify
            // activeParameter, but that would make it more difficult to determine which actually
            // are active when comparing, and we already have to set this for clients which don't
            // support per-signature activeParameter.
            //
            // See:
            //   - https://github.com/microsoft/language-server-protocol/issues/1271
            //   - https://github.com/microsoft/pyright/pull/1783
            activeParameter = Math.max(...signatures.map((s) => s.parameters?.length ?? 0));
        }

        return { signatures, activeSignature, activeParameter };
    }

    private _makeSignature(callNode: CallNode, signature: CallSignature): SignatureInfo {
        const functionType = signature.type;
        const stringParts = this._evaluator.printFunctionParts(functionType, PrintTypeFlags.ExpandTypedDictArgs);
        const parameters: ParamInfo[] = [];
        const functionDocString =
            getFunctionDocStringFromType(functionType, this._sourceMapper, this._evaluator) ??
            this._getDocStringFromCallNode(callNode);
        const fileInfo = getFileInfo(callNode);
        const paramListDetails = getParamListDetails(functionType);

        let label = '(';
        let isFirstParamInLabel = true;
        let activeParameter: number | undefined;
        const params = functionType.shared.parameters;

        stringParts[0].forEach((paramString: string, paramIndex) => {
            let paramName = '';
            if (paramIndex < params.length) {
                paramName = params[paramIndex].name || '';
            } else if (params.length > 0) {
                paramName = params[params.length - 1].name || '';
            }

            const isKeywordOnly = paramListDetails.params.some(
                (param) => param.param.name === paramName && param.kind === ParamKind.Keyword
            );

            if (!isKeywordOnly || Tokenizer.isPythonIdentifier(paramName)) {
                if (!isFirstParamInLabel) {
                    label += ', ';
                }
                isFirstParamInLabel = false;

                parameters.push({
                    startOffset: label.length,
                    endOffset: label.length + paramString.length,
                    text: paramString,
                });

                // Name match for active parameter. The set of parameters from the function
                // may not match the actual string output from the typeEvaluator (kwargs for TypedDict is an example).
                if (paramName && signature.activeParam && signature.activeParam.name === paramName) {
                    activeParameter = parameters.length - 1;
                }

                label += paramString;
            }
        });

        label += ') -> ' + stringParts[1];

        if (signature.activeParam && activeParameter === undefined) {
            activeParameter = params.indexOf(signature.activeParam);
            if (activeParameter === -1) {
                activeParameter = undefined;
            }
        }

        // Extract the documentation only for the active parameter.
        if (activeParameter !== undefined) {
            const activeParam = parameters[activeParameter];
            if (activeParam) {
                activeParam.documentation = this._docStringService.extractParameterDocumentation(
                    functionDocString || '',
                    params[activeParameter].name || '',
                    this._format
                );
            }
        }

        const sigInfo: SignatureInfo = {
            label,
            parameters,
            activeParameter,
        };

        if (functionDocString) {
            if (this._format === MarkupKind.Markdown) {
                sigInfo.documentation = {
                    kind: MarkupKind.Markdown,
                    value: this._docStringService.convertDocStringToMarkdown(
                        functionDocString,
                        isBuiltInModule(fileInfo?.fileUri)
                    ),
                };
            } else {
                sigInfo.documentation = {
                    kind: MarkupKind.PlainText,
                    value: this._docStringService.convertDocStringToPlainText(functionDocString),
                };
            }
        }

        return sigInfo;
    }

    private _getDocStringFromCallNode(callNode: CallNode): string | undefined {
        // This is a heuristic to see whether we can get some docstring
        // from call node when all other methods failed.
        // It only works if call is off a name node.
        let name: NameNode | undefined;
        const expr = callNode.d.leftExpr;
        if (expr.nodeType === ParseNodeType.Name) {
            name = expr;
        } else if (expr.nodeType === ParseNodeType.MemberAccess) {
            name = expr.d.member;
        }

        if (!name) {
            return undefined;
        }

        for (const decl of this._evaluator.getDeclInfoForNameNode(name)?.decls ?? []) {
            const resolveDecl = this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
            if (!resolveDecl) {
                continue;
            }

            const type = this._evaluator.getType(name);
            if (!type) {
                continue;
            }

            const part = getDocumentationPartsForTypeAndDecl(this._sourceMapper, type, resolveDecl, this._evaluator);
            if (part) {
                return part;
            }
        }

        return undefined;
    }
}

interface ParamInfo {
    startOffset: number;
    endOffset: number;
    text: string;
    documentation?: string | undefined;
}

interface SignatureInfo {
    label: string;
    documentation?: MarkupContent | undefined;
    parameters?: ParamInfo[] | undefined;
    activeParameter?: number | undefined;
}

interface SignatureHelpResults {
    signatures: SignatureInfo[];
    callHasParameters: boolean;
}
