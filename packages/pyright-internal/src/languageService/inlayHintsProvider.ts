import { CancellationToken } from 'vscode-languageserver';
import { InlayHint, InlayHintLabelPart, InlayHintKind } from 'vscode-languageserver-protocol';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition } from '../common/positionUtils';
import { ParseResults } from '../parser/parser';

import { TypeInlayHintsWalker } from '../analyzer/typeInlayHintsWalker';
import { Position, getEmptyPosition, Range } from '../common/textRange';
import { Uri } from '../common/uri/uri';

export class InlayHintsProvider {
    private readonly _parseResults: ParseResults | undefined;

    constructor(
        private _program: ProgramView,
        private _fileUri: Uri,
        private _range: Range,
        private _token: CancellationToken
    ) {
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
            if (!this._itemInRange(startPosition, endPosition)) {
                continue;
            }

            const inlayHintLabelValue = item.value;
            let inlayHintPosition: Position | undefined = undefined;

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
                        paddingLeft: item.inlayHintType === 'functionReturn' ?? true,
                        kind: item.inlayHintType === 'parameter' ? InlayHintKind.Parameter : InlayHintKind.Type,
                    };
                    inlayHints.push(inlayHint);
                }
            }
        }

        return inlayHints;
    }

    private _itemInRange(start: Position, end: Position): boolean {
        if (start.line > this._range.end.line) {
            return false;
        }
        if (end.line < this._range.start.line) {
            return false;
        }
        return true;
    }
}
