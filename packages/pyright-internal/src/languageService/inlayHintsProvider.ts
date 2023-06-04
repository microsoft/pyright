import { CancellationToken, Hover, MarkupContent } from 'vscode-languageserver';
import { InlayHint, InlayHintLabelPart } from 'vscode-languageserver-protocol';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition } from '../common/positionUtils';
import { ArgumentNode, CallNode, FunctionNode, MemberAccessNode, ModuleNode, NameNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

import { printParseNodeType } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { ConsoleInterface } from '../common/console';
import { Position, getEmptyPosition } from '../common/textRange';
import { ParseNodeType } from '../parser/parseNodes';
import { HoverProvider } from './hoverProvider';

type TypeInlayHintsItemType = {
    inlayHintType: 'variable' | 'functionReturn';
    startOffset: number;
    endOffset: number;
    value?: string;
};

class TypeInlayHintsWalker extends ParseTreeWalker {
    featureItems: TypeInlayHintsItemType[] = [];

    constructor() {
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

    override visitArgument(node: ArgumentNode): boolean {
        if (node.parent) {
            const parentNodeType = printParseNodeType(node.parent.nodeType);
            if (parentNodeType === 'Assignment') {
                return false;
            }
        }
        return super.visitArgument(node);
    }

    override visitCall(node: CallNode): boolean {
        function f(t: ParseNodeType) {
            return printParseNodeType(t);
        }
        const x = f(node.nodeType);
        if (x === 'Continue') {
            return false;
        }
        return super.visitCall(node);
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

    constructor(
        private _program: ProgramView,
        private _filePath: string,
        private _token: CancellationToken
    ) {
        this._parseResults = this._program.getParseResults(this._filePath);
    }

    async onInlayHints(): Promise<InlayHint[] | null> {
        if (!this._parseResults) {
            return null;
        }

        const walker = new TypeInlayHintsWalker();
        walker.walk(this._parseResults.parseTree);

        const inlayHints: InlayHint[] = [];
        for (const item of walker.featureItems) {
            const startPosition = convertOffsetToPosition(item.startOffset, this._parseResults.tokenizerOutput.lines);
            const endPosition = convertOffsetToPosition(item.endOffset, this._parseResults.tokenizerOutput.lines);
            const hoverResponse = await this.getHoverAtOffset(startPosition);
            if (!hoverResponse) {
                continue;
            }

            let inlayHintLabelValue: string | undefined = undefined;
            let inlayHintPosition: Position | undefined = undefined;
            if (item.inlayHintType === 'variable') {
                inlayHintLabelValue = this.getVariableHintAtHover(hoverResponse);
            }
            if (item.inlayHintType === 'functionReturn') {
                inlayHintLabelValue = this.getFunctionReturnHintAtHover(hoverResponse);
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
                    default:
                        break;
                }

                if (inlayHintPosition) {
                    const inlayHint: InlayHint = {
                        label: inlayHintLabelPart,
                        position: inlayHintPosition,
                        paddingLeft: item.inlayHintType == 'functionReturn' ?? true,
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
            const text = contents.value.split('->')[1].split('\n')[0].trim();
            return '-> ' + text;
        }
        return undefined;
    }
}
