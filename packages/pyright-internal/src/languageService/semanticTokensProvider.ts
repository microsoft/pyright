import {
    CancellationToken,
    SemanticTokenModifiers,
    SemanticTokenTypes,
    SemanticTokens,
    SemanticTokensBuilder,
} from 'vscode-languageserver';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ProgramView } from '../common/extensibility';
import { convertOffsetsToRange } from '../common/positionUtils';
import { Uri } from '../common/uri/uri';
import { ParseResults } from '../parser/parser';
import { SemanticTokensWalker } from '../analyzer/semanticTokensWalker';

export const tokenTypes: string[] = [
    SemanticTokenTypes.class,
    SemanticTokenTypes.parameter,
    SemanticTokenTypes.typeParameter,
    SemanticTokenTypes.function,
    SemanticTokenTypes.method,
    SemanticTokenTypes.decorator,
    SemanticTokenTypes.property,
    SemanticTokenTypes.namespace,
];
export const tokenModifiers: string[] = [
    SemanticTokenModifiers.definition,
    SemanticTokenModifiers.declaration,
    SemanticTokenModifiers.async,
];

export const SemanticTokensProviderLegend = {
    tokenTypes: tokenTypes,
    tokenModifiers: tokenModifiers,
};

function encodeTokenType(type: string): number {
    const idx = tokenTypes.indexOf(type);
    if (idx === -1) {
        throw new Error(`Unknown token type: ${type}`);
    }
    return idx;
}

function encodeTokenModifiers(modifiers: string[]): number {
    let data = 0;
    for (const t of modifiers) {
        const idx = tokenModifiers.indexOf(t);
        if (idx === undefined) {
            continue;
        }
        data |= 1 << idx;
    }
    return data;
}

export class SemanticTokensProvider {
    private readonly _parseResults: ParseResults | undefined;

    constructor(private _program: ProgramView, private _fileUri: Uri, private _token: CancellationToken) {
        this._parseResults = this._program.getParseResults(this._fileUri);
    }

    async onSemanticTokens(): Promise<SemanticTokens> {
        const builder = new SemanticTokensBuilder();
        if (!this._parseResults) {
            return builder.build();
        }

        const walker = new SemanticTokensWalker(this._program.evaluator!);
        walker.walk(this._parseResults.parseTree);

        throwIfCancellationRequested(this._token);

        for (const item of walker.items) {
            const range = convertOffsetsToRange(
                item.start,
                item.start + item.length,
                this._parseResults.tokenizerOutput.lines
            );
            builder.push(
                range.start.line,
                range.start.character,
                item.length,
                encodeTokenType(item.type),
                encodeTokenModifiers(item.modifiers)
            );
        }

        return builder.build();
    }
}
