import { CancellationToken, Hover, MarkupContent } from 'vscode-languageserver';
import { InlayHint, InlayHintLabelPart } from 'vscode-languageserver-protocol';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition } from '../common/positionUtils';
import {
    ArgumentNode,
    CallNode,
    FunctionNode,
    MemberAccessNode,
    NameNode,
    ParameterCategory,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

import { getCallNodeAndActiveParameterIndex, printParseNodeType } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { Position, getEmptyPosition } from '../common/textRange';
import { ParameterNode, ParseNodeType } from '../parser/parseNodes';
import { HoverProvider } from './hoverProvider';
import { CallSignature } from '../analyzer/typeEvaluatorTypes';

type TypeInlayHintsItemType = {
    inlayHintType: 'variable' | 'functionReturn' | 'parameter';
    startOffset: number;
    endOffset: number;
    value?: string;
};

// Don't generate inlay hints for arguments to builtin types and functions

const ignoredBuiltinTypes = [
    'builtins.bool',
    'builtins.bytes',
    'builtins.bytearray',
    'builtins.float',
    'builtins.int',
    'builtins.list',
    'builtins.memoryview',
    'builtins.str',
    'builtins.tuple',
    'builtins.range',
    'builtins.enumerate',
    'builtins.map',
    'builtins.filter',
    'builtins.slice',
    'builtins.type',
    'builtins.reversed',
    'builtins.zip',
];
const ignoredBuiltinFunctions = [
    'builtins.len',
    'builtins.max',
    'builtins.min',
    'builtins.next',
    'builtins.repr',
    'builtins.setattr',
    'builtins.getattr',
    'builtins.hasattr',
    'builtins.sorted',
    'builtins.isinstance',
    'builtins.id',
    'builtins.iter',
];

function isIgnoredBuiltin(sig: CallSignature): boolean {
    if (sig.type.details.moduleName !== 'builtins') {
        return false;
    }
    const funcName = sig.type.details.name;
    if (funcName === '__new__' || funcName === '__init__') {
        return ignoredBuiltinTypes.some((v) => `${v}.${funcName}` === sig.type.details.fullName);
    }
    return ignoredBuiltinFunctions.some((v) => v === sig.type.details.fullName);
}

class TypeInlayHintsWalker extends ParseTreeWalker {
    featureItems: TypeInlayHintsItemType[] = [];

    constructor(private readonly _program: ProgramView, private readonly _parseResults: ParseResults) {
        super();
    }

    override visitName(node: NameNode): boolean {
        if (node.parent) {
            const parentNodeType = printParseNodeType(node.parent.nodeType);
            if (parentNodeType === 'Assignment') {
                this.featureItems.push({
                    inlayHintType: 'variable',
                    startOffset: node.start,
                    endOffset: node.start + node.length - 1,
                    value: node.value,
                });
            }
        }
        return super.visitName(node);
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        if (node.parent) {
            const parentNodeType = printParseNodeType(node.parent.nodeType);
            if (parentNodeType === 'Assignment') {
                this.featureItems.push({
                    inlayHintType: 'variable',
                    startOffset: node.memberName.start,
                    endOffset: node.memberName.start + node.memberName.length - 1,
                    value: node.memberName.value,
                });
            }
        }
        return super.visitMemberAccess(node);
    }

    getFunctionParametersFromNode(node: CallNode): ParameterNode[] | undefined {
        const funcName = (node.leftExpression as NameNode).value;
        const result = this._program.evaluator?.lookUpSymbolRecursive(node.leftExpression, funcName, false);
        const declarations = result?.symbol.getTypedDeclarations();
        if (!declarations || declarations.length === 0) {
            return undefined;
        }
        const decl = declarations[0];
        if (decl.node.nodeType === ParseNodeType.Function) {
            return decl.node.parameters;
        }
        return undefined;
    }

    private getParameterNameHint(node: ArgumentNode): string | undefined {
        const result = getCallNodeAndActiveParameterIndex(node, node.start, this._parseResults.tokenizerOutput.tokens);
        if (!result?.callNode || result.callNode.arguments[result.activeIndex].name) {
            return undefined;
        }

        const signatureInfo = this._program.evaluator?.getCallSignatureInfo(
            result.callNode,
            result.activeIndex,
            result.activeOrFake
        );
        if (!signatureInfo) {
            return undefined;
        }

        const sig = signatureInfo.signatures[0];
        if (isIgnoredBuiltin(sig)) {
            return undefined;
        }

        const activeParam = sig.activeParam;
        if (activeParam?.category !== ParameterCategory.Simple) {
            return undefined;
        }

        // Arguments starting with double underscores usually come from type stubs,
        // they're probably not very informative. If necessary, an option can be added
        // whether to hide such names or not.
        if (activeParam.name?.startsWith('__')) {
            return undefined;
        }

        return activeParam.name;
    }

    override visitArgument(node: ArgumentNode): boolean {
        if (node.parent) {
            if (node.parent.nodeType === ParseNodeType.Assignment) {
                return false;
            }
            const paramName = this.getParameterNameHint(node);
            if (paramName) {
                this.featureItems.push({
                    inlayHintType: 'parameter',
                    startOffset: node.start,
                    endOffset: node.start + node.length - 1,
                    value: paramName,
                });
            }
        }
        return super.visitArgument(node);
    }

    override visitFunction(node: FunctionNode): boolean {
        if (!node.returnTypeAnnotation) {
            this.featureItems.push({
                inlayHintType: 'functionReturn',
                startOffset: node.name.start,
                endOffset: node.suite.start,
                value: node.name.value,
            });
        }
        return super.visitFunction(node);
    }
}

export class InlayHintsProvider {
    private readonly _parseResults: ParseResults | undefined;

    constructor(private _program: ProgramView, private _filePath: string, private _token: CancellationToken) {
        this._parseResults = this._program.getParseResults(this._filePath);
    }

    async onInlayHints(): Promise<InlayHint[] | null> {
        if (!this._parseResults) {
            return null;
        }

        const walker = new TypeInlayHintsWalker(this._program, this._parseResults);
        walker.walk(this._parseResults.parseTree);

        const inlayHints: InlayHint[] = [];
        for (const item of walker.featureItems) {
            const startPosition = convertOffsetToPosition(item.startOffset, this._parseResults.tokenizerOutput.lines);
            const endPosition = convertOffsetToPosition(item.endOffset, this._parseResults.tokenizerOutput.lines);
            const hoverResponse =
                item.inlayHintType === 'parameter' ? null : await this.getHoverAtOffset(startPosition);
            if (!hoverResponse && item.inlayHintType !== 'parameter') {
                continue;
            }

            let inlayHintLabelValue: string | undefined = undefined;
            let inlayHintPosition: Position | undefined = undefined;
            if (item.inlayHintType === 'variable') {
                inlayHintLabelValue = this.getVariableHintAtHover(hoverResponse!);
            }
            if (item.inlayHintType === 'functionReturn') {
                inlayHintLabelValue = this.getFunctionReturnHintAtHover(hoverResponse!);
            }
            if (item.inlayHintType === 'parameter') {
                inlayHintLabelValue = item.value + '=';
            }

            if (inlayHintLabelValue) {
                const inlayHintLabelPart: InlayHintLabelPart[] = [InlayHintLabelPart.create(inlayHintLabelValue)];
                switch (item.inlayHintType) {
                    case 'variable':
                        inlayHintPosition = getEmptyPosition();
                        inlayHintPosition.line = startPosition.line;
                        inlayHintPosition.character = endPosition.character + 1;
                        break;
                    case 'functionReturn':
                        inlayHintPosition = endPosition;
                        break;
                    case 'parameter':
                        inlayHintPosition = getEmptyPosition();
                        inlayHintPosition.line = startPosition.line;
                        inlayHintPosition.character = startPosition.character;
                        break;
                    default:
                        break;
                }

                if (inlayHintPosition) {
                    const inlayHint: InlayHint = {
                        label: inlayHintLabelPart,
                        position: inlayHintPosition,
                        paddingLeft: item.inlayHintType == 'functionReturn' ?? true,
                        kind: item.inlayHintType == 'parameter' ? 2 : 1,
                    };
                    inlayHints.push(inlayHint);
                }
            }
        }
        return inlayHints;
    }

    private async getHoverAtOffset(position: Position) {
        const hover = new HoverProvider(this._program, this._filePath, position, 'markdown', this._token);
        return hover.getHover();
    }

    private getVariableHintAtHover(hover: Hover): string | undefined {
        const contents = hover.contents as MarkupContent;
        if (contents && contents.value.includes('(variable)')) {
            const firstIdx = contents.value.indexOf(': ');
            if (firstIdx > -1) {
                const text = contents.value
                    .substring(firstIdx + 2)
                    .split('\n')[0]
                    .trim();
                if (text.startsWith('Literal[')) {
                    return undefined;
                }
                return ': ' + text;
            }
        }
        return undefined;
    }

    private getFunctionReturnHintAtHover(hover: Hover): string | undefined {
        const contents = hover.contents as MarkupContent;
        if (contents && (contents.value.includes('(function)') || contents.value.includes('(method)'))) {
            const retvalIdx = contents.value.indexOf('->') + 2;
            const text = contents.value.substring(retvalIdx).split('\n')[0].trim();
            return '-> ' + text;
        }
        return undefined;
    }
}
