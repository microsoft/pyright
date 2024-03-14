import { InlayHint, InlayHintLabelPart, InlayHintKind } from 'vscode-languageserver-protocol';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition } from '../common/positionUtils';
import { ParseResults } from '../parser/parser';

import { TypeInlayHintsWalker } from '../analyzer/typeInlayHintsWalker';
import { Uri } from '../common/uri/uri';

export class InlayHintsProvider {
    private readonly _parseResults: ParseResults | undefined;
    private readonly _walker: TypeInlayHintsWalker;

    constructor(private _program: ProgramView, private _fileUri: Uri) {
        this._parseResults = this._program.getParseResults(this._fileUri);
        this._walker = new TypeInlayHintsWalker(this._program);
    }

    async onInlayHints(): Promise<InlayHint[] | null> {
        if (!this._parseResults) {
            return null;
        }
        this._walker.walk(this._parseResults.parseTree);

        return this._walker.featureItems.map((item) => ({
            label: [InlayHintLabelPart.create(item.value)],
            position: convertOffsetToPosition(item.position, this._parseResults!.tokenizerOutput.lines),
            paddingLeft: item.inlayHintType === 'functionReturn',
            kind: item.inlayHintType === 'parameter' ? InlayHintKind.Parameter : InlayHintKind.Type,
        }));
    }
}
