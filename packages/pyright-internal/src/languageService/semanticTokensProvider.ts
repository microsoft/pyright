import { CancellationToken, SemanticTokensBuilder } from 'vscode-languageserver';
import {
    Range,
    SemanticTokenModifiers,
    SemanticTokenTypes,
    SemanticTokens,
    integer
} from 'vscode-languageserver-protocol';
import { AnalyzerFileInfo } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationType, FunctionDeclaration } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition } from '../common/positionUtils';
import { TextRange, doesRangeContain } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Uri } from '../common/uri/uri';
import { FunctionNode, ModuleNode, NameNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { Token } from '../parser/tokenizerTypes';

export interface SemanticTokenEntry {
    line: integer;
    start: integer;
    length: integer;
    type: SemanticTokenTypes;
    modifiers: SemanticTokenModifiers[];
}

export interface SemanticTokensResult {
    data: SemanticTokenEntry[];
}

export class SemanticTokensGenerator extends ParseTreeWalker {
    private readonly _parseResults: ParseResults;
    private readonly _moduleNode: ModuleNode;
    private readonly _fileInfo: AnalyzerFileInfo;
    private readonly _lines: TextRangeCollection<TextRange>
    private readonly _evaluator: TypeEvaluator;
    private readonly _range: Range | undefined;
    private readonly _data: SemanticTokenEntry[];
    private _dataLen: integer;

    constructor(
        parseResults: ParseResults,
        evaluator: TypeEvaluator,
        range: Range | undefined,
    ) {
        super();

        this._parseResults = parseResults;
        this._moduleNode = parseResults.parseTree;
        this._fileInfo = AnalyzerNodeInfo.getFileInfo(this._moduleNode)!;
        this._lines = parseResults.tokenizerOutput.lines;
        this._evaluator = evaluator;
        this._range = range;
        this._data = [];
        this._dataLen = 0;
    }

    generate(): SemanticTokensResult {
        this.walk(this._moduleNode);
        // return this._builder.build();
        return {
            data: this._data,
        };
    }

    private _pushToken(token: Token, type: SemanticTokenTypes, modifiers: SemanticTokenModifiers[]) {
        const start = token.start;
        const length = token.length;
        const position = convertOffsetToPosition(start, this._lines);

        if (this._range) {
            if (!doesRangeContain(this._range, position)) {
                return;
            }
        }

        this._data[this._dataLen++] = {
            line: position.line,
            start: position.character,
            length: length,
            type: type,
            modifiers: modifiers,
        };
    }

    // override visitCall()

    override visitName(node: NameNode) {
        const declarations = this._evaluator.getDeclarationsForNameNode(node);
        if (declarations && declarations.length > 0) {
            const primaryDeclaration: Declaration = declarations[0];
            const options = {
                allowExternallyHiddenAccess: false,
                skipFileNeededCheck: false,
            };
            const resolvedDecl = this._evaluator.resolveAliasDeclaration(primaryDeclaration, true, options);
            const position = convertOffsetToPosition(node.token.start, this._lines);

            const modifiers: SemanticTokenModifiers[] = [];
            if (resolvedDecl) {
                if (doesRangeContain(resolvedDecl.range, position)) {
                    modifiers.push(SemanticTokenModifiers.declaration);
                }

                switch (resolvedDecl.type) {
                     case DeclarationType.Intrinsic: {
                        this._pushToken(node.token, SemanticTokenTypes.macro, modifiers);
                        break;
                    }
                    case DeclarationType.Variable: {
                        const containingClassNode = ParseTreeUtils.getEnclosingClass(resolvedDecl.node, true);
                        if (containingClassNode) {
                            modifiers.push(SemanticTokenModifiers.modification);
                        }
                        this._pushToken(node.token, SemanticTokenTypes.variable, modifiers);
                        break;
                    }
                    case DeclarationType.Parameter: {
                        this._pushToken(node.token, SemanticTokenTypes.parameter, modifiers);
                        break;
                    }
                    case DeclarationType.Function: {
                        const functionDeclaration: FunctionDeclaration = resolvedDecl;
                        let type = SemanticTokenTypes.function;
                        if (functionDeclaration.isMethod) {
                            type = SemanticTokenTypes.method;
                            const functionNode: FunctionNode = functionDeclaration.node;
                            for (const decorator of functionNode.decorators) {
                                if (decorator.expression.nodeType === ParseNodeType.Name) {
                                    const decoratorName = decorator.expression.value;
                                    if (decoratorName === 'staticmethod') {
                                        modifiers.push(SemanticTokenModifiers.static);
                                    } else if (decoratorName === 'classmethod') {
                                        modifiers.push(SemanticTokenModifiers.static);
                                    } else if (decoratorName === 'property') {
                                        type = SemanticTokenTypes.property;
                                    }
                                }
                            }
                        }
                        this._pushToken(node.token, type, modifiers);
                        break;
                    }
                    case DeclarationType.Class: {
                        this._pushToken(node.token, SemanticTokenTypes.class, modifiers);
                        break;
                    }
                    case DeclarationType.SpecialBuiltInClass: {
                        modifiers.push(SemanticTokenModifiers.defaultLibrary);
                        this._pushToken(node.token, SemanticTokenTypes.class, modifiers);
                        break;
                    }
                    case DeclarationType.Alias: {
                        this._pushToken(node.token, SemanticTokenTypes.namespace, modifiers);
                        break;
                    }
                }
            } else {
                if (primaryDeclaration.type === DeclarationType.Alias) {
                    const position = convertOffsetToPosition(node.token.start, this._lines);
                    console.log(`??? ${node.token.value}: ${position.line}:${position.character} ${primaryDeclaration.type}`);
                }
            }
        }
        return true;
    }
}

export const providedTokenTypes = [
    SemanticTokenTypes.namespace,
    SemanticTokenTypes.type,
    SemanticTokenTypes.class,
    SemanticTokenTypes.enum,
    SemanticTokenTypes.interface,
    SemanticTokenTypes.struct,
    SemanticTokenTypes.typeParameter,
    SemanticTokenTypes.parameter,
    SemanticTokenTypes.variable,
    SemanticTokenTypes.property,
    SemanticTokenTypes.enumMember,
    SemanticTokenTypes.event,
    SemanticTokenTypes.function,
    SemanticTokenTypes.method,
    SemanticTokenTypes.macro,
    SemanticTokenTypes.keyword,
    SemanticTokenTypes.modifier,
    SemanticTokenTypes.comment,
    SemanticTokenTypes.string,
    SemanticTokenTypes.number,
    SemanticTokenTypes.regexp,
    SemanticTokenTypes.operator,
];

export const providedTokenModifiers = [
    SemanticTokenModifiers.declaration,
    SemanticTokenModifiers.definition,
    SemanticTokenModifiers.readonly,
    SemanticTokenModifiers.static,
    SemanticTokenModifiers.deprecated,
    SemanticTokenModifiers.abstract,
    SemanticTokenModifiers.async,
    SemanticTokenModifiers.modification,
    SemanticTokenModifiers.documentation,
    SemanticTokenModifiers.defaultLibrary,
];


export class SemanticTokensProvider {
    constructor(
        private _program: ProgramView,
        private _uri: Uri,
        private _token: CancellationToken
    ) {
    }

    getResult(range?: Range): SemanticTokensResult | null {
        const parseResults = this._program.getParseResults(this._uri);
        if (!parseResults) {
            return null;
        }

        const sourceFileInfo = this._program.getSourceFileInfo(this._uri);
        if (!sourceFileInfo) {
            return null;
        }
        const sourceFile = sourceFileInfo.sourceFile;
        const generator = new SemanticTokensGenerator(
            parseResults,
            this._program.evaluator!,
            range
        );
        return generator.generate();
    }

    getTokens(builder: SemanticTokensBuilder, range?: Range) {
        throwIfCancellationRequested(this._token);

        const result = this.getResult(range);
        if (!result) {
            return;
        }

        for (const entry of result.data) {
            const type = providedTokenTypes.indexOf(entry.type);
            if (type < 0) {
                continue;
            }
            let modifiers = 0;
            for (const modifier of entry.modifiers) {
                const flag = providedTokenModifiers.indexOf(modifier);
                if (flag < 0) {
                    continue;
                }
                modifiers |= 1 << flag;
            }
            builder.push(entry.line, entry.start, entry.length, type, modifiers);
        }
    }

    getSemanticTokens(): SemanticTokens {
        const builder = new SemanticTokensBuilder();
        this.getTokens(builder);
        return builder.build()
    }

    getSemanticTokensForRange(range: Range): SemanticTokens {
        const builder = new SemanticTokensBuilder();
        this.getTokens(builder, range);
        return builder.build()
    }
}
