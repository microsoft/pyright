import { CancellationToken, Hover, MarkupContent } from 'vscode-languageserver';
import { InlayHint, InlayHintLabelPart } from 'vscode-languageserver-protocol';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition } from '../common/positionUtils';
import { ParseResults } from '../parser/parser';

import { TypeInlayHintsWalker } from '../analyzer/typeInlayHintsWalker';
import { Position, getEmptyPosition } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { HoverProvider } from './hoverProvider';

export class InlayHintsProvider {
    private readonly _parseResults: ParseResults | undefined;

    constructor(private _program: ProgramView, private _fileUri: Uri, private _token: CancellationToken) {
        this._parseResults = this._program.getParseResults(this._fileUri);
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
        const hover = new HoverProvider(this._program, this._fileUri, position, 'markdown', this._token);
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
