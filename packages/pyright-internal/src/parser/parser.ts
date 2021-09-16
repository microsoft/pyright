/*
 * parser.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Based on code from python-language-server repository:
 *  https://github.com/Microsoft/python-language-server
 *
 * Parser for the Python language. Converts a stream of tokens
 * into an abstract syntax tree (AST).
 */

import Char from 'typescript-char';

import { assert } from '../common/debug';
import { Diagnostic, DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetsToRange, convertPositionToOffset } from '../common/positionUtils';
import { latestStablePythonVersion, PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { timingStats } from '../common/timing';
import { Localizer } from '../localization/localize';
import {
    ArgumentCategory,
    ArgumentNode,
    AssertNode,
    AssignmentExpressionNode,
    AssignmentNode,
    AugmentedAssignmentNode,
    AwaitNode,
    BinaryOperationNode,
    BreakNode,
    CallNode,
    CaseNode,
    ClassNode,
    ConstantNode,
    ContinueNode,
    DecoratorNode,
    DelNode,
    DictionaryEntryNode,
    DictionaryExpandEntryNode,
    DictionaryKeyEntryNode,
    DictionaryNode,
    EllipsisNode,
    ErrorExpressionCategory,
    ErrorNode,
    ExceptNode,
    ExpressionNode,
    extendRange,
    FormatStringNode,
    ForNode,
    FunctionAnnotationNode,
    FunctionNode,
    getNextNodeId,
    GlobalNode,
    IfNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ImportNode,
    IndexNode,
    LambdaNode,
    ListComprehensionForNode,
    ListComprehensionIfNode,
    ListComprehensionIterNode,
    ListComprehensionNode,
    ListNode,
    MatchNode,
    MemberAccessNode,
    ModuleNameNode,
    ModuleNode,
    NameNode,
    NonlocalNode,
    NumberNode,
    ParameterCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    PassNode,
    PatternAsNode,
    PatternAtomNode,
    PatternCaptureNode,
    PatternClassArgumentNode,
    PatternClassNode,
    PatternLiteralNode,
    PatternMappingEntryNode,
    PatternMappingExpandEntryNode,
    PatternMappingKeyEntryNode,
    PatternMappingNode,
    PatternSequenceNode,
    PatternValueNode,
    RaiseNode,
    ReturnNode,
    SetNode,
    SliceNode,
    StatementListNode,
    StatementNode,
    StringListNode,
    StringNode,
    SuiteNode,
    TernaryNode,
    TryNode,
    TupleNode,
    TypeAnnotationNode,
    UnaryOperationNode,
    UnpackNode,
    WhileNode,
    WithItemNode,
    WithNode,
    YieldFromNode,
    YieldNode,
} from './parseNodes';
import * as StringTokenUtils from './stringTokenUtils';
import { Tokenizer, TokenizerOutput } from './tokenizer';
import {
    DedentToken,
    IdentifierToken,
    IndentToken,
    KeywordToken,
    KeywordType,
    NumberToken,
    OperatorToken,
    OperatorType,
    StringToken,
    StringTokenFlags,
    Token,
    TokenType,
} from './tokenizerTypes';

interface ListResult<T> {
    list: T[];
    trailingComma: boolean;
    parseError?: ErrorNode | undefined;
}

interface SubscriptListResult {
    list: ArgumentNode[];
    trailingComma: boolean;
}

export class ParseOptions {
    constructor() {
        this.isStubFile = false;
        this.pythonVersion = latestStablePythonVersion;
        this.reportInvalidStringEscapeSequence = false;
        this.skipFunctionAndClassBody = false;
    }

    isStubFile: boolean;
    pythonVersion: PythonVersion;
    reportInvalidStringEscapeSequence: boolean;
    skipFunctionAndClassBody: boolean;
}

export interface ParseResults {
    text: string;
    parseTree: ModuleNode;
    importedModules: ModuleImport[];
    futureImports: Map<string, boolean>;
    tokenizerOutput: TokenizerOutput;
    containsWildcardImport: boolean;
}

export interface ParseExpressionTextResults {
    parseTree?: ExpressionNode | undefined;
    lines: TextRangeCollection<TextRange>;
    diagnostics: Diagnostic[];
}

export interface ModuleImport {
    nameNode: ModuleNameNode;
    leadingDots: number;
    nameParts: string[];

    // Used for "from X import Y" pattern. An empty
    // array implies "from X import *".
    importedSymbols: string[] | undefined;
}

const enum ParseTextMode {
    Expression,
    VariableAnnotation,
    FunctionAnnotation,
}

// PEP 637 proposed support for keyword arguments in subscript
// expressions, but it was rejected.
const supportPEP637 = false;

export class Parser {
    private _fileContents?: string;
    private _tokenizerOutput?: TokenizerOutput;
    private _tokenIndex = 0;
    private _areErrorsSuppressed = false;
    private _parseOptions: ParseOptions = new ParseOptions();
    private _diagSink: DiagnosticSink = new DiagnosticSink();
    private _isInLoop = false;
    private _isInFunction = false;
    private _isInFinally = false;
    private _isParsingTypeAnnotation = false;
    private _isParsingIndexTrailer = false;
    private _futureImportMap = new Map<string, boolean>();
    private _importedModules: ModuleImport[] = [];
    private _containsWildcardImport = false;
    private _assignmentExpressionsAllowed = true;
    private _typingImportAliases: string[] = [];
    private _typingSymbolAliases: Map<string, string> = new Map<string, string>();

    parseSourceFile(fileContents: string, parseOptions: ParseOptions, diagSink: DiagnosticSink): ParseResults {
        timingStats.tokenizeFileTime.timeOperation(() => {
            this._startNewParse(fileContents, 0, fileContents.length, parseOptions, diagSink);
        });

        const moduleNode = ModuleNode.create({ start: 0, length: fileContents.length });

        timingStats.parseFileTime.timeOperation(() => {
            while (!this._atEof()) {
                if (!this._consumeTokenIfType(TokenType.NewLine)) {
                    // Handle a common error case and try to recover.
                    const nextToken = this._peekToken();
                    if (nextToken.type === TokenType.Indent) {
                        this._getNextToken();
                        const indentToken = nextToken as IndentToken;
                        if (indentToken.isIndentAmbiguous) {
                            this._addError(Localizer.Diagnostic.inconsistentTabs(), indentToken);
                        } else {
                            this._addError(Localizer.Diagnostic.unexpectedIndent(), nextToken);
                        }
                    }

                    const statement = this._parseStatement();
                    if (!statement) {
                        // Perform basic error recovery to get to the next line.
                        this._consumeTokensUntilType([TokenType.NewLine]);
                    } else {
                        statement.parent = moduleNode;
                        moduleNode.statements.push(statement);
                    }
                }
            }
        });

        assert(this._tokenizerOutput !== undefined);
        return {
            text: fileContents,
            parseTree: moduleNode,
            importedModules: this._importedModules,
            futureImports: this._futureImportMap,
            tokenizerOutput: this._tokenizerOutput!,
            containsWildcardImport: this._containsWildcardImport,
        };
    }

    parseTextExpression(
        fileContents: string,
        textOffset: number,
        textLength: number,
        parseOptions: ParseOptions,
        parseTextMode = ParseTextMode.Expression,
        initialParenDepth = 0
    ): ParseExpressionTextResults {
        const diagSink = new DiagnosticSink();
        this._startNewParse(fileContents, textOffset, textLength, parseOptions, diagSink, initialParenDepth);

        let parseTree: ExpressionNode | undefined;
        if (parseTextMode === ParseTextMode.VariableAnnotation) {
            parseTree = this._parseTypeAnnotation();
        } else if (parseTextMode === ParseTextMode.FunctionAnnotation) {
            parseTree = this._parseFunctionTypeAnnotation();
        } else {
            const exprListResult = this._parseTestOrStarExpressionList(/* allowAssignmentExpression */ false);
            if (exprListResult.parseError) {
                parseTree = exprListResult.parseError;
            } else {
                if (exprListResult.list.length === 0) {
                    this._addError(Localizer.Diagnostic.expectedExpr(), this._peekToken());
                }
                parseTree = this._makeExpressionOrTuple(exprListResult, /* enclosedInParens */ false);
            }
        }

        if (this._peekTokenType() === TokenType.NewLine) {
            this._getNextToken();
        }

        if (!this._atEof()) {
            this._addError(Localizer.Diagnostic.unexpectedExprToken(), this._peekToken());
        }

        return {
            parseTree,
            lines: this._tokenizerOutput!.lines,
            diagnostics: diagSink.fetchAndClear(),
        };
    }

    private _startNewParse(
        fileContents: string,
        textOffset: number,
        textLength: number,
        parseOptions: ParseOptions,
        diagSink: DiagnosticSink,
        initialParenDepth = 0
    ) {
        this._fileContents = fileContents;
        this._parseOptions = parseOptions;
        this._diagSink = diagSink;

        // Tokenize the file contents.
        const tokenizer = new Tokenizer();
        this._tokenizerOutput = tokenizer.tokenize(fileContents, textOffset, textLength, initialParenDepth);
        this._tokenIndex = 0;
    }

    // stmt: simple_stmt | compound_stmt
    // compound_stmt: if_stmt | while_stmt | for_stmt | try_stmt | with_stmt
    //   | funcdef | classdef | decorated | async_stmt
    private _parseStatement(): StatementNode | ErrorNode | undefined {
        // Handle the errant condition of a dedent token here to provide
        // better recovery.
        if (this._consumeTokenIfType(TokenType.Dedent)) {
            this._addError(Localizer.Diagnostic.unexpectedUnindent(), this._peekToken());
        }

        switch (this._peekKeywordType()) {
            case KeywordType.If:
                return this._parseIfStatement();

            case KeywordType.While:
                return this._parseWhileStatement();

            case KeywordType.For:
                return this._parseForStatement();

            case KeywordType.Try:
                return this._parseTryStatement();

            case KeywordType.With:
                return this._parseWithStatement();

            case KeywordType.Def:
                return this._parseFunctionDef();

            case KeywordType.Class:
                return this._parseClassDef();

            case KeywordType.Async:
                return this._parseAsyncStatement();

            case KeywordType.Match: {
                // Match is considered a "soft" keyword, so we will treat
                // it as an identifier if it is followed by an unexpected
                // token.
                const peekToken = this._peekToken(1);
                let isInvalidMatchToken = false;

                if (
                    peekToken.type === TokenType.Colon ||
                    peekToken.type === TokenType.Semicolon ||
                    peekToken.type === TokenType.Comma ||
                    peekToken.type === TokenType.Dot ||
                    peekToken.type === TokenType.NewLine ||
                    peekToken.type === TokenType.EndOfStream
                ) {
                    isInvalidMatchToken = true;
                } else if (peekToken.type === TokenType.Operator) {
                    const operatorToken = peekToken as OperatorToken;
                    if (
                        operatorToken.operatorType !== OperatorType.Multiply &&
                        operatorToken.operatorType !== OperatorType.Subtract
                    ) {
                        isInvalidMatchToken = true;
                    }
                }

                if (!isInvalidMatchToken) {
                    // Try to parse the match statement. If it doesn't appear to
                    // be a match statement, treat as a non-keyword and reparse.
                    const matchStatement = this._parseMatchStatement();
                    if (matchStatement) {
                        return matchStatement;
                    }
                }
            }
        }

        if (this._peekOperatorType() === OperatorType.MatrixMultiply) {
            return this._parseDecorated();
        }

        return this._parseSimpleStatement();
    }

    // async_stmt: 'async' (funcdef | with_stmt | for_stmt)
    private _parseAsyncStatement(): StatementNode | undefined {
        const asyncToken = this._getKeywordToken(KeywordType.Async);

        switch (this._peekKeywordType()) {
            case KeywordType.Def:
                return this._parseFunctionDef(asyncToken);

            case KeywordType.With:
                return this._parseWithStatement(asyncToken);

            case KeywordType.For:
                return this._parseForStatement(asyncToken);
        }

        this._addError(Localizer.Diagnostic.unexpectedAsyncToken(), asyncToken);

        return undefined;
    }

    // match_stmt: "match" subject_expr ':' NEWLINE INDENT case_block+ DEDENT
    // subject_expr:
    //     | star_named_expression ',' star_named_expressions?
    //     | named_expression
    private _parseMatchStatement(): MatchNode | undefined {
        const matchToken = this._getKeywordToken(KeywordType.Match);

        // Parse the subject expression with errors suppressed. If it's not
        // followed by a colon, we'll assume this is not a match statement.
        // We need to do this because "match" is considered a soft keyword,
        // and we need to distinguish between "match(2)" and "match (2):"
        // and between "match[2]" and "match [2]:"
        let smellsLikeMatchStatement = false;
        this._suppressErrors(() => {
            const curTokenIndex = this._tokenIndex;
            this._parseTestOrStarListAsExpression(
                /* allowAssignmentExpression */ true,
                ErrorExpressionCategory.MissingPatternSubject,
                Localizer.Diagnostic.expectedReturnExpr()
            );
            smellsLikeMatchStatement = this._peekToken().type === TokenType.Colon;

            // Set the token index back to the start.
            this._tokenIndex = curTokenIndex;
        });

        if (!smellsLikeMatchStatement) {
            return undefined;
        }

        const subjectExpression = this._parseTestOrStarListAsExpression(
            /* allowAssignmentExpression */ true,
            ErrorExpressionCategory.MissingPatternSubject,
            Localizer.Diagnostic.expectedReturnExpr()
        );
        const matchNode = MatchNode.create(matchToken, subjectExpression);

        const nextToken = this._peekToken();

        if (!this._consumeTokenIfType(TokenType.Colon)) {
            this._addError(Localizer.Diagnostic.expectedColon(), nextToken);

            // Try to perform parse recovery by consuming tokens until
            // we find the end of the line.
            if (this._consumeTokensUntilType([TokenType.NewLine, TokenType.Colon])) {
                this._getNextToken();
            }
        } else if (!this._consumeTokenIfType(TokenType.NewLine)) {
            this._addError(Localizer.Diagnostic.expectedNewline(), nextToken);
        } else {
            const possibleIndent = this._peekToken();
            if (!this._consumeTokenIfType(TokenType.Indent)) {
                this._addError(Localizer.Diagnostic.expectedIndentedBlock(), this._peekToken());
            } else {
                const indentToken = possibleIndent as IndentToken;
                if (indentToken.isIndentAmbiguous) {
                    this._addError(Localizer.Diagnostic.inconsistentTabs(), indentToken);
                }
            }

            while (true) {
                // Handle a common error here and see if we can recover.
                const nextToken = this._peekToken();
                if (nextToken.type === TokenType.Indent) {
                    this._getNextToken();
                    const indentToken = nextToken as IndentToken;
                    if (indentToken.isIndentAmbiguous) {
                        this._addError(Localizer.Diagnostic.inconsistentTabs(), indentToken);
                    } else {
                        this._addError(Localizer.Diagnostic.unexpectedIndent(), nextToken);
                    }
                }

                const caseStatement = this._parseCaseStatement();
                if (!caseStatement) {
                    // Perform basic error recovery to get to the next line.
                    if (this._consumeTokensUntilType([TokenType.NewLine, TokenType.Colon])) {
                        this._getNextToken();
                    }
                } else {
                    caseStatement.parent = matchNode;
                    matchNode.cases.push(caseStatement);
                }

                const dedentToken = this._peekToken() as DedentToken;
                if (this._consumeTokenIfType(TokenType.Dedent)) {
                    if (!dedentToken.matchesIndent) {
                        this._addError(Localizer.Diagnostic.inconsistentIndent(), dedentToken);
                    }
                    break;
                }

                if (this._peekTokenType() === TokenType.EndOfStream) {
                    break;
                }
            }

            if (matchNode.cases.length > 0) {
                extendRange(matchNode, matchNode.cases[matchNode.cases.length - 1]);
            } else {
                this._addError(Localizer.Diagnostic.zeroCaseStatementsFound(), matchToken);
            }
        }

        // This feature requires Python 3.10.
        if (this._getLanguageVersion() < PythonVersion.V3_10) {
            this._addError(Localizer.Diagnostic.matchIncompatible(), matchToken);
        }

        // Validate that only the last entry uses an irrefutable pattern.
        for (let i = 0; i < matchNode.cases.length - 1; i++) {
            const caseNode = matchNode.cases[i];
            if (!caseNode.guardExpression && caseNode.isIrrefutable) {
                this._addError(Localizer.Diagnostic.casePatternIsIrrefutable(), caseNode.pattern);
            }
        }

        return matchNode;
    }

    // case_block: "case" patterns [guard] ':' block
    // patterns: sequence_pattern | as_pattern
    // guard: 'if' named_expression
    private _parseCaseStatement(): CaseNode | undefined {
        const caseToken = this._peekToken();

        if (!this._consumeTokenIfKeyword(KeywordType.Case)) {
            this._addError(Localizer.Diagnostic.expectedCase(), caseToken);
            return undefined;
        }

        const patternList = this._parsePatternSequence();
        let casePattern: PatternAtomNode;

        if (patternList.parseError) {
            casePattern = patternList.parseError;
        } else if (patternList.list.length === 0) {
            this._addError(Localizer.Diagnostic.expectedPatternExpr(), this._peekToken());
            casePattern = ErrorNode.create(caseToken, ErrorExpressionCategory.MissingPattern);
        } else if (patternList.list.length === 1 && !patternList.trailingComma) {
            const pattern = patternList.list[0].orPatterns[0];

            if (pattern.nodeType === ParseNodeType.PatternCapture && pattern.isStar) {
                casePattern = PatternSequenceNode.create(patternList.list[0], patternList.list);
            } else {
                casePattern = patternList.list[0];
            }
        } else {
            casePattern = PatternSequenceNode.create(patternList.list[0], patternList.list);
        }

        let guardExpression: ExpressionNode | undefined;
        if (this._consumeTokenIfKeyword(KeywordType.If)) {
            guardExpression = this._parseTestExpression(/* allowAssignmentExpression */ true);
        }

        const suite = this._parseSuite(this._isInFunction);
        return CaseNode.create(caseToken, casePattern, this._isPatternIrrefutable(casePattern), guardExpression, suite);
    }

    // PEP 634 defines the concept of an "irrefutable" pattern - a pattern that
    // will always be matched.
    private _isPatternIrrefutable(node: PatternAtomNode): boolean {
        if (node.nodeType === ParseNodeType.PatternCapture) {
            return true;
        }

        if (node.nodeType === ParseNodeType.PatternAs) {
            return node.orPatterns.some((pattern) => this._isPatternIrrefutable(pattern));
        }

        return false;
    }

    private _getPatternTargetNames(node: PatternAtomNode, nameMap: Map<string, boolean>): void {
        switch (node.nodeType) {
            case ParseNodeType.PatternSequence: {
                node.entries.forEach((subpattern) => {
                    this._getPatternTargetNames(subpattern, nameMap);
                });
                break;
            }

            case ParseNodeType.PatternClass: {
                node.arguments.forEach((arg) => {
                    this._getPatternTargetNames(arg.pattern, nameMap);
                });
                break;
            }

            case ParseNodeType.PatternAs: {
                if (node.target) {
                    nameMap.set(node.target.value, true);
                }
                node.orPatterns.forEach((subpattern) => {
                    this._getPatternTargetNames(subpattern, nameMap);
                });
                break;
            }

            case ParseNodeType.PatternCapture: {
                if (!node.isWildcard) {
                    nameMap.set(node.target.value, true);
                }
                break;
            }

            case ParseNodeType.PatternMapping: {
                node.entries.forEach((mapEntry) => {
                    if (mapEntry.nodeType === ParseNodeType.PatternMappingExpandEntry) {
                        nameMap.set(mapEntry.target.value, true);
                    } else {
                        this._getPatternTargetNames(mapEntry.keyPattern, nameMap);
                        this._getPatternTargetNames(mapEntry.valuePattern, nameMap);
                    }
                });
                break;
            }

            case ParseNodeType.PatternLiteral:
            case ParseNodeType.PatternValue:
            case ParseNodeType.Error: {
                break;
            }
        }
    }

    private _parsePatternSequence() {
        const patternList = this._parseExpressionListGeneric(() => this._parsePatternAs());

        // Check for more than one star entry.
        const starEntries = patternList.list.filter(
            (entry) =>
                entry.orPatterns.length === 1 &&
                entry.orPatterns[0].nodeType === ParseNodeType.PatternCapture &&
                entry.orPatterns[0].isStar
        );
        if (starEntries.length > 1) {
            this._addError(Localizer.Diagnostic.duplicateStarPattern(), starEntries[1].orPatterns[0]);
        }

        // Look for redundant capture targets.
        const captureTargetMap = new Map<string, PatternAtomNode>();
        patternList.list.forEach((asPattern) => {
            asPattern.orPatterns.forEach((patternAtom) => {
                if (
                    patternAtom.nodeType === ParseNodeType.PatternCapture &&
                    !patternAtom.isStar &&
                    !patternAtom.isWildcard
                ) {
                    if (captureTargetMap.has(patternAtom.target.value)) {
                        this._addError(
                            Localizer.Diagnostic.duplicateCapturePatternTarget().format({
                                name: patternAtom.target.value,
                            }),
                            patternAtom
                        );
                    } else {
                        captureTargetMap.set(patternAtom.target.value, patternAtom);
                    }
                }
            });
        });

        return patternList;
    }

    // as_pattern: or_pattern ['as' NAME]
    // or_pattern: '|'.pattern_atom+
    private _parsePatternAs(): PatternAsNode {
        const orPatterns: PatternAtomNode[] = [];

        while (true) {
            const patternAtom = this._parsePatternAtom();
            orPatterns.push(patternAtom);

            if (!this._consumeTokenIfOperator(OperatorType.BitwiseOr)) {
                break;
            }
        }

        if (orPatterns.length > 1) {
            // Star patterns cannot be ORed with other patterns.
            orPatterns.forEach((patternAtom) => {
                if (patternAtom.nodeType === ParseNodeType.PatternCapture && patternAtom.isStar) {
                    this._addError(Localizer.Diagnostic.starPatternInOrPattern(), patternAtom);
                }
            });
        }

        let target: NameNode | undefined;
        if (this._consumeTokenIfKeyword(KeywordType.As)) {
            const nameToken = this._getTokenIfIdentifier();
            if (nameToken) {
                target = NameNode.create(nameToken);
            } else {
                this._addError(Localizer.Diagnostic.expectedNameAfterAs(), this._peekToken());
            }
        }

        // Star patterns cannot be used with AS pattern.
        if (
            target &&
            orPatterns.length === 1 &&
            orPatterns[0].nodeType === ParseNodeType.PatternCapture &&
            orPatterns[0].isStar
        ) {
            this._addError(Localizer.Diagnostic.starPatternInAsPattern(), orPatterns[0]);
        }

        // Validate that irrefutable patterns are not in any entries other than the last.
        orPatterns.forEach((orPattern, index) => {
            if (index < orPatterns.length - 1 && this._isPatternIrrefutable(orPattern)) {
                this._addError(Localizer.Diagnostic.orPatternIrrefutable(), orPattern);
            }
        });

        // Validate that all bound variables are the same within all or patterns.
        const fullNameMap = new Map<string, boolean>();
        orPatterns.forEach((orPattern) => {
            this._getPatternTargetNames(orPattern, fullNameMap);
        });

        orPatterns.forEach((orPattern) => {
            const localNameMap = new Map<string, boolean>();
            this._getPatternTargetNames(orPattern, localNameMap);

            if (localNameMap.size < fullNameMap.size) {
                const missingNames = Array.from(fullNameMap.keys()).filter((name) => !localNameMap.has(name));
                const diag = new DiagnosticAddendum();
                diag.addMessage(
                    Localizer.DiagnosticAddendum.orPatternMissingName().format({
                        name: missingNames.map((name) => `"${name}"`).join(', '),
                    })
                );
                this._addError(Localizer.Diagnostic.orPatternMissingName() + diag.getString(), orPattern);
            }
        });

        return PatternAsNode.create(orPatterns, target);
    }

    // pattern_atom:
    //     | literal_pattern
    //     | name_or_attr
    //     | '(' as_pattern ')'
    //     | '[' [sequence_pattern] ']'
    //     | '(' [sequence_pattern] ')'
    //     | '{' [items_pattern] '}'
    //     | name_or_attr '(' [pattern_arguments ','?] ')'
    // name_or_attr: attr | NAME
    // attr: name_or_attr '.' NAME
    // sequence_pattern: ','.maybe_star_pattern+ ','?
    // maybe_star_pattern: '*' NAME | pattern
    // items_pattern: ','.key_value_pattern+ ','?
    private _parsePatternAtom(): PatternAtomNode {
        const patternLiteral = this._parsePatternLiteral();
        if (patternLiteral) {
            return patternLiteral;
        }

        const patternCaptureOrValue = this._parsePatternCaptureOrValue();
        if (patternCaptureOrValue) {
            if (
                patternCaptureOrValue.nodeType === ParseNodeType.Error ||
                !this._consumeTokenIfType(TokenType.OpenParenthesis)
            ) {
                return patternCaptureOrValue;
            }

            const args = this._parseClassPatternArgList();

            const classNameExpr =
                patternCaptureOrValue.nodeType === ParseNodeType.PatternCapture
                    ? patternCaptureOrValue.target
                    : patternCaptureOrValue.expression;
            const classPattern = PatternClassNode.create(classNameExpr, args);

            if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                this._addError(Localizer.Diagnostic.expectedCloseParen(), this._peekToken());

                // Consume the remainder of tokens on the line for error
                // recovery.
                this._consumeTokensUntilType([TokenType.NewLine]);

                // Extend the node's range to include the rest of the line.
                // This helps the signatureHelpProvider.
                extendRange(classPattern, this._peekToken());
            }

            return classPattern;
        }

        const nextToken = this._peekToken();
        const nextOperator = this._peekOperatorType();

        if (nextOperator === OperatorType.Multiply) {
            const starToken = this._getNextToken();
            const identifierToken = this._getTokenIfIdentifier();
            if (!identifierToken) {
                this._addError(Localizer.Diagnostic.expectedIdentifier(), this._peekToken());
                return ErrorNode.create(starToken, ErrorExpressionCategory.MissingExpression);
            } else {
                return PatternCaptureNode.create(NameNode.create(identifierToken), starToken);
            }
        }

        if (nextToken.type === TokenType.OpenParenthesis || nextToken.type === TokenType.OpenBracket) {
            const startToken = this._getNextToken();
            const patternList = this._parsePatternSequence();
            let casePattern: PatternAtomNode;

            if (patternList.parseError) {
                casePattern = patternList.parseError;
            } else if (
                patternList.list.length === 1 &&
                !patternList.trailingComma &&
                startToken.type === TokenType.OpenParenthesis
            ) {
                const pattern = patternList.list[0].orPatterns[0];

                if (pattern.nodeType === ParseNodeType.PatternCapture && pattern.isStar) {
                    casePattern = PatternSequenceNode.create(startToken, patternList.list);
                } else {
                    casePattern = patternList.list[0];
                }

                extendRange(casePattern, nextToken);
            } else {
                casePattern = PatternSequenceNode.create(startToken, patternList.list);
            }

            const endToken = this._peekToken();
            if (
                this._consumeTokenIfType(
                    nextToken.type === TokenType.OpenParenthesis ? TokenType.CloseParenthesis : TokenType.CloseBracket
                )
            ) {
                extendRange(casePattern, endToken);
            } else {
                this._addError(
                    nextToken.type === TokenType.OpenParenthesis
                        ? Localizer.Diagnostic.expectedCloseParen()
                        : Localizer.Diagnostic.expectedCloseBracket(),
                    this._peekToken()
                );
                this._consumeTokensUntilType([
                    TokenType.Colon,
                    nextToken.type === TokenType.OpenParenthesis ? TokenType.CloseParenthesis : TokenType.CloseBracket,
                ]);
            }

            return casePattern;
        } else if (nextToken.type === TokenType.OpenCurlyBrace) {
            const firstToken = this._getNextToken();
            const mappingPattern = this._parsePatternMapping(firstToken);
            const lastToken = this._peekToken();

            if (this._consumeTokenIfType(TokenType.CloseCurlyBrace)) {
                extendRange(mappingPattern, lastToken);
            } else {
                this._addError(Localizer.Diagnostic.expectedCloseBrace(), this._peekToken());
                this._consumeTokensUntilType([TokenType.Colon, TokenType.CloseCurlyBrace]);
            }

            return mappingPattern;
        }

        return this._handleExpressionParseError(
            ErrorExpressionCategory.MissingPattern,
            Localizer.Diagnostic.expectedPatternExpr()
        );
    }

    // pattern_arguments:
    //     | positional_patterns [',' keyword_patterns]
    //     | keyword_patterns
    // positional_patterns: ','.as_pattern+
    // keyword_patterns: ','.keyword_pattern+
    private _parseClassPatternArgList(): PatternClassArgumentNode[] {
        const argList: PatternClassArgumentNode[] = [];
        let sawKeywordArg = false;

        while (true) {
            const nextTokenType = this._peekTokenType();
            if (
                nextTokenType === TokenType.CloseParenthesis ||
                nextTokenType === TokenType.NewLine ||
                nextTokenType === TokenType.EndOfStream
            ) {
                break;
            }

            const arg = this._parseClassPatternArgument();
            if (arg.name) {
                sawKeywordArg = true;
            } else if (sawKeywordArg && !arg.name) {
                this._addError(Localizer.Diagnostic.positionArgAfterNamedArg(), arg);
            }
            argList.push(arg);

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        return argList;
    }

    // keyword_pattern: NAME '=' as_pattern
    private _parseClassPatternArgument(): PatternClassArgumentNode {
        const firstToken = this._peekToken();
        const secondToken = this._peekToken(1);

        let keywordName: NameNode | undefined;

        if (
            (firstToken.type === TokenType.Identifier || firstToken.type === TokenType.Keyword) &&
            secondToken.type === TokenType.Operator &&
            (secondToken as OperatorToken).operatorType === OperatorType.Assign
        ) {
            this._getNextToken();
            keywordName = NameNode.create(firstToken as IdentifierToken);
            this._getNextToken();
        }

        const pattern = this._parsePatternAs();

        return PatternClassArgumentNode.create(pattern, keywordName);
    }

    // literal_pattern:
    //     | signed_number
    //     | signed_number '+' NUMBER
    //     | signed_number '-' NUMBER
    //     | strings
    //     | 'None'
    //     | 'True'
    //     | 'False'
    private _parsePatternLiteral(): PatternLiteralNode | undefined {
        const nextToken = this._peekToken();
        const nextOperator = this._peekOperatorType();

        if (nextToken.type === TokenType.Number || nextOperator === OperatorType.Subtract) {
            return this._parsePatternLiteralNumber();
        }

        if (nextToken.type === TokenType.String) {
            const stringList = this._parseAtom() as StringListNode;
            assert(stringList.nodeType === ParseNodeType.StringList);

            // Check for f-strings, which are not allowed.
            stringList.strings.forEach((stringAtom) => {
                if (stringAtom.token.flags & StringTokenFlags.Format) {
                    this._addError(Localizer.Diagnostic.formatStringInPattern(), stringAtom);
                }
            });

            return PatternLiteralNode.create(stringList);
        }

        if (nextToken.type === TokenType.Keyword) {
            const keywordToken = nextToken as KeywordToken;
            if (
                keywordToken.keywordType === KeywordType.False ||
                keywordToken.keywordType === KeywordType.True ||
                keywordToken.keywordType === KeywordType.None
            ) {
                return PatternLiteralNode.create(this._parseAtom());
            }
        }

        return undefined;
    }

    // signed_number: NUMBER | '-' NUMBER
    private _parsePatternLiteralNumber(): PatternLiteralNode {
        const expression = this._parseArithmeticExpression();
        let realValue: ExpressionNode | undefined;
        let imagValue: ExpressionNode | undefined;

        if (expression.nodeType === ParseNodeType.BinaryOperation) {
            if (expression.operator === OperatorType.Subtract || expression.operator === OperatorType.Add) {
                realValue = expression.leftExpression;
                imagValue = expression.rightExpression;
            }
        } else {
            realValue = expression;
        }

        if (realValue) {
            if (realValue.nodeType === ParseNodeType.UnaryOperation && realValue.operator === OperatorType.Subtract) {
                realValue = realValue.expression;
            }

            if (realValue.nodeType !== ParseNodeType.Number || (imagValue !== undefined && realValue.isImaginary)) {
                this._addError(Localizer.Diagnostic.expectedComplexNumberLiteral(), expression);
                imagValue = undefined;
            }
        }

        if (imagValue) {
            if (imagValue.nodeType === ParseNodeType.UnaryOperation && imagValue.operator === OperatorType.Subtract) {
                imagValue = imagValue.expression;
            }

            if (imagValue.nodeType !== ParseNodeType.Number || !imagValue.isImaginary) {
                this._addError(Localizer.Diagnostic.expectedComplexNumberLiteral(), expression);
            }
        }

        return PatternLiteralNode.create(expression);
    }

    private _parsePatternMapping(firstToken: Token): PatternMappingNode | ErrorNode {
        const itemList = this._parseExpressionListGeneric(() => this._parsePatternMappingItem());

        if (itemList.list.length > 0) {
            // Verify there's at most one ** entry.
            const starStarEntries = itemList.list.filter(
                (entry) => entry.nodeType === ParseNodeType.PatternMappingExpandEntry
            );
            if (starStarEntries.length > 1) {
                this._addError(Localizer.Diagnostic.duplicateStarStarPattern(), starStarEntries[1]);
            }

            return PatternMappingNode.create(firstToken, itemList.list);
        }

        return itemList.parseError || ErrorNode.create(this._peekToken(), ErrorExpressionCategory.MissingPattern);
    }

    // key_value_pattern:
    //     | (literal_pattern | attr) ':' as_pattern
    //     | '**' NAME
    private _parsePatternMappingItem(): PatternMappingEntryNode | ErrorNode {
        let keyExpression: PatternLiteralNode | PatternValueNode | ErrorNode | undefined;
        const doubleStar = this._peekToken();

        if (this._consumeTokenIfOperator(OperatorType.Power)) {
            const identifierToken = this._getTokenIfIdentifier();
            if (!identifierToken) {
                this._addError(Localizer.Diagnostic.expectedIdentifier(), this._peekToken());
                return ErrorNode.create(this._peekToken(), ErrorExpressionCategory.MissingPattern);
            }

            const nameNode = NameNode.create(identifierToken);
            if (identifierToken.value === '_') {
                this._addError(Localizer.Diagnostic.starStarWildcardNotAllowed(), nameNode);
            }

            return PatternMappingExpandEntryNode.create(doubleStar, nameNode);
        }

        const patternLiteral = this._parsePatternLiteral();
        if (patternLiteral) {
            keyExpression = patternLiteral;
        } else {
            const patternCaptureOrValue = this._parsePatternCaptureOrValue();
            if (patternCaptureOrValue) {
                if (patternCaptureOrValue.nodeType === ParseNodeType.PatternValue) {
                    keyExpression = patternCaptureOrValue;
                } else {
                    this._addError(Localizer.Diagnostic.expectedPatternValue(), patternCaptureOrValue);
                    keyExpression = ErrorNode.create(this._peekToken(), ErrorExpressionCategory.MissingPattern);
                }
            }
        }

        if (!keyExpression) {
            this._addError(Localizer.Diagnostic.expectedPatternExpr(), this._peekToken());
            keyExpression = ErrorNode.create(this._peekToken(), ErrorExpressionCategory.MissingPattern);
        }

        let valuePattern: PatternAtomNode | undefined;
        if (!this._consumeTokenIfType(TokenType.Colon)) {
            this._addError(Localizer.Diagnostic.expectedColon(), this._peekToken());
            valuePattern = ErrorNode.create(this._peekToken(), ErrorExpressionCategory.MissingPattern);
        } else {
            valuePattern = this._parsePatternAs();
        }

        return PatternMappingKeyEntryNode.create(keyExpression, valuePattern);
    }

    private _parsePatternCaptureOrValue(): PatternCaptureNode | PatternValueNode | ErrorNode | undefined {
        const nextToken = this._peekToken();

        if (nextToken.type === TokenType.Identifier || nextToken.type === TokenType.Keyword) {
            let nameOrMember: NameNode | MemberAccessNode | undefined;

            while (true) {
                const identifierToken = this._getTokenIfIdentifier();
                if (identifierToken) {
                    const nameNode = NameNode.create(identifierToken);
                    nameOrMember = nameOrMember ? MemberAccessNode.create(nameOrMember, nameNode) : nameNode;
                } else {
                    this._addError(Localizer.Diagnostic.expectedIdentifier(), this._peekToken());
                    break;
                }

                if (!this._consumeTokenIfType(TokenType.Dot)) {
                    break;
                }
            }

            if (!nameOrMember) {
                this._addError(Localizer.Diagnostic.expectedIdentifier(), this._peekToken());
                return ErrorNode.create(this._peekToken(), ErrorExpressionCategory.MissingPattern);
            }

            if (nameOrMember.nodeType === ParseNodeType.MemberAccess) {
                return PatternValueNode.create(nameOrMember);
            }

            return PatternCaptureNode.create(nameOrMember);
        }

        return undefined;
    }

    // if_stmt: 'if' test_suite ('elif' test_suite)* ['else' suite]
    // test_suite: test suite
    // test: or_test ['if' or_test 'else' test] | lambdef
    private _parseIfStatement(keywordType: KeywordType.If | KeywordType.Elif = KeywordType.If): IfNode {
        const ifOrElifToken = this._getKeywordToken(keywordType);

        const test = this._parseTestExpression(/* allowAssignmentExpression */ true);
        const suite = this._parseSuite(this._isInFunction);
        const ifNode = IfNode.create(ifOrElifToken, test, suite);

        if (this._consumeTokenIfKeyword(KeywordType.Else)) {
            ifNode.elseSuite = this._parseSuite(this._isInFunction);
            ifNode.elseSuite.parent = ifNode;
            extendRange(ifNode, ifNode.elseSuite);
        } else if (this._peekKeywordType() === KeywordType.Elif) {
            // Recursively handle an "elif" statement.
            ifNode.elseSuite = this._parseIfStatement(KeywordType.Elif);
            ifNode.elseSuite.parent = ifNode;
            extendRange(ifNode, ifNode.elseSuite);
        }

        return ifNode;
    }

    private _parseLoopSuite(): SuiteNode {
        const wasInLoop = this._isInLoop;
        const wasInFinally = this._isInFinally;
        this._isInLoop = true;
        this._isInFinally = false;

        const suite = this._parseSuite(this._isInFunction);

        this._isInLoop = wasInLoop;
        this._isInFinally = wasInFinally;

        return suite;
    }

    // suite: ':' (simple_stmt | NEWLINE INDENT stmt+ DEDENT)
    private _parseSuite(isFunction = false, skipBody = false, postColonCallback?: () => void): SuiteNode {
        const nextToken = this._peekToken();
        const suite = SuiteNode.create(nextToken);

        if (!this._consumeTokenIfType(TokenType.Colon)) {
            this._addError(Localizer.Diagnostic.expectedColon(), nextToken);

            // Try to perform parse recovery by consuming tokens.
            if (this._consumeTokensUntilType([TokenType.NewLine, TokenType.Colon])) {
                if (this._peekTokenType() === TokenType.Colon) {
                    this._getNextToken();
                } else if (this._peekToken(1).type !== TokenType.Indent) {
                    // Bail so we resume the at the next statement.
                    // We can't parse as a simple statement as we've skipped all but the newline.
                    this._getNextToken();
                    return suite;
                }
            }
        }

        if (skipBody) {
            if (this._consumeTokenIfType(TokenType.NewLine)) {
                let indent = 0;
                while (true) {
                    const nextToken = this._getNextToken();
                    if (nextToken.type === TokenType.Indent) {
                        indent++;
                    }

                    if (nextToken.type === TokenType.Dedent) {
                        indent--;

                        if (indent === 0) {
                            break;
                        }
                    }

                    if (nextToken.type === TokenType.EndOfStream) {
                        break;
                    }
                }
            } else {
                // consume tokens
                this._parseSimpleStatement();
            }

            if (this._tokenIndex > 0) {
                extendRange(suite, this._tokenizerOutput!.tokens.getItemAt(this._tokenIndex - 1));
            }

            return suite;
        }

        if (postColonCallback) {
            postColonCallback();
        }

        const wasFunction = this._isInFunction;
        this._isInFunction = isFunction;

        if (this._consumeTokenIfType(TokenType.NewLine)) {
            if (postColonCallback) {
                postColonCallback();
            }

            const possibleIndent = this._peekToken();
            if (!this._consumeTokenIfType(TokenType.Indent)) {
                this._addError(Localizer.Diagnostic.expectedIndentedBlock(), this._peekToken());
            } else {
                const indentToken = possibleIndent as IndentToken;
                if (indentToken.isIndentAmbiguous) {
                    this._addError(Localizer.Diagnostic.inconsistentTabs(), indentToken);
                }
            }

            while (true) {
                // Handle a common error here and see if we can recover.
                const nextToken = this._peekToken();
                if (nextToken.type === TokenType.Indent) {
                    this._getNextToken();
                    const indentToken = nextToken as IndentToken;
                    if (indentToken.isIndentAmbiguous) {
                        this._addError(Localizer.Diagnostic.inconsistentTabs(), indentToken);
                    } else {
                        this._addError(Localizer.Diagnostic.unexpectedIndent(), nextToken);
                    }
                }

                const statement = this._parseStatement();
                if (!statement) {
                    // Perform basic error recovery to get to the next line.
                    this._consumeTokensUntilType([TokenType.NewLine]);
                } else {
                    statement.parent = suite;
                    suite.statements.push(statement);
                }

                const dedentToken = this._peekToken() as DedentToken;
                if (this._consumeTokenIfType(TokenType.Dedent)) {
                    if (!dedentToken.matchesIndent) {
                        this._addError(Localizer.Diagnostic.inconsistentIndent(), dedentToken);
                    }
                    break;
                }

                if (this._peekTokenType() === TokenType.EndOfStream) {
                    break;
                }
            }
        } else {
            const simpleStatement = this._parseSimpleStatement();
            suite.statements.push(simpleStatement);
            simpleStatement.parent = suite;
        }

        if (suite.statements.length > 0) {
            extendRange(suite, suite.statements[suite.statements.length - 1]);
        }

        this._isInFunction = wasFunction;

        return suite;
    }

    // for_stmt: [async] 'for' exprlist 'in' testlist suite ['else' suite]
    private _parseForStatement(asyncToken?: KeywordToken): ForNode {
        const forToken = this._getKeywordToken(KeywordType.For);

        const targetExpr = this._parseExpressionListAsPossibleTuple(
            ErrorExpressionCategory.MissingExpression,
            Localizer.Diagnostic.expectedExpr(),
            forToken
        );

        let seqExpr: ExpressionNode;
        let forSuite: SuiteNode;
        let elseSuite: SuiteNode | undefined;

        if (!this._consumeTokenIfKeyword(KeywordType.In)) {
            seqExpr = this._handleExpressionParseError(
                ErrorExpressionCategory.MissingIn,
                Localizer.Diagnostic.expectedIn()
            );
            forSuite = SuiteNode.create(this._peekToken());
        } else {
            seqExpr = this._parseTestListAsExpression(
                ErrorExpressionCategory.MissingExpression,
                Localizer.Diagnostic.expectedInExpr()
            );
            forSuite = this._parseLoopSuite();

            if (this._consumeTokenIfKeyword(KeywordType.Else)) {
                elseSuite = this._parseSuite(this._isInFunction);
            }
        }

        const forNode = ForNode.create(forToken, targetExpr, seqExpr, forSuite);
        forNode.elseSuite = elseSuite;
        if (elseSuite) {
            extendRange(forNode, elseSuite);
            elseSuite.parent = forNode;
        }

        if (asyncToken) {
            forNode.isAsync = true;
            forNode.asyncToken = asyncToken;
            extendRange(forNode, asyncToken);
        }

        return forNode;
    }

    // comp_iter: comp_for | comp_if
    private _tryParseListComprehension(target: ParseNode): ListComprehensionNode | undefined {
        const compFor = this._tryParseCompForStatement();

        if (!compFor) {
            return undefined;
        }

        if (target.nodeType === ParseNodeType.Unpack) {
            this._addError(Localizer.Diagnostic.unpackIllegalInComprehension(), target);
        } else if (target.nodeType === ParseNodeType.DictionaryExpandEntry) {
            this._addError(Localizer.Diagnostic.dictExpandIllegalInComprehension(), target);
        }

        const listCompNode = ListComprehensionNode.create(target);

        const compList: ListComprehensionIterNode[] = [compFor];
        while (true) {
            const compIter = this._tryParseCompForStatement() || this._tryParseCompIfStatement();
            if (!compIter) {
                break;
            }
            compIter.parent = listCompNode;
            compList.push(compIter);
        }

        listCompNode.comprehensions = compList;
        if (compList.length > 0) {
            compList.forEach((comp) => {
                comp.parent = listCompNode;
            });
            extendRange(listCompNode, compList[compList.length - 1]);
        }
        return listCompNode;
    }

    // comp_for: ['async'] 'for' exprlist 'in' or_test [comp_iter]
    private _tryParseCompForStatement(): ListComprehensionForNode | undefined {
        const startTokenKeywordType = this._peekKeywordType();

        if (startTokenKeywordType === KeywordType.Async) {
            const nextToken = this._peekToken(1) as KeywordToken;
            if (nextToken.type !== TokenType.Keyword || nextToken.keywordType !== KeywordType.For) {
                return undefined;
            }
        } else if (startTokenKeywordType !== KeywordType.For) {
            return undefined;
        }

        let asyncToken: KeywordToken | undefined;
        if (this._peekKeywordType() === KeywordType.Async) {
            asyncToken = this._getKeywordToken(KeywordType.Async);
        }

        const forToken = this._getKeywordToken(KeywordType.For);

        const targetExpr = this._parseExpressionListAsPossibleTuple(
            ErrorExpressionCategory.MissingExpression,
            Localizer.Diagnostic.expectedExpr(),
            forToken
        );
        let seqExpr: ExpressionNode | undefined;

        if (!this._consumeTokenIfKeyword(KeywordType.In)) {
            seqExpr = this._handleExpressionParseError(
                ErrorExpressionCategory.MissingIn,
                Localizer.Diagnostic.expectedIn()
            );
        } else {
            this._disallowAssignmentExpression(() => {
                seqExpr = this._parseOrTest();
            });
        }

        const compForNode = ListComprehensionForNode.create(asyncToken || forToken, targetExpr, seqExpr!);

        if (asyncToken) {
            compForNode.isAsync = true;
            compForNode.asyncToken = asyncToken;
        }

        return compForNode;
    }

    // comp_if: 'if' test_nocond [comp_iter]
    // comp_iter: comp_for | comp_if
    private _tryParseCompIfStatement(): ListComprehensionIfNode | undefined {
        if (this._peekKeywordType() !== KeywordType.If) {
            return undefined;
        }

        const ifToken = this._getKeywordToken(KeywordType.If);
        const ifExpr = this._tryParseLambdaExpression() || this._parseAssignmentExpression();

        const compIfNode = ListComprehensionIfNode.create(ifToken, ifExpr);

        return compIfNode;
    }

    // while_stmt: 'while' test suite ['else' suite]
    private _parseWhileStatement(): WhileNode {
        const whileToken = this._getKeywordToken(KeywordType.While);

        const whileNode = WhileNode.create(
            whileToken,
            this._parseTestExpression(/* allowAssignmentExpression */ true),
            this._parseLoopSuite()
        );

        if (this._consumeTokenIfKeyword(KeywordType.Else)) {
            whileNode.elseSuite = this._parseSuite(this._isInFunction);
            whileNode.elseSuite.parent = whileNode;
            extendRange(whileNode, whileNode.elseSuite);
        }

        return whileNode;
    }

    // try_stmt: ('try' suite
    //         ((except_clause suite)+
    //             ['else' suite]
    //             ['finally' suite] |
    //         'finally' suite))
    // except_clause: 'except' [test ['as' NAME]]
    private _parseTryStatement(): TryNode {
        const tryToken = this._getKeywordToken(KeywordType.Try);
        const trySuite = this._parseSuite(this._isInFunction);
        const tryNode = TryNode.create(tryToken, trySuite);
        let sawCatchAllExcept = false;

        while (true) {
            const exceptToken = this._peekToken();
            if (!this._consumeTokenIfKeyword(KeywordType.Except)) {
                break;
            }

            let typeExpr: ExpressionNode | undefined;
            let symbolName: IdentifierToken | undefined;
            if (this._peekTokenType() !== TokenType.Colon) {
                typeExpr = this._parseTestExpression(/* allowAssignmentExpression */ true);

                if (this._consumeTokenIfKeyword(KeywordType.As)) {
                    symbolName = this._getTokenIfIdentifier();
                    if (!symbolName) {
                        this._addError(Localizer.Diagnostic.expectedNameAfterAs(), this._peekToken());
                    }
                } else {
                    // Handle the python 2.x syntax in a graceful manner.
                    const peekToken = this._peekToken();
                    if (this._consumeTokenIfType(TokenType.Comma)) {
                        this._addError(Localizer.Diagnostic.expectedAsAfterException(), peekToken);

                        // Parse the expression expected in python 2.x, but discard it.
                        this._parseTestExpression(/* allowAssignmentExpression */ false);
                    }
                }
            }

            if (!typeExpr) {
                if (sawCatchAllExcept) {
                    this._addError(Localizer.Diagnostic.duplicateCatchAll(), exceptToken);
                }
                sawCatchAllExcept = true;
            } else {
                if (sawCatchAllExcept) {
                    this._addError(Localizer.Diagnostic.namedExceptAfterCatchAll(), typeExpr);
                }
            }

            const exceptSuite = this._parseSuite(this._isInFunction);
            const exceptNode = ExceptNode.create(exceptToken, exceptSuite);
            if (typeExpr) {
                exceptNode.typeExpression = typeExpr;
                exceptNode.typeExpression.parent = exceptNode;
            }

            if (symbolName) {
                exceptNode.name = NameNode.create(symbolName);
                exceptNode.name.parent = exceptNode;
            }

            tryNode.exceptClauses.push(exceptNode);
            exceptNode.parent = tryNode;
        }

        if (tryNode.exceptClauses.length > 0) {
            extendRange(tryNode, tryNode.exceptClauses[tryNode.exceptClauses.length - 1]);

            if (this._consumeTokenIfKeyword(KeywordType.Else)) {
                tryNode.elseSuite = this._parseSuite(this._isInFunction);
                tryNode.elseSuite.parent = tryNode;
                extendRange(tryNode, tryNode.elseSuite);
            }
        }

        if (this._consumeTokenIfKeyword(KeywordType.Finally)) {
            tryNode.finallySuite = this._parseSuite(this._isInFunction);
            tryNode.finallySuite.parent = tryNode;
            extendRange(tryNode, tryNode.finallySuite);
        }

        if (!tryNode.finallySuite && tryNode.exceptClauses.length === 0) {
            this._addError(Localizer.Diagnostic.tryWithoutExcept(), tryToken);
        }

        return tryNode;
    }

    // funcdef: 'def' NAME parameters ['->' test] ':' suite
    // parameters: '(' [typedargslist] ')'
    private _parseFunctionDef(asyncToken?: KeywordToken, decorators?: DecoratorNode[]): FunctionNode | ErrorNode {
        const defToken = this._getKeywordToken(KeywordType.Def);

        const nameToken = this._getTokenIfIdentifier();
        if (!nameToken) {
            this._addError(Localizer.Diagnostic.expectedFunctionName(), defToken);
            return ErrorNode.create(
                defToken,
                ErrorExpressionCategory.MissingFunctionParameterList,
                undefined,
                decorators
            );
        }

        if (!this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            this._addError(Localizer.Diagnostic.expectedOpenParen(), this._peekToken());
            return ErrorNode.create(
                nameToken,
                ErrorExpressionCategory.MissingFunctionParameterList,
                NameNode.create(nameToken),
                decorators
            );
        }

        const paramList = this._parseVarArgsList(TokenType.CloseParenthesis, /* allowAnnotations */ true);

        if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
            this._addError(Localizer.Diagnostic.expectedCloseParen(), this._peekToken());
            this._consumeTokensUntilType([TokenType.Colon]);
        }

        let returnType: ExpressionNode | undefined;
        if (this._consumeTokenIfType(TokenType.Arrow)) {
            returnType = this._parseTypeAnnotation();
        }

        let functionTypeAnnotationToken: StringToken | undefined;
        const suite = this._parseSuite(/* isFunction */ true, this._parseOptions.skipFunctionAndClassBody, () => {
            if (!functionTypeAnnotationToken) {
                functionTypeAnnotationToken = this._getTypeAnnotationCommentText();
            }
        });

        const functionNode = FunctionNode.create(defToken, NameNode.create(nameToken), suite);
        if (asyncToken) {
            functionNode.isAsync = true;
            extendRange(functionNode, asyncToken);
        }

        functionNode.parameters = paramList;
        paramList.forEach((param) => {
            param.parent = functionNode;
        });

        if (decorators) {
            functionNode.decorators = decorators;
            decorators.forEach((decorator) => {
                decorator.parent = functionNode;
            });

            if (decorators.length > 0) {
                extendRange(functionNode, decorators[0]);
            }
        }

        if (returnType) {
            functionNode.returnTypeAnnotation = returnType;
            functionNode.returnTypeAnnotation.parent = functionNode;
            extendRange(functionNode, returnType);
        }

        // If there was a type annotation comment for the function,
        // parse it now.
        if (functionTypeAnnotationToken) {
            this._parseFunctionTypeAnnotationComment(functionTypeAnnotationToken, functionNode);
        }

        return functionNode;
    }

    // typedargslist: (
    //   tfpdef ['=' test] (',' tfpdef ['=' test])*
    //      [ ','
    //          [
    //              '*' [tfpdef] (',' tfpdef ['=' test])* [',' ['**' tfpdef [',']]]
    //              | '**' tfpdef [',']
    //          ]
    //      ]
    //   | '*' [tfpdef] (',' tfpdef ['=' test])* [',' ['**' tfpdef [',']]]
    //   | '**' tfpdef [','])
    // tfpdef: NAME [':' test]
    // vfpdef: NAME;
    private _parseVarArgsList(terminator: TokenType, allowAnnotations: boolean): ParameterNode[] {
        const paramMap = new Map<string, string>();
        const paramList: ParameterNode[] = [];
        let sawDefaultParam = false;
        let reportedNonDefaultParamErr = false;
        let sawKeywordOnlySeparator = false;
        let sawPositionOnlySeparator = false;
        let sawArgs = false;
        let sawKwArgs = false;

        while (true) {
            if (this._peekTokenType() === terminator) {
                break;
            }

            const param = this._parseParameter(allowAnnotations);
            if (!param) {
                this._consumeTokensUntilType([terminator]);
                break;
            }

            if (param.name) {
                const name = param.name.value;
                if (paramMap.has(name)) {
                    this._addError(Localizer.Diagnostic.duplicateParam().format({ name }), param.name);
                } else {
                    paramMap.set(name, name);
                }
            } else if (param.category === ParameterCategory.Simple) {
                if (paramList.length === 0) {
                    this._addError(Localizer.Diagnostic.positionOnlyFirstParam(), param);
                }
            }

            if (param.category === ParameterCategory.Simple) {
                if (!param.name) {
                    if (sawPositionOnlySeparator) {
                        this._addError(Localizer.Diagnostic.duplicatePositionOnly(), param);
                    } else if (sawKeywordOnlySeparator) {
                        this._addError(Localizer.Diagnostic.positionOnlyAfterKeywordOnly(), param);
                    } else if (sawArgs) {
                        this._addError(Localizer.Diagnostic.positionOnlyAfterArgs(), param);
                    }
                    sawPositionOnlySeparator = true;
                } else {
                    if (param.defaultValue) {
                        sawDefaultParam = true;
                    } else if (sawDefaultParam && !sawKeywordOnlySeparator && !sawArgs) {
                        // Report this error only once.
                        if (!reportedNonDefaultParamErr) {
                            this._addError(Localizer.Diagnostic.nonDefaultAfterDefault(), param);
                            reportedNonDefaultParamErr = true;
                        }
                    }
                }
            }

            paramList.push(param);

            if (param.category === ParameterCategory.VarArgList) {
                if (!param.name) {
                    if (sawKeywordOnlySeparator) {
                        this._addError(Localizer.Diagnostic.duplicateKeywordOnly(), param);
                    } else if (sawArgs) {
                        this._addError(Localizer.Diagnostic.keywordOnlyAfterArgs(), param);
                    }
                    sawKeywordOnlySeparator = true;
                } else {
                    if (sawArgs) {
                        this._addError(Localizer.Diagnostic.duplicateArgsParam(), param);
                    }
                    sawArgs = true;
                }
            }

            if (param.category === ParameterCategory.VarArgDictionary) {
                if (sawKwArgs) {
                    this._addError(Localizer.Diagnostic.duplicateKwargsParam(), param);
                }
                sawKwArgs = true;
            } else if (sawKwArgs) {
                this._addError(Localizer.Diagnostic.paramAfterKwargsParam(), param);
            }

            const foundComma = this._consumeTokenIfType(TokenType.Comma);

            if (allowAnnotations && !param.typeAnnotation) {
                // Look for a type annotation comment at the end of the line.
                const typeAnnotationComment = this._parseVariableTypeAnnotationComment();
                if (typeAnnotationComment) {
                    param.typeAnnotationComment = typeAnnotationComment;
                    param.typeAnnotationComment.parent = param;
                    extendRange(param, param.typeAnnotationComment);
                }
            }

            if (!foundComma) {
                break;
            }
        }

        if (paramList.length > 0) {
            const lastParam = paramList[paramList.length - 1];
            if (lastParam.category === ParameterCategory.VarArgList && !lastParam.name) {
                this._addError(Localizer.Diagnostic.expectedNamedParameter(), lastParam);
            }
        }

        return paramList;
    }

    private _parseParameter(allowAnnotations: boolean): ParameterNode {
        let starCount = 0;
        let slashCount = 0;
        const firstToken = this._peekToken();

        if (this._consumeTokenIfOperator(OperatorType.Multiply)) {
            starCount = 1;
        } else if (this._consumeTokenIfOperator(OperatorType.Power)) {
            starCount = 2;
        } else if (this._consumeTokenIfOperator(OperatorType.Divide)) {
            if (this._getLanguageVersion() < PythonVersion.V3_8) {
                this._addError(Localizer.Diagnostic.positionOnlyIncompatible(), firstToken);
            }
            slashCount = 1;
        }

        const paramName = this._getTokenIfIdentifier();
        if (!paramName) {
            if (starCount === 1) {
                const paramNode = ParameterNode.create(firstToken, ParameterCategory.VarArgList);
                return paramNode;
            } else if (slashCount === 1) {
                const paramNode = ParameterNode.create(firstToken, ParameterCategory.Simple);
                return paramNode;
            }

            // Check for the Python 2.x parameter sublist syntax and handle it gracefully.
            if (this._peekTokenType() === TokenType.OpenParenthesis) {
                const sublistStart = this._getNextToken();
                if (this._consumeTokensUntilType([TokenType.CloseParenthesis])) {
                    this._getNextToken();
                }
                this._addError(Localizer.Diagnostic.sublistParamsIncompatible(), sublistStart);
            } else {
                this._addError(Localizer.Diagnostic.expectedParamName(), this._peekToken());
            }
        }

        let paramType = ParameterCategory.Simple;
        if (starCount === 1) {
            paramType = ParameterCategory.VarArgList;
        } else if (starCount === 2) {
            paramType = ParameterCategory.VarArgDictionary;
        }
        const paramNode = ParameterNode.create(firstToken, paramType);
        if (paramName) {
            paramNode.name = NameNode.create(paramName);
            paramNode.name.parent = paramNode;
            extendRange(paramNode, paramName);
        }

        if (allowAnnotations && this._consumeTokenIfType(TokenType.Colon)) {
            paramNode.typeAnnotation = this._parseTypeAnnotation();
            paramNode.typeAnnotation.parent = paramNode;
            extendRange(paramNode, paramNode.typeAnnotation);
        }

        if (this._consumeTokenIfOperator(OperatorType.Assign)) {
            paramNode.defaultValue = this._parseTestExpression(/* allowAssignmentExpression */ false);
            paramNode.defaultValue.parent = paramNode;
            extendRange(paramNode, paramNode.defaultValue);

            if (starCount > 0) {
                this._addError(Localizer.Diagnostic.defaultValueNotAllowed(), paramNode.defaultValue);
            }
        }

        return paramNode;
    }

    // with_stmt: 'with' with_item (',' with_item)*  ':' suite
    // Python 3.10 adds support for optional parentheses around
    // with_item list.
    private _parseWithStatement(asyncToken?: KeywordToken): WithNode {
        const withToken = this._getKeywordToken(KeywordType.With);
        let withItemList: WithItemNode[] = [];

        const possibleParen = this._peekToken();

        // If the expression starts with a paren, parse it as though the
        // paren is enclosing the list of "with items". This is done as a
        // "dry run" to determine whether the entire list of "with items"
        // is enclosed in parentheses.
        let isParenthesizedWithItemList = false;
        if (possibleParen.type === TokenType.OpenParenthesis) {
            const openParenTokenIndex = this._tokenIndex;

            this._suppressErrors(() => {
                this._getNextToken();
                while (true) {
                    withItemList.push(this._parseWithItem());
                    if (!this._consumeTokenIfType(TokenType.Comma)) {
                        break;
                    }

                    if (this._peekToken().type === TokenType.CloseParenthesis) {
                        break;
                    }
                }

                if (
                    this._peekToken().type === TokenType.CloseParenthesis &&
                    this._peekToken(1).type === TokenType.Colon
                ) {
                    isParenthesizedWithItemList = withItemList.length !== 1 || withItemList[0].target !== undefined;
                }

                this._tokenIndex = openParenTokenIndex;
                withItemList = [];
            });
        }

        if (isParenthesizedWithItemList) {
            this._consumeTokenIfType(TokenType.OpenParenthesis);
            if (this._getLanguageVersion() < PythonVersion.V3_9) {
                this._addError(Localizer.Diagnostic.parenthesizedContextManagerIllegal(), possibleParen);
            }
        }

        while (true) {
            withItemList.push(this._parseWithItem());

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }

            if (this._peekToken().type === TokenType.CloseParenthesis) {
                break;
            }
        }

        if (isParenthesizedWithItemList) {
            if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                this._addError(Localizer.Diagnostic.expectedCloseParen(), this._peekToken());
            }
        }

        const withSuite = this._parseSuite(this._isInFunction);
        const withNode = WithNode.create(withToken, withSuite);
        if (asyncToken) {
            withNode.isAsync = true;
            withNode.asyncToken = asyncToken;
            extendRange(withNode, asyncToken);
        }

        withNode.withItems = withItemList;
        withItemList.forEach((withItem) => {
            withItem.parent = withNode;
        });

        return withNode;
    }

    // with_item: test ['as' expr]
    private _parseWithItem(): WithItemNode {
        const expr = this._parseTestExpression(/* allowAssignmentExpression */ true);
        const itemNode = WithItemNode.create(expr);

        if (this._consumeTokenIfKeyword(KeywordType.As)) {
            itemNode.target = this._parseExpression(/* allowUnpack */ false);
            itemNode.target.parent = itemNode;
            extendRange(itemNode, itemNode.target);
        }

        return itemNode;
    }

    // decorators: decorator+
    // decorated: decorators (classdef | funcdef | async_funcdef)
    private _parseDecorated(): StatementNode | undefined {
        const decoratorList: DecoratorNode[] = [];

        while (true) {
            if (this._peekOperatorType() === OperatorType.MatrixMultiply) {
                decoratorList.push(this._parseDecorator());
            } else {
                break;
            }
        }

        const nextToken = this._peekToken() as KeywordToken;
        if (nextToken.type === TokenType.Keyword) {
            if (nextToken.keywordType === KeywordType.Async) {
                this._getNextToken();

                if (this._peekKeywordType() !== KeywordType.Def) {
                    this._addError(Localizer.Diagnostic.expectedFunctionAfterAsync(), this._peekToken());
                } else {
                    return this._parseFunctionDef(nextToken, decoratorList);
                }
            } else if (nextToken.keywordType === KeywordType.Def) {
                return this._parseFunctionDef(undefined, decoratorList);
            } else if (nextToken.keywordType === KeywordType.Class) {
                return this._parseClassDef(decoratorList);
            }
        }

        this._addError(Localizer.Diagnostic.expectedAfterDecorator(), this._peekToken());

        // Return a dummy class declaration so the completion provider has
        // some parse nodes to work with.
        return ClassNode.createDummyForDecorators(decoratorList);
    }

    // decorator: '@' dotted_name [ '(' [arglist] ')' ] NEWLINE
    private _parseDecorator(): DecoratorNode {
        const atOperator = this._getNextToken() as OperatorToken;
        assert(atOperator.operatorType === OperatorType.MatrixMultiply);

        const expression = this._parseTestExpression(/* allowAssignmentExpression */ true);

        // Versions of Python prior to 3.9 support a limited set of
        // expression forms.
        if (this._getLanguageVersion() < PythonVersion.V3_9) {
            let isSupportedExpressionForm = false;
            if (this._isNameOrMemberAccessExpression(expression)) {
                isSupportedExpressionForm = true;
            } else if (
                expression.nodeType === ParseNodeType.Call &&
                this._isNameOrMemberAccessExpression(expression.leftExpression)
            ) {
                isSupportedExpressionForm = true;
            }

            if (!isSupportedExpressionForm) {
                this._addError(Localizer.Diagnostic.expectedDecoratorExpr(), expression);
            }
        }

        const decoratorNode = DecoratorNode.create(atOperator, expression);

        if (!this._consumeTokenIfType(TokenType.NewLine)) {
            this._addError(Localizer.Diagnostic.expectedDecoratorNewline(), this._peekToken());
            this._consumeTokensUntilType([TokenType.NewLine]);
        }

        return decoratorNode;
    }

    private _isNameOrMemberAccessExpression(expression: ExpressionNode): boolean {
        if (expression.nodeType === ParseNodeType.Name) {
            return true;
        } else if (expression.nodeType === ParseNodeType.MemberAccess) {
            return this._isNameOrMemberAccessExpression(expression.leftExpression);
        }

        return false;
    }

    // classdef: 'class' NAME ['(' [arglist] ')'] suite
    private _parseClassDef(decorators?: DecoratorNode[]): ClassNode {
        const classToken = this._getKeywordToken(KeywordType.Class);

        let nameToken = this._getTokenIfIdentifier();
        if (!nameToken) {
            this._addError(Localizer.Diagnostic.expectedClassName(), this._peekToken());
            nameToken = IdentifierToken.create(0, 0, '', undefined);
        }

        let argList: ArgumentNode[] = [];
        if (this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            argList = this._parseArgList();

            if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                this._addError(Localizer.Diagnostic.expectedCloseParen(), this._peekToken());
            }
        }

        const suite = this._parseSuite(/* isFunction */ false, this._parseOptions.skipFunctionAndClassBody);

        const classNode = ClassNode.create(classToken, NameNode.create(nameToken), suite);
        classNode.arguments = argList;
        argList.forEach((arg) => {
            arg.parent = classNode;
        });

        if (decorators) {
            classNode.decorators = decorators;
            if (decorators.length > 0) {
                decorators.forEach((decorator) => {
                    decorator.parent = classNode;
                });
                extendRange(classNode, decorators[0]);
            }
        }

        return classNode;
    }

    private _parsePassStatement(): PassNode {
        return PassNode.create(this._getKeywordToken(KeywordType.Pass));
    }

    private _parseBreakStatement(): BreakNode {
        const breakToken = this._getKeywordToken(KeywordType.Break);

        if (!this._isInLoop) {
            this._addError(Localizer.Diagnostic.breakOutsideLoop(), breakToken);
        }

        return BreakNode.create(breakToken);
    }

    private _parseContinueStatement(): ContinueNode {
        const continueToken = this._getKeywordToken(KeywordType.Continue);

        if (!this._isInLoop) {
            this._addError(Localizer.Diagnostic.continueOutsideLoop(), continueToken);
        } else if (this._isInFinally) {
            this._addError(Localizer.Diagnostic.continueInFinally(), continueToken);
        }

        return ContinueNode.create(continueToken);
    }

    // return_stmt: 'return' [testlist]
    private _parseReturnStatement(): ReturnNode {
        const returnToken = this._getKeywordToken(KeywordType.Return);

        const returnNode = ReturnNode.create(returnToken);

        if (!this._isInFunction) {
            this._addError(Localizer.Diagnostic.returnOutsideFunction(), returnToken);
        }

        if (!this._isNextTokenNeverExpression()) {
            const returnExpr = this._parseTestOrStarListAsExpression(
                /* allowAssignmentExpression */ true,
                ErrorExpressionCategory.MissingExpression,
                Localizer.Diagnostic.expectedReturnExpr()
            );
            this._reportConditionalErrorForStarTupleElement(returnExpr);
            returnNode.returnExpression = returnExpr;
            returnNode.returnExpression.parent = returnNode;
            extendRange(returnNode, returnExpr);
        }

        return returnNode;
    }

    // import_from: ('from' (('.' | '...')* dotted_name | ('.' | '...')+)
    //             'import' ('*' | '(' import_as_names ')' | import_as_names))
    // import_as_names: import_as_name (',' import_as_name)* [',']
    // import_as_name: NAME ['as' NAME]
    private _parseFromStatement(): ImportFromNode {
        const fromToken = this._getKeywordToken(KeywordType.From);

        const modName = this._parseDottedModuleName(/* allowJustDots */ true);
        const importFromNode = ImportFromNode.create(fromToken, modName);

        // Handle imports from __future__ specially because they can
        // change the way we interpret the rest of the file.
        const isFutureImport =
            modName.leadingDots === 0 && modName.nameParts.length === 1 && modName.nameParts[0].value === '__future__';

        const possibleInputToken = this._peekToken();
        if (!this._consumeTokenIfKeyword(KeywordType.Import)) {
            this._addError(Localizer.Diagnostic.expectedImport(), this._peekToken());
            if (!modName.hasTrailingDot) {
                importFromNode.missingImportKeyword = true;
            }
        } else {
            extendRange(importFromNode, possibleInputToken);

            // Look for "*" token.
            const possibleStarToken = this._peekToken();
            if (this._consumeTokenIfOperator(OperatorType.Multiply)) {
                extendRange(importFromNode, possibleStarToken);
                importFromNode.isWildcardImport = true;
                importFromNode.wildcardToken = possibleStarToken;
                this._containsWildcardImport = true;
            } else {
                const inParen = this._consumeTokenIfType(TokenType.OpenParenthesis);
                let trailingCommaToken: Token | undefined;

                while (true) {
                    const importName = this._getTokenIfIdentifier();
                    if (!importName) {
                        break;
                    }

                    trailingCommaToken = undefined;

                    const importFromAsNode = ImportFromAsNode.create(NameNode.create(importName));

                    if (this._consumeTokenIfKeyword(KeywordType.As)) {
                        const aliasName = this._getTokenIfIdentifier();
                        if (!aliasName) {
                            this._addError(Localizer.Diagnostic.expectedImportAlias(), this._peekToken());
                        } else {
                            importFromAsNode.alias = NameNode.create(aliasName);
                            importFromAsNode.alias.parent = importFromAsNode;
                            extendRange(importFromAsNode, aliasName);
                        }
                    }

                    importFromNode.imports.push(importFromAsNode);
                    importFromAsNode.parent = importFromNode;
                    extendRange(importFromNode, importFromAsNode);

                    if (isFutureImport) {
                        // Add the future import to the map.
                        this._futureImportMap.set(importName.value, true);
                    }

                    const nextToken = this._peekToken();
                    if (!this._consumeTokenIfType(TokenType.Comma)) {
                        break;
                    }
                    trailingCommaToken = nextToken;
                }

                if (importFromNode.imports.length === 0) {
                    this._addError(Localizer.Diagnostic.expectedImportSymbols(), this._peekToken());
                }

                if (inParen) {
                    importFromNode.usesParens = true;

                    const nextToken = this._peekToken();
                    if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                        this._addError(Localizer.Diagnostic.expectedCloseParen(), this._peekToken());
                    } else {
                        extendRange(importFromNode, nextToken);
                    }
                } else if (trailingCommaToken) {
                    this._addError(Localizer.Diagnostic.trailingCommaInFromImport(), trailingCommaToken);
                }
            }
        }

        this._importedModules.push({
            nameNode: importFromNode.module,
            leadingDots: importFromNode.module.leadingDots,
            nameParts: importFromNode.module.nameParts.map((p) => p.value),
            importedSymbols: importFromNode.imports.map((imp) => imp.name.value),
        });

        let isTypingImport = false;
        if (importFromNode.module.nameParts.length === 1) {
            const firstNamePartValue = importFromNode.module.nameParts[0].value;
            if (firstNamePartValue === 'typing' || firstNamePartValue === 'typing_extensions') {
                isTypingImport = true;
            }
        }

        if (isTypingImport) {
            const typingSymbolsOfInterest = ['Literal', 'TypeAlias', 'Annotated'];

            if (importFromNode.isWildcardImport) {
                typingSymbolsOfInterest.forEach((s) => {
                    this._typingSymbolAliases.set(s, s);
                });
            } else {
                importFromNode.imports.forEach((imp) => {
                    if (typingSymbolsOfInterest.some((s) => s === imp.name.value)) {
                        this._typingSymbolAliases.set(imp.alias?.value || imp.name.value, imp.name.value);
                    }
                });
            }
        }

        return importFromNode;
    }

    // import_name: 'import' dotted_as_names
    // dotted_as_names: dotted_as_name (',' dotted_as_name)*
    // dotted_as_name: dotted_name ['as' NAME]
    private _parseImportStatement(): ImportNode {
        const importToken = this._getKeywordToken(KeywordType.Import);

        const importNode = ImportNode.create(importToken);

        while (true) {
            const modName = this._parseDottedModuleName();

            const importAsNode = ImportAsNode.create(modName);

            if (this._consumeTokenIfKeyword(KeywordType.As)) {
                const aliasToken = this._getTokenIfIdentifier();
                if (aliasToken) {
                    importAsNode.alias = NameNode.create(aliasToken);
                    importAsNode.alias.parent = importAsNode;
                    extendRange(importAsNode, importAsNode.alias);
                } else {
                    this._addError(Localizer.Diagnostic.expectedImportAlias(), this._peekToken());
                }
            }

            if (importAsNode.module.leadingDots > 0) {
                this._addError(Localizer.Diagnostic.relativeImportNotAllowed(), importAsNode.module);
            }

            importNode.list.push(importAsNode);
            importAsNode.parent = importNode;

            this._importedModules.push({
                nameNode: importAsNode.module,
                leadingDots: importAsNode.module.leadingDots,
                nameParts: importAsNode.module.nameParts.map((p) => p.value),
                importedSymbols: undefined,
            });

            if (modName.nameParts.length === 1) {
                const firstNamePartValue = modName.nameParts[0].value;
                if (firstNamePartValue === 'typing' || firstNamePartValue === 'typing_extensions') {
                    this._typingImportAliases.push(importAsNode.alias?.value || firstNamePartValue);
                }
            }

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        if (importNode.list.length > 0) {
            extendRange(importNode, importNode.list[importNode.list.length - 1]);
        }

        return importNode;
    }

    // ('.' | '...')* dotted_name | ('.' | '...')+
    // dotted_name: NAME ('.' NAME)*
    private _parseDottedModuleName(allowJustDots = false): ModuleNameNode {
        const moduleNameNode = ModuleNameNode.create(this._peekToken());

        while (true) {
            if (this._consumeTokenIfType(TokenType.Ellipsis)) {
                moduleNameNode.leadingDots += 3;
            } else if (this._consumeTokenIfType(TokenType.Dot)) {
                moduleNameNode.leadingDots++;
            } else {
                break;
            }
        }

        while (true) {
            const identifier = this._getTokenIfIdentifier();
            if (!identifier) {
                if (!allowJustDots || moduleNameNode.leadingDots === 0 || moduleNameNode.nameParts.length > 0) {
                    this._addError(Localizer.Diagnostic.expectedModuleName(), this._peekToken());
                    moduleNameNode.hasTrailingDot = true;
                }
                break;
            }

            const namePart = NameNode.create(identifier);
            moduleNameNode.nameParts.push(namePart);
            namePart.parent = moduleNameNode;
            extendRange(moduleNameNode, namePart);

            const nextToken = this._peekToken();
            if (!this._consumeTokenIfType(TokenType.Dot)) {
                break;
            }

            // Extend the module name to include the dot.
            extendRange(moduleNameNode, nextToken);
        }

        return moduleNameNode;
    }

    private _parseGlobalStatement(): GlobalNode {
        const globalToken = this._getKeywordToken(KeywordType.Global);

        const globalNode = GlobalNode.create(globalToken);
        globalNode.nameList = this._parseNameList();
        if (globalNode.nameList.length > 0) {
            globalNode.nameList.forEach((name) => {
                name.parent = globalNode;
            });
            extendRange(globalNode, globalNode.nameList[globalNode.nameList.length - 1]);
        }
        return globalNode;
    }

    private _parseNonlocalStatement(): NonlocalNode {
        const nonlocalToken = this._getKeywordToken(KeywordType.Nonlocal);

        const nonlocalNode = NonlocalNode.create(nonlocalToken);
        nonlocalNode.nameList = this._parseNameList();
        if (nonlocalNode.nameList.length > 0) {
            nonlocalNode.nameList.forEach((name) => {
                name.parent = nonlocalNode;
            });
            extendRange(nonlocalNode, nonlocalNode.nameList[nonlocalNode.nameList.length - 1]);
        }
        return nonlocalNode;
    }

    private _parseNameList(): NameNode[] {
        const nameList: NameNode[] = [];

        while (true) {
            const name = this._getTokenIfIdentifier();
            if (!name) {
                this._addError(Localizer.Diagnostic.expectedIdentifier(), this._peekToken());
                break;
            }

            nameList.push(NameNode.create(name));

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        return nameList;
    }

    // raise_stmt: 'raise' [test ['from' test]]
    // (old) raise_stmt: 'raise' [test [',' test [',' test]]]
    private _parseRaiseStatement(): RaiseNode {
        const raiseToken = this._getKeywordToken(KeywordType.Raise);

        const raiseNode = RaiseNode.create(raiseToken);
        if (!this._isNextTokenNeverExpression()) {
            raiseNode.typeExpression = this._parseTestExpression(/* allowAssignmentExpression */ true);
            raiseNode.typeExpression.parent = raiseNode;
            extendRange(raiseNode, raiseNode.typeExpression);

            if (this._consumeTokenIfKeyword(KeywordType.From)) {
                raiseNode.valueExpression = this._parseTestExpression(/* allowAssignmentExpression */ true);
                raiseNode.valueExpression.parent = raiseNode;
                extendRange(raiseNode, raiseNode.valueExpression);
            } else {
                if (this._consumeTokenIfType(TokenType.Comma)) {
                    // Handle the Python 2.x variant
                    raiseNode.valueExpression = this._parseTestExpression(/* allowAssignmentExpression */ true);
                    raiseNode.valueExpression.parent = raiseNode;
                    extendRange(raiseNode, raiseNode.valueExpression);

                    if (this._consumeTokenIfType(TokenType.Comma)) {
                        raiseNode.tracebackExpression = this._parseTestExpression(/* allowAssignmentExpression */ true);
                        raiseNode.tracebackExpression.parent = raiseNode;
                        extendRange(raiseNode, raiseNode.tracebackExpression);
                    }
                }
            }
        }

        return raiseNode;
    }

    // assert_stmt: 'assert' test [',' test]
    private _parseAssertStatement(): AssertNode {
        const assertToken = this._getKeywordToken(KeywordType.Assert);

        const expr = this._parseTestExpression(/* allowAssignmentExpression */ true);
        const assertNode = AssertNode.create(assertToken, expr);

        if (this._consumeTokenIfType(TokenType.Comma)) {
            const exceptionExpr = this._parseTestExpression(/* allowAssignmentExpression */ true);
            assertNode.exceptionExpression = exceptionExpr;
            assertNode.exceptionExpression.parent = assertNode;
            extendRange(assertNode, exceptionExpr);
        }

        return assertNode;
    }

    // del_stmt: 'del' exprlist
    private _parseDelStatement(): DelNode {
        const delToken = this._getKeywordToken(KeywordType.Del);

        const exprListResult = this._parseExpressionList(/* allowStar */ true);
        if (!exprListResult.parseError && exprListResult.list.length === 0) {
            this._addError(Localizer.Diagnostic.expectedDelExpr(), this._peekToken());
        }
        const delNode = DelNode.create(delToken);
        delNode.expressions = exprListResult.list;
        if (delNode.expressions.length > 0) {
            delNode.expressions.forEach((expr) => {
                expr.parent = delNode;
            });
            extendRange(delNode, delNode.expressions[delNode.expressions.length - 1]);
        }
        return delNode;
    }

    // yield_expr: 'yield' [yield_arg]
    // yield_arg: 'from' test | testlist
    private _parseYieldExpression(): YieldNode | YieldFromNode {
        const yieldToken = this._getKeywordToken(KeywordType.Yield);

        const nextToken = this._peekToken();
        if (this._consumeTokenIfKeyword(KeywordType.From)) {
            if (this._getLanguageVersion() < PythonVersion.V3_3) {
                this._addError(Localizer.Diagnostic.yieldFromIllegal(), nextToken);
            }
            return YieldFromNode.create(yieldToken, this._parseTestExpression(/* allowAssignmentExpression */ true));
        }

        let exprList: ExpressionNode | undefined;
        if (!this._isNextTokenNeverExpression()) {
            exprList = this._parseTestOrStarListAsExpression(
                /* allowAssignmentExpression */ true,
                ErrorExpressionCategory.MissingExpression,
                Localizer.Diagnostic.expectedYieldExpr()
            );
            this._reportConditionalErrorForStarTupleElement(exprList);
        }

        return YieldNode.create(yieldToken, exprList);
    }

    private _tryParseYieldExpression(): YieldNode | YieldFromNode | undefined {
        if (this._peekKeywordType() !== KeywordType.Yield) {
            return undefined;
        }

        return this._parseYieldExpression();
    }

    // simple_stmt: small_stmt (';' small_stmt)* [';'] NEWLINE
    private _parseSimpleStatement(): StatementListNode {
        const statement = StatementListNode.create(this._peekToken());

        while (true) {
            // Swallow invalid tokens to make sure we make forward progress.
            if (this._peekTokenType() === TokenType.Invalid) {
                const invalidToken = this._getNextToken();
                const text = this._fileContents!.substr(invalidToken.start, invalidToken.length);

                const firstCharCode = text.charCodeAt(0);

                // Remove any non-printable characters.
                this._addError(
                    Localizer.Diagnostic.invalidTokenChars().format({ text: `\\u${firstCharCode.toString(16)}` }),
                    invalidToken
                );
                this._consumeTokensUntilType([TokenType.NewLine]);
                break;
            }

            const smallStatement = this._parseSmallStatement();
            statement.statements.push(smallStatement);
            smallStatement.parent = statement;
            extendRange(statement, smallStatement);

            if (smallStatement.nodeType === ParseNodeType.Error) {
                // No need to log an error here. We assume that
                // it was already logged by _parseSmallStatement.
                break;
            }

            // Consume the semicolon if present.
            if (!this._consumeTokenIfType(TokenType.Semicolon)) {
                break;
            }

            const nextTokenType = this._peekTokenType();
            if (nextTokenType === TokenType.NewLine || nextTokenType === TokenType.EndOfStream) {
                break;
            }
        }

        if (!this._consumeTokenIfType(TokenType.NewLine)) {
            this._addError(Localizer.Diagnostic.expectedNewlineOrSemicolon(), this._peekToken());
        }

        return statement;
    }

    // small_stmt: (expr_stmt | del_stmt | pass_stmt | flow_stmt |
    //             import_stmt | global_stmt | nonlocal_stmt | assert_stmt)
    // flow_stmt: break_stmt | continue_stmt | return_stmt | raise_stmt | yield_stmt
    // import_stmt: import_name | import_from
    private _parseSmallStatement(): ParseNode {
        switch (this._peekKeywordType()) {
            case KeywordType.Pass:
                return this._parsePassStatement();

            case KeywordType.Break:
                return this._parseBreakStatement();

            case KeywordType.Continue:
                return this._parseContinueStatement();

            case KeywordType.Return:
                return this._parseReturnStatement();

            case KeywordType.From:
                return this._parseFromStatement();

            case KeywordType.Import:
                return this._parseImportStatement();

            case KeywordType.Global:
                return this._parseGlobalStatement();

            case KeywordType.Nonlocal:
                return this._parseNonlocalStatement();

            case KeywordType.Raise:
                return this._parseRaiseStatement();

            case KeywordType.Assert:
                return this._parseAssertStatement();

            case KeywordType.Del:
                return this._parseDelStatement();

            case KeywordType.Yield:
                return this._parseYieldExpression();
        }

        return this._parseExpressionStatement();
    }

    private _makeExpressionOrTuple(
        exprListResult: ListResult<ExpressionNode>,
        enclosedInParens: boolean
    ): ExpressionNode {
        // A single-element tuple with no trailing comma is simply an expression
        // that's surrounded by parens.
        if (exprListResult.list.length === 1 && !exprListResult.trailingComma) {
            if (exprListResult.list[0].nodeType === ParseNodeType.Unpack) {
                this._addError(Localizer.Diagnostic.unpackNotAllowed(), exprListResult.list[0]);
            }
            return exprListResult.list[0];
        }

        // To accommodate empty tuples ("()"), we will reach back to get
        // the opening parenthesis as the opening token.

        const tupleStartRange: TextRange =
            exprListResult.list.length > 0 ? exprListResult.list[0] : this._peekToken(-1);

        const tupleNode = TupleNode.create(tupleStartRange, enclosedInParens);
        tupleNode.expressions = exprListResult.list;
        if (exprListResult.list.length > 0) {
            exprListResult.list.forEach((expr) => {
                expr.parent = tupleNode;
            });
            extendRange(tupleNode, exprListResult.list[exprListResult.list.length - 1]);
        }

        return tupleNode;
    }

    private _parseExpressionListAsPossibleTuple(
        errorCategory: ErrorExpressionCategory,
        errorString: string,
        errorToken: Token
    ): ExpressionNode {
        if (this._isNextTokenNeverExpression()) {
            this._addError(errorString, errorToken);
            return ErrorNode.create(errorToken, errorCategory);
        }

        const exprListResult = this._parseExpressionList(/* allowStar */ true);
        if (exprListResult.parseError) {
            return exprListResult.parseError;
        }
        return this._makeExpressionOrTuple(exprListResult, /* enclosedInParens */ false);
    }

    private _parseTestListAsExpression(errorCategory: ErrorExpressionCategory, errorString: string): ExpressionNode {
        if (this._isNextTokenNeverExpression()) {
            return this._handleExpressionParseError(errorCategory, errorString);
        }

        const exprListResult = this._parseTestExpressionList();
        if (exprListResult.parseError) {
            return exprListResult.parseError;
        }
        return this._makeExpressionOrTuple(exprListResult, /* enclosedInParens */ false);
    }

    private _parseTestOrStarListAsExpression(
        allowAssignmentExpression: boolean,
        errorCategory: ErrorExpressionCategory,
        errorString: string
    ): ExpressionNode {
        if (this._isNextTokenNeverExpression()) {
            return this._handleExpressionParseError(errorCategory, errorString);
        }

        const exprListResult = this._parseTestOrStarExpressionList(allowAssignmentExpression);
        if (exprListResult.parseError) {
            return exprListResult.parseError;
        }
        return this._makeExpressionOrTuple(exprListResult, /* enclosedInParens */ false);
    }

    private _parseExpressionList(allowStar: boolean): ListResult<ExpressionNode> {
        return this._parseExpressionListGeneric(() => this._parseExpression(allowStar));
    }

    // testlist: test (',' test)* [',']
    private _parseTestExpressionList(): ListResult<ExpressionNode> {
        return this._parseExpressionListGeneric(() => this._parseTestExpression(/* allowAssignmentExpression */ false));
    }

    private _parseTestOrStarExpressionList(allowAssignmentExpression: boolean): ListResult<ExpressionNode> {
        const exprListResult = this._parseExpressionListGeneric(() =>
            this._parseTestOrStarExpression(allowAssignmentExpression)
        );

        if (!exprListResult.parseError) {
            // Make sure that we don't have more than one star expression in the list.
            let sawStar = false;
            for (const expr of exprListResult.list) {
                if (expr.nodeType === ParseNodeType.Unpack) {
                    if (sawStar) {
                        this._addError(Localizer.Diagnostic.duplicateUnpack(), expr);
                        break;
                    }
                    sawStar = true;
                }
            }
        }

        return exprListResult;
    }

    // exp_or_star: expr | star_expr
    // expr: xor_expr ('|' xor_expr)*
    // star_expr: '*' expr
    private _parseExpression(allowUnpack: boolean): ExpressionNode {
        const startToken = this._peekToken();

        if (allowUnpack && this._consumeTokenIfOperator(OperatorType.Multiply)) {
            return UnpackNode.create(startToken, this._parseExpression(/* allowUnpack */ false));
        }

        return this._parseBitwiseOrExpression();
    }

    // test_or_star: test | star_expr
    private _parseTestOrStarExpression(allowAssignmentExpression: boolean): ExpressionNode {
        if (this._peekOperatorType() === OperatorType.Multiply) {
            return this._parseExpression(/* allowUnpack */ true);
        }

        return this._parseTestExpression(allowAssignmentExpression);
    }

    // test: or_test ['if' or_test 'else' test] | lambdef
    private _parseTestExpression(allowAssignmentExpression: boolean): ExpressionNode {
        if (this._peekKeywordType() === KeywordType.Lambda) {
            return this._parseLambdaExpression();
        }

        const ifExpr = allowAssignmentExpression ? this._parseAssignmentExpression() : this._parseOrTest();
        if (ifExpr.nodeType === ParseNodeType.Error) {
            return ifExpr;
        }

        if (!this._consumeTokenIfKeyword(KeywordType.If)) {
            return ifExpr;
        }

        const testExpr = this._parseAssignmentExpression();
        if (testExpr.nodeType === ParseNodeType.Error) {
            return testExpr;
        }

        if (!this._consumeTokenIfKeyword(KeywordType.Else)) {
            return this._handleExpressionParseError(
                ErrorExpressionCategory.MissingElse,
                Localizer.Diagnostic.expectedElse()
            );
        }

        const elseExpr = this._parseTestExpression(/* allowAssignmentExpression */ true);
        if (elseExpr.nodeType === ParseNodeType.Error) {
            return elseExpr;
        }

        return TernaryNode.create(ifExpr, testExpr, elseExpr);
    }

    // assign_expr: NAME := test
    private _parseAssignmentExpression() {
        const leftExpr = this._parseOrTest();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        if (leftExpr.nodeType !== ParseNodeType.Name) {
            return leftExpr;
        }

        const walrusToken = this._peekToken();
        if (!this._consumeTokenIfOperator(OperatorType.Walrus)) {
            return leftExpr;
        }

        if (!this._assignmentExpressionsAllowed) {
            this._addError(Localizer.Diagnostic.walrusNotAllowed(), walrusToken);
        }

        if (this._getLanguageVersion() < PythonVersion.V3_8) {
            this._addError(Localizer.Diagnostic.walrusIllegal(), walrusToken);
        }

        const rightExpr = this._parseTestExpression(/* allowAssignmentExpression */ false);

        return AssignmentExpressionNode.create(leftExpr, rightExpr);
    }

    // or_test: and_test ('or' and_test)*
    private _parseOrTest(): ExpressionNode {
        let leftExpr = this._parseAndTest();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        while (true) {
            const peekToken = this._peekToken();
            if (!this._consumeTokenIfKeyword(KeywordType.Or)) {
                break;
            }
            const rightExpr = this._parseAndTest();
            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, OperatorType.Or);
        }

        return leftExpr;
    }

    // and_test: not_test ('and' not_test)*
    private _parseAndTest(): ExpressionNode {
        let leftExpr = this._parseNotTest();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        while (true) {
            const peekToken = this._peekToken();
            if (!this._consumeTokenIfKeyword(KeywordType.And)) {
                break;
            }
            const rightExpr = this._parseNotTest();
            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, OperatorType.And);
        }

        return leftExpr;
    }

    // not_test: 'not' not_test | comparison
    private _parseNotTest(): ExpressionNode {
        const notToken = this._peekToken();
        if (this._consumeTokenIfKeyword(KeywordType.Not)) {
            const notExpr = this._parseNotTest();
            return UnaryOperationNode.create(notToken, notExpr, OperatorType.Not);
        }

        return this._parseComparison();
    }

    // comparison: expr (comp_op expr)*
    // comp_op: '<'|'>'|'=='|'>='|'<='|'<>'|'!='|'in'|'not' 'in'|'is'|'is' 'not'
    private _parseComparison(): ExpressionNode {
        let leftExpr = this._parseBitwiseOrExpression();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        while (true) {
            let comparisonOperator: OperatorType | undefined;
            const peekToken = this._peekToken();

            if (Tokenizer.isOperatorComparison(this._peekOperatorType())) {
                comparisonOperator = this._peekOperatorType();
                if (comparisonOperator === OperatorType.LessOrGreaterThan) {
                    this._addError(Localizer.Diagnostic.operatorLessOrGreaterDeprecated(), peekToken);
                    comparisonOperator = OperatorType.NotEquals;
                }
                this._getNextToken();
            } else if (this._consumeTokenIfKeyword(KeywordType.In)) {
                comparisonOperator = OperatorType.In;
            } else if (this._consumeTokenIfKeyword(KeywordType.Is)) {
                if (this._consumeTokenIfKeyword(KeywordType.Not)) {
                    comparisonOperator = OperatorType.IsNot;
                } else {
                    comparisonOperator = OperatorType.Is;
                }
            } else if (this._peekKeywordType() === KeywordType.Not) {
                const tokenAfterNot = this._peekToken(1);
                if (
                    tokenAfterNot.type === TokenType.Keyword &&
                    (tokenAfterNot as KeywordToken).keywordType === KeywordType.In
                ) {
                    this._getNextToken();
                    this._getNextToken();
                    comparisonOperator = OperatorType.NotIn;
                }
            }

            if (comparisonOperator === undefined) {
                break;
            }

            const rightExpr = this._parseComparison();
            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, comparisonOperator);
        }

        return leftExpr;
    }

    // expr: xor_expr ('|' xor_expr)*
    private _parseBitwiseOrExpression(): ExpressionNode {
        let leftExpr = this._parseBitwiseXorExpression();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        while (true) {
            const peekToken = this._peekToken();
            if (!this._consumeTokenIfOperator(OperatorType.BitwiseOr)) {
                break;
            }
            const rightExpr = this._parseBitwiseXorExpression();
            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, OperatorType.BitwiseOr);
        }

        return leftExpr;
    }

    // xor_expr: and_expr ('^' and_expr)*
    private _parseBitwiseXorExpression(): ExpressionNode {
        let leftExpr = this._parseBitwiseAndExpression();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        while (true) {
            const peekToken = this._peekToken();
            if (!this._consumeTokenIfOperator(OperatorType.BitwiseXor)) {
                break;
            }
            const rightExpr = this._parseBitwiseAndExpression();
            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, OperatorType.BitwiseXor);
        }

        return leftExpr;
    }

    // and_expr: shift_expr ('&' shift_expr)*
    private _parseBitwiseAndExpression(): ExpressionNode {
        let leftExpr = this._parseShiftExpression();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        while (true) {
            const peekToken = this._peekToken();
            if (!this._consumeTokenIfOperator(OperatorType.BitwiseAnd)) {
                break;
            }
            const rightExpr = this._parseShiftExpression();
            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, OperatorType.BitwiseAnd);
        }

        return leftExpr;
    }

    // shift_expr: arith_expr (('<<'|'>>') arith_expr)*
    private _parseShiftExpression(): ExpressionNode {
        let leftExpr = this._parseArithmeticExpression();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        let peekToken = this._peekToken();
        let nextOperator = this._peekOperatorType();
        while (nextOperator === OperatorType.LeftShift || nextOperator === OperatorType.RightShift) {
            this._getNextToken();
            const rightExpr = this._parseArithmeticExpression();
            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, nextOperator);
            peekToken = this._peekToken();
            nextOperator = this._peekOperatorType();
        }

        return leftExpr;
    }

    // arith_expr: term (('+'|'-') term)*
    private _parseArithmeticExpression(): ExpressionNode {
        let leftExpr = this._parseArithmeticTerm();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        let peekToken = this._peekToken();
        let nextOperator = this._peekOperatorType();
        while (nextOperator === OperatorType.Add || nextOperator === OperatorType.Subtract) {
            this._getNextToken();
            const rightExpr = this._parseArithmeticTerm();
            if (rightExpr.nodeType === ParseNodeType.Error) {
                return rightExpr;
            }

            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, nextOperator);
            peekToken = this._peekToken();
            nextOperator = this._peekOperatorType();
        }

        return leftExpr;
    }

    // term: factor (('*'|'@'|'/'|'%'|'//') factor)*
    private _parseArithmeticTerm(): ExpressionNode {
        let leftExpr = this._parseArithmeticFactor();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        let peekToken = this._peekToken();
        let nextOperator = this._peekOperatorType();
        while (
            nextOperator === OperatorType.Multiply ||
            nextOperator === OperatorType.MatrixMultiply ||
            nextOperator === OperatorType.Divide ||
            nextOperator === OperatorType.Mod ||
            nextOperator === OperatorType.FloorDivide
        ) {
            this._getNextToken();
            const rightExpr = this._parseArithmeticFactor();
            leftExpr = BinaryOperationNode.create(leftExpr, rightExpr, peekToken, nextOperator);
            peekToken = this._peekToken();
            nextOperator = this._peekOperatorType();
        }

        return leftExpr;
    }

    // factor: ('+'|'-'|'~') factor | power
    // power: atom_expr ['**' factor]
    private _parseArithmeticFactor(): ExpressionNode {
        const nextToken = this._peekToken();
        const nextOperator = this._peekOperatorType();
        if (
            nextOperator === OperatorType.Add ||
            nextOperator === OperatorType.Subtract ||
            nextOperator === OperatorType.BitwiseInvert
        ) {
            this._getNextToken();
            const expression = this._parseArithmeticFactor();
            return UnaryOperationNode.create(nextToken, expression, nextOperator);
        }

        const leftExpr = this._parseAtomExpression();
        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        const peekToken = this._peekToken();
        if (this._consumeTokenIfOperator(OperatorType.Power)) {
            const rightExpr = this._parseArithmeticFactor();
            return BinaryOperationNode.create(leftExpr, rightExpr, peekToken, OperatorType.Power);
        }

        return leftExpr;
    }

    // Determines whether the expression refers to a type exported by the typing
    // or typing_extensions modules. We can directly evaluate the types at binding
    // time. We assume here that the code isn't making use of some custom type alias
    // to refer to the typing types.
    private _isTypingAnnotation(typeAnnotation: ExpressionNode, name: string): boolean {
        if (typeAnnotation.nodeType === ParseNodeType.Name) {
            const alias = this._typingSymbolAliases.get(typeAnnotation.value);
            if (alias === name) {
                return true;
            }
        } else if (typeAnnotation.nodeType === ParseNodeType.MemberAccess) {
            if (
                typeAnnotation.leftExpression.nodeType === ParseNodeType.Name &&
                typeAnnotation.memberName.value === name
            ) {
                const baseName = typeAnnotation.leftExpression.value;
                return this._typingImportAliases.some((alias) => alias === baseName);
            }
        }

        return false;
    }

    // atom_expr: ['await'] atom trailer*
    // trailer: '(' [arglist] ')' | '[' subscriptlist ']' | '.' NAME
    private _parseAtomExpression(): ExpressionNode {
        let awaitToken: KeywordToken | undefined;
        if (this._peekKeywordType() === KeywordType.Await && !this._isParsingTypeAnnotation) {
            awaitToken = this._getKeywordToken(KeywordType.Await);
            if (this._getLanguageVersion() < PythonVersion.V3_5) {
                this._addError(Localizer.Diagnostic.awaitIllegal(), awaitToken);
            }
        }

        let atomExpression = this._parseAtom();
        if (atomExpression.nodeType === ParseNodeType.Error) {
            return atomExpression;
        }

        // Consume trailers.
        while (true) {
            // Is it a function call?
            if (this._consumeTokenIfType(TokenType.OpenParenthesis)) {
                // Generally, function calls are not allowed within type annotations,
                // but they are permitted in "Annotated" annotations.
                const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
                this._isParsingTypeAnnotation = false;

                const argList = this._parseArgList();
                const callNode = CallNode.create(atomExpression);
                callNode.arguments = argList;
                if (argList.length > 0) {
                    argList.forEach((arg) => {
                        arg.parent = callNode;
                    });
                    extendRange(callNode, argList[argList.length - 1]);
                }

                const nextToken = this._peekToken();
                let isArgListTerminated = false;
                if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                    this._addError(Localizer.Diagnostic.expectedCloseParen(), this._peekToken());

                    // Consume the remainder of tokens on the line for error
                    // recovery.
                    this._consumeTokensUntilType([TokenType.NewLine]);

                    // Extend the node's range to include the rest of the line.
                    // This helps the signatureHelpProvider.
                    extendRange(callNode, this._peekToken());
                } else {
                    extendRange(callNode, nextToken);
                    isArgListTerminated = true;
                }

                this._isParsingTypeAnnotation = wasParsingTypeAnnotation;

                if (this._isParsingTypeAnnotation) {
                    const diag = new DiagnosticAddendum();
                    if (atomExpression.nodeType === ParseNodeType.Name && atomExpression.value === 'type') {
                        diag.addMessage(Localizer.DiagnosticAddendum.useTypeInstead());
                        this._addError(Localizer.Diagnostic.typeCallNotAllowed() + diag.getString(), callNode);
                    }
                }

                atomExpression = callNode;

                // If the argument list wasn't terminated, break out of the loop
                if (!isArgListTerminated) {
                    break;
                }
            } else if (this._consumeTokenIfType(TokenType.OpenBracket)) {
                // Is it an index operator?

                // This is an unfortunate hack that's necessary to accommodate 'Literal'
                // and 'Annotated' type annotations properly. We need to suspend treating
                // strings as type annotations within a Literal or Annotated subscript.
                const wasParsingIndexTrailer = this._isParsingIndexTrailer;
                const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;

                if (
                    this._isTypingAnnotation(atomExpression, 'Literal') ||
                    this._isTypingAnnotation(atomExpression, 'Annotated')
                ) {
                    this._isParsingTypeAnnotation = false;
                }

                this._isParsingIndexTrailer = true;
                const subscriptList = this._parseSubscriptList();
                this._isParsingTypeAnnotation = wasParsingTypeAnnotation;
                this._isParsingIndexTrailer = wasParsingIndexTrailer;

                const closingToken = this._peekToken();

                const indexNode = IndexNode.create(
                    atomExpression,
                    subscriptList.list,
                    subscriptList.trailingComma,
                    closingToken
                );
                extendRange(indexNode, indexNode);

                if (!this._consumeTokenIfType(TokenType.CloseBracket)) {
                    // Handle the error case, but don't use the error node in this
                    // case because it creates problems for the completion provider.
                    this._handleExpressionParseError(
                        ErrorExpressionCategory.MissingIndexCloseBracket,
                        Localizer.Diagnostic.expectedCloseBracket(),
                        indexNode
                    );
                }

                atomExpression = indexNode;
            } else if (this._consumeTokenIfType(TokenType.Dot)) {
                // Is it a member access?
                const memberName = this._getTokenIfIdentifier();
                if (!memberName) {
                    return this._handleExpressionParseError(
                        ErrorExpressionCategory.MissingMemberAccessName,
                        Localizer.Diagnostic.expectedMemberName(),
                        atomExpression
                    );
                }
                atomExpression = MemberAccessNode.create(atomExpression, NameNode.create(memberName));
            } else {
                break;
            }
        }

        if (awaitToken) {
            return AwaitNode.create(awaitToken, atomExpression);
        }

        return atomExpression;
    }

    // subscriptlist: subscript (',' subscript)* [',']
    private _parseSubscriptList(): SubscriptListResult {
        const argList: ArgumentNode[] = [];
        let sawKeywordArg = false;
        let trailingComma = false;

        while (true) {
            const firstToken = this._peekToken();

            if (firstToken.type !== TokenType.Colon && this._isNextTokenNeverExpression()) {
                break;
            }

            let argType = ArgumentCategory.Simple;
            if (this._consumeTokenIfOperator(OperatorType.Multiply)) {
                argType = ArgumentCategory.UnpackedList;
            } else if (this._consumeTokenIfOperator(OperatorType.Power)) {
                argType = ArgumentCategory.UnpackedDictionary;
            }

            let valueExpr = this._parsePossibleSlice();
            let nameIdentifier: IdentifierToken | undefined;

            // Is this a keyword argument?
            if (argType === ArgumentCategory.Simple) {
                if (this._consumeTokenIfOperator(OperatorType.Assign)) {
                    const nameExpr = valueExpr;
                    valueExpr = this._parsePossibleSlice();

                    if (nameExpr.nodeType === ParseNodeType.Name) {
                        nameIdentifier = nameExpr.token;
                    } else {
                        this._addError(Localizer.Diagnostic.expectedParamName(), nameExpr);
                    }
                }
            }

            const argNode = ArgumentNode.create(firstToken, valueExpr, argType);
            if (nameIdentifier) {
                argNode.name = NameNode.create(nameIdentifier);
                argNode.name.parent = argNode;
            }

            if (argNode.name) {
                sawKeywordArg = true;
            } else if (sawKeywordArg && argNode.argumentCategory === ArgumentCategory.Simple) {
                this._addError(Localizer.Diagnostic.positionArgAfterNamedArg(), argNode);
            }
            argList.push(argNode);

            if (supportPEP637) {
                if (!this._parseOptions.isStubFile && this._getLanguageVersion() < PythonVersion.V3_10) {
                    if (argNode.name) {
                        this._addError(Localizer.Diagnostic.keywordSubscriptIllegal(), argNode.name);
                    }
                    if (argType !== ArgumentCategory.Simple) {
                        this._addError(Localizer.Diagnostic.unpackedSubscriptIllegal(), argNode);
                    }
                }
            } else {
                if (argNode.name) {
                    this._addError(Localizer.Diagnostic.keywordSubscriptIllegal(), argNode.name);
                }
                if (argType !== ArgumentCategory.Simple) {
                    this._addError(Localizer.Diagnostic.unpackedSubscriptIllegal(), argNode);
                }
            }

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                trailingComma = false;
                break;
            }

            trailingComma = true;
        }

        // An empty subscript list is illegal.
        if (argList.length === 0) {
            const errorNode = this._handleExpressionParseError(
                ErrorExpressionCategory.MissingIndexOrSlice,
                Localizer.Diagnostic.expectedSliceIndex(),
                /* childNode */ undefined,
                [TokenType.CloseBracket]
            );
            argList.push(ArgumentNode.create(this._peekToken(), errorNode, ArgumentCategory.Simple));
        }

        return {
            list: argList,
            trailingComma,
        };
    }

    // subscript: test | [test] ':' [test] [sliceop]
    // sliceop: ':' [test]
    private _parsePossibleSlice(): ExpressionNode {
        const firstToken = this._peekToken();
        const sliceExpressions: (ExpressionNode | undefined)[] = [undefined, undefined, undefined];
        let sliceIndex = 0;
        let sawColon = false;

        while (true) {
            const nextTokenType = this._peekTokenType();
            if (nextTokenType === TokenType.CloseBracket || nextTokenType === TokenType.Comma) {
                break;
            }

            if (nextTokenType !== TokenType.Colon) {
                sliceExpressions[sliceIndex] = this._parseTestExpression(/* allowAssignmentExpression */ false);
            }
            sliceIndex++;

            if (sliceIndex >= 3 || !this._consumeTokenIfType(TokenType.Colon)) {
                break;
            }
            sawColon = true;
        }

        // If this was a simple expression with no colons return it.
        if (!sawColon) {
            if (sliceExpressions[0]) {
                return sliceExpressions[0];
            }

            return ErrorNode.create(this._peekToken(), ErrorExpressionCategory.MissingIndexOrSlice);
        }

        const sliceNode = SliceNode.create(firstToken);
        sliceNode.startValue = sliceExpressions[0];
        if (sliceNode.startValue) {
            sliceNode.startValue.parent = sliceNode;
        }
        sliceNode.endValue = sliceExpressions[1];
        if (sliceNode.endValue) {
            sliceNode.endValue.parent = sliceNode;
        }
        sliceNode.stepValue = sliceExpressions[2];
        if (sliceNode.stepValue) {
            sliceNode.stepValue.parent = sliceNode;
        }
        const extension = sliceExpressions[2] || sliceExpressions[1] || sliceExpressions[0];
        if (extension) {
            extendRange(sliceNode, extension);
        }

        return sliceNode;
    }

    // arglist: argument (',' argument)*  [',']
    private _parseArgList(): ArgumentNode[] {
        const argList: ArgumentNode[] = [];
        let sawKeywordArg = false;

        while (true) {
            const nextTokenType = this._peekTokenType();
            if (
                nextTokenType === TokenType.CloseParenthesis ||
                nextTokenType === TokenType.NewLine ||
                nextTokenType === TokenType.EndOfStream
            ) {
                break;
            }

            const arg = this._parseArgument();
            if (arg.name) {
                sawKeywordArg = true;
            } else if (sawKeywordArg && arg.argumentCategory === ArgumentCategory.Simple) {
                this._addError(Localizer.Diagnostic.positionArgAfterNamedArg(), arg);
            }
            argList.push(arg);

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        return argList;
    }

    // argument: ( test [comp_for] |
    //             test '=' test |
    //             '**' test |
    //             '*' test )
    private _parseArgument(): ArgumentNode {
        const firstToken = this._peekToken();

        let argType = ArgumentCategory.Simple;
        if (this._consumeTokenIfOperator(OperatorType.Multiply)) {
            argType = ArgumentCategory.UnpackedList;
        } else if (this._consumeTokenIfOperator(OperatorType.Power)) {
            argType = ArgumentCategory.UnpackedDictionary;
        }

        let valueExpr = this._parseTestExpression(/* allowAssignmentExpression */ true);
        let nameIdentifier: IdentifierToken | undefined;

        if (argType === ArgumentCategory.Simple) {
            if (this._consumeTokenIfOperator(OperatorType.Assign)) {
                const nameExpr = valueExpr;
                valueExpr = this._parseTestExpression(/* allowAssignmentExpression */ false);

                if (nameExpr.nodeType === ParseNodeType.Name) {
                    nameIdentifier = nameExpr.token;
                } else {
                    this._addError(Localizer.Diagnostic.expectedParamName(), nameExpr);
                }
            } else {
                const listComp = this._tryParseListComprehension(valueExpr);
                if (listComp) {
                    valueExpr = listComp;
                }
            }
        }

        const argNode = ArgumentNode.create(firstToken, valueExpr, argType);
        if (nameIdentifier) {
            argNode.name = NameNode.create(nameIdentifier);
            argNode.name.parent = argNode;
        }

        return argNode;
    }

    // atom: ('(' [yield_expr | testlist_comp] ')' |
    //     '[' [testlist_comp] ']' |
    //     '{' [dictorsetmaker] '}' |
    //     NAME | NUMBER | STRING+ | '...' | 'None' | 'True' | 'False' | '__debug__')
    private _parseAtom(): ExpressionNode {
        const nextToken = this._peekToken();

        if (nextToken.type === TokenType.Ellipsis) {
            return EllipsisNode.create(this._getNextToken());
        }

        if (nextToken.type === TokenType.Number) {
            return NumberNode.create(this._getNextToken() as NumberToken);
        }

        if (nextToken.type === TokenType.Identifier) {
            return NameNode.create(this._getNextToken() as IdentifierToken);
        }

        if (nextToken.type === TokenType.String) {
            return this._parseStringList();
        }

        if (nextToken.type === TokenType.Backtick) {
            this._getNextToken();

            // Atoms with backticks are no longer allowed in Python 3.x, but they
            // were a thing in Python 2.x. We'll parse them to improve parse recovery
            // and emit an error.
            this._addError(Localizer.Diagnostic.backticksIllegal(), nextToken);

            const expressionNode = this._parseTestListAsExpression(
                ErrorExpressionCategory.MissingExpression,
                Localizer.Diagnostic.expectedExpr()
            );

            this._consumeTokenIfType(TokenType.Backtick);
            return expressionNode;
        }

        if (nextToken.type === TokenType.OpenParenthesis) {
            const possibleTupleNode = this._parseTupleAtom();
            if (
                possibleTupleNode.nodeType === ParseNodeType.Tuple &&
                this._isParsingTypeAnnotation &&
                !this._isParsingIndexTrailer
            ) {
                // This is allowed inside of an index trailer, specifically
                // to support Tuple[()], which is the documented way to annotate
                // a zero-length tuple.
                const diag = new DiagnosticAddendum();
                diag.addMessage(Localizer.DiagnosticAddendum.useTupleInstead());
                this._addError(Localizer.Diagnostic.tupleInAnnotation() + diag.getString(), possibleTupleNode);
            }

            if (possibleTupleNode.nodeType === ParseNodeType.BinaryOperation) {
                // Mark the binary expression as parenthesized so we don't attempt
                // to use comparison chaining, which isn't appropriate when the
                // expression is parenthesized.
                possibleTupleNode.parenthesized = true;
            }
            return possibleTupleNode;
        } else if (nextToken.type === TokenType.OpenBracket) {
            const listNode = this._parseListAtom();
            if (this._isParsingTypeAnnotation && !this._isParsingIndexTrailer) {
                const diag = new DiagnosticAddendum();
                diag.addMessage(Localizer.DiagnosticAddendum.useListInstead());
                this._addError(Localizer.Diagnostic.listInAnnotation() + diag.getString(), listNode);
            }
            return listNode;
        } else if (nextToken.type === TokenType.OpenCurlyBrace) {
            const dictNode = this._parseDictionaryOrSetAtom();
            if (this._isParsingTypeAnnotation) {
                const diag = new DiagnosticAddendum();
                diag.addMessage(Localizer.DiagnosticAddendum.useDictInstead());
                this._addError(Localizer.Diagnostic.dictInAnnotation() + diag.getString(), dictNode);
            }
            return dictNode;
        }

        if (nextToken.type === TokenType.Keyword) {
            const keywordToken = nextToken as KeywordToken;
            if (
                keywordToken.keywordType === KeywordType.False ||
                keywordToken.keywordType === KeywordType.True ||
                keywordToken.keywordType === KeywordType.Debug ||
                keywordToken.keywordType === KeywordType.None
            ) {
                return ConstantNode.create(this._getNextToken() as KeywordToken);
            }

            // Make an identifier out of the keyword.
            const keywordAsIdentifier = this._getTokenIfIdentifier();
            if (keywordAsIdentifier) {
                return NameNode.create(keywordAsIdentifier);
            }
        }

        return this._handleExpressionParseError(
            ErrorExpressionCategory.MissingExpression,
            Localizer.Diagnostic.expectedExpr()
        );
    }

    // Allocates a dummy "error expression" and consumes the remainder
    // of the tokens on the line for error recovery. A partially-completed
    // child node can be passed to help the completion provider determine
    // what to do.
    private _handleExpressionParseError(
        category: ErrorExpressionCategory,
        errorMsg: string,
        childNode?: ExpressionNode,
        additionalStopTokens?: TokenType[]
    ): ErrorNode {
        this._addError(errorMsg, this._peekToken());
        const expr = ErrorNode.create(this._peekToken(), category, childNode);
        const stopTokens = [TokenType.NewLine];
        if (additionalStopTokens) {
            stopTokens.push(...additionalStopTokens);
        }
        this._consumeTokensUntilType(stopTokens);
        return expr;
    }

    // lambdef: 'lambda' [varargslist] ':' test
    private _parseLambdaExpression(allowConditional = true): LambdaNode {
        const lambdaToken = this._getKeywordToken(KeywordType.Lambda);

        const argList = this._parseVarArgsList(TokenType.Colon, /* allowAnnotations */ false);

        if (!this._consumeTokenIfType(TokenType.Colon)) {
            this._addError(Localizer.Diagnostic.expectedColon(), this._peekToken());
        }

        let testExpr: ExpressionNode;
        if (allowConditional) {
            testExpr = this._parseTestExpression(/* allowAssignmentExpression */ false);
        } else {
            testExpr = this._tryParseLambdaExpression(/* allowConditional */ false) || this._parseOrTest();
        }

        const lambdaNode = LambdaNode.create(lambdaToken, testExpr);
        lambdaNode.parameters = argList;
        argList.forEach((arg) => {
            arg.parent = lambdaNode;
        });
        return lambdaNode;
    }

    private _tryParseLambdaExpression(allowConditional = true): LambdaNode | undefined {
        if (this._peekKeywordType() !== KeywordType.Lambda) {
            return undefined;
        }

        return this._parseLambdaExpression(allowConditional);
    }

    // ('(' [yield_expr | testlist_comp] ')'
    // testlist_comp: (test | star_expr) (comp_for | (',' (test | star_expr))* [','])
    private _parseTupleAtom(): ExpressionNode {
        const startParen = this._getNextToken();
        assert(startParen.type === TokenType.OpenParenthesis);

        const yieldExpr = this._tryParseYieldExpression();
        if (yieldExpr) {
            if (this._peekTokenType() !== TokenType.CloseParenthesis) {
                return this._handleExpressionParseError(
                    ErrorExpressionCategory.MissingTupleCloseParen,
                    Localizer.Diagnostic.expectedCloseParen()
                );
            } else {
                extendRange(yieldExpr, this._getNextToken());
            }

            return yieldExpr;
        }

        const exprListResult = this._parseTestListWithComprehension();
        const tupleOrExpression = this._makeExpressionOrTuple(exprListResult, /* enclosedInParens */ true);
        const isExpression = exprListResult.list.length === 1 && !exprListResult.trailingComma;

        if (!isExpression) {
            extendRange(tupleOrExpression, startParen);
        }

        if (this._peekTokenType() !== TokenType.CloseParenthesis) {
            return this._handleExpressionParseError(
                ErrorExpressionCategory.MissingTupleCloseParen,
                Localizer.Diagnostic.expectedCloseParen()
            );
        } else {
            const nextToken = this._getNextToken();
            if (!isExpression) {
                extendRange(tupleOrExpression, nextToken);
            }
        }

        return tupleOrExpression;
    }

    // '[' [testlist_comp] ']'
    // testlist_comp: (test | star_expr) (comp_for | (',' (test | star_expr))* [','])
    private _parseListAtom(): ListNode | ErrorNode {
        const startBracket = this._getNextToken();
        assert(startBracket.type === TokenType.OpenBracket);

        const exprListResult = this._parseTestListWithComprehension();
        const closeBracket: Token | undefined = this._peekToken();
        if (!this._consumeTokenIfType(TokenType.CloseBracket)) {
            return this._handleExpressionParseError(
                ErrorExpressionCategory.MissingListCloseBracket,
                Localizer.Diagnostic.expectedCloseBracket()
            );
        }

        const listAtom = ListNode.create(startBracket);
        extendRange(listAtom, closeBracket);
        if (exprListResult.list.length > 0) {
            exprListResult.list.forEach((expr) => {
                expr.parent = listAtom;
            });
            extendRange(listAtom, exprListResult.list[exprListResult.list.length - 1]);
        }
        listAtom.entries = exprListResult.list;
        return listAtom;
    }

    private _parseTestListWithComprehension(): ListResult<ExpressionNode> {
        let sawComprehension = false;

        return this._parseExpressionListGeneric(
            () => {
                let expr = this._parseTestOrStarExpression(/* allowAssignmentExpression */ true);
                const listComp = this._tryParseListComprehension(expr);
                if (listComp) {
                    expr = listComp;
                    sawComprehension = true;
                }
                return expr;
            },
            () => this._isNextTokenNeverExpression(),
            () => sawComprehension
        );
    }

    // '{' [dictorsetmaker] '}'
    // dictorsetmaker: (
    //    (dictentry (comp_for | (',' dictentry)* [',']))
    //    | (setentry (comp_for | (',' setentry)* [',']))
    // )
    // dictentry: (test ':' test | '**' expr)
    // setentry: test | star_expr
    private _parseDictionaryOrSetAtom(): DictionaryNode | SetNode {
        const startBrace = this._getNextToken();
        assert(startBrace.type === TokenType.OpenCurlyBrace);

        const dictionaryEntries: DictionaryEntryNode[] = [];
        const setEntries: ExpressionNode[] = [];
        let isDictionary = false;
        let isSet = false;
        let sawListComprehension = false;
        let isFirstEntry = true;

        while (true) {
            if (this._peekTokenType() === TokenType.CloseCurlyBrace) {
                break;
            }

            let doubleStarExpression: ExpressionNode | undefined;
            let keyExpression: ExpressionNode | undefined;
            let valueExpression: ExpressionNode | undefined;
            const doubleStar = this._peekToken();

            if (this._consumeTokenIfOperator(OperatorType.Power)) {
                doubleStarExpression = this._parseExpression(/* allowUnpack */ false);
            } else {
                keyExpression = this._parseTestOrStarExpression(/* allowAssignmentExpression */ true);

                if (this._consumeTokenIfType(TokenType.Colon)) {
                    valueExpression = this._parseTestExpression(/* allowAssignmentExpression */ false);
                }
            }

            if (keyExpression && valueExpression) {
                if (keyExpression.nodeType === ParseNodeType.Unpack) {
                    this._addError(Localizer.Diagnostic.unpackInDict(), keyExpression);
                }

                if (isSet) {
                    this._addError(Localizer.Diagnostic.keyValueInSet(), valueExpression);
                } else {
                    const keyEntryNode = DictionaryKeyEntryNode.create(keyExpression, valueExpression);
                    let dictEntry: DictionaryEntryNode = keyEntryNode;
                    const listComp = this._tryParseListComprehension(keyEntryNode);
                    if (listComp) {
                        dictEntry = listComp;
                        sawListComprehension = true;

                        if (!isFirstEntry) {
                            this._addError(Localizer.Diagnostic.comprehensionInDict(), dictEntry);
                        }
                    }
                    dictionaryEntries.push(dictEntry);
                    isDictionary = true;
                }
            } else if (doubleStarExpression) {
                if (isSet) {
                    this._addError(Localizer.Diagnostic.unpackInSet(), doubleStarExpression);
                } else {
                    const listEntryNode = DictionaryExpandEntryNode.create(doubleStarExpression);
                    extendRange(listEntryNode, doubleStar);
                    let expandEntryNode: DictionaryEntryNode = listEntryNode;
                    const listComp = this._tryParseListComprehension(listEntryNode);
                    if (listComp) {
                        expandEntryNode = listComp;
                        sawListComprehension = true;

                        if (!isFirstEntry) {
                            this._addError(Localizer.Diagnostic.comprehensionInDict(), doubleStarExpression);
                        }
                    }
                    dictionaryEntries.push(expandEntryNode);
                    isDictionary = true;
                }
            } else {
                assert(keyExpression !== undefined);
                if (keyExpression) {
                    if (isDictionary) {
                        this._addError(Localizer.Diagnostic.dictKeyValuePairs(), keyExpression);
                    } else {
                        const listComp = this._tryParseListComprehension(keyExpression);
                        if (listComp) {
                            keyExpression = listComp;
                            sawListComprehension = true;

                            if (!isFirstEntry) {
                                this._addError(Localizer.Diagnostic.comprehensionInSet(), keyExpression);
                            }
                        }
                        setEntries.push(keyExpression);
                        isSet = true;
                    }
                }
            }

            // List comprehension statements always end the list.
            if (sawListComprehension) {
                break;
            }

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }

            isFirstEntry = false;
        }

        let closeCurlyBrace: Token | undefined = this._peekToken();
        if (!this._consumeTokenIfType(TokenType.CloseCurlyBrace)) {
            this._addError(Localizer.Diagnostic.expectedCloseBrace(), this._peekToken());
            closeCurlyBrace = undefined;
        }

        if (isSet) {
            const setAtom = SetNode.create(startBrace);
            if (closeCurlyBrace) {
                extendRange(setAtom, closeCurlyBrace);
            }
            if (setEntries.length > 0) {
                extendRange(setAtom, setEntries[setEntries.length - 1]);
            }
            setEntries.forEach((entry) => {
                entry.parent = setAtom;
            });
            setAtom.entries = setEntries;
            return setAtom;
        }

        const dictionaryAtom = DictionaryNode.create(startBrace);
        if (closeCurlyBrace) {
            extendRange(dictionaryAtom, closeCurlyBrace);
        }
        if (dictionaryEntries.length > 0) {
            dictionaryEntries.forEach((entry) => {
                entry.parent = dictionaryAtom;
            });
            extendRange(dictionaryAtom, dictionaryEntries[dictionaryEntries.length - 1]);
        }
        dictionaryAtom.entries = dictionaryEntries;
        return dictionaryAtom;
    }

    private _parseExpressionListGeneric<T extends ParseNode = ExpressionNode>(
        parser: () => T | ErrorNode,
        terminalCheck: () => boolean = () => this._isNextTokenNeverExpression(),
        finalEntryCheck: () => boolean = () => false
    ): ListResult<T> {
        let trailingComma = false;
        const list: T[] = [];
        let parseError: ErrorNode | undefined;

        while (true) {
            if (terminalCheck()) {
                break;
            }

            const expr = parser();
            if (expr.nodeType === ParseNodeType.Error) {
                parseError = expr as ErrorNode;
                break;
            }
            list.push(expr);

            // Should we stop without checking for a trailing comma?
            if (finalEntryCheck()) {
                break;
            }

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                trailingComma = false;
                break;
            }

            trailingComma = true;
        }

        return { trailingComma, list, parseError };
    }

    // expr_stmt: testlist_star_expr (annassign | augassign (yield_expr | testlist) |
    //                     ('=' (yield_expr | testlist_star_expr))*)
    // testlist_star_expr: (test|star_expr) (',' (test|star_expr))* [',']
    // annassign: ':' test ['=' (yield_expr | testlist_star_expr)]
    // augassign: ('+=' | '-=' | '*=' | '@=' | '/=' | '%=' | '&=' | '|=' | '^=' |
    //             '<<=' | '>>=' | '**=' | '//=')
    private _parseExpressionStatement(): ExpressionNode {
        let leftExpr = this._parseTestOrStarListAsExpression(
            /* allowAssignmentExpression */ false,
            ErrorExpressionCategory.MissingExpression,
            Localizer.Diagnostic.expectedExpr()
        );
        let annotationExpr: ExpressionNode | undefined;

        if (leftExpr.nodeType === ParseNodeType.Error) {
            return leftExpr;
        }

        // Is this a type annotation assignment?
        if (this._consumeTokenIfType(TokenType.Colon)) {
            annotationExpr = this._parseTypeAnnotation();
            leftExpr = TypeAnnotationNode.create(leftExpr, annotationExpr);

            if (!this._parseOptions.isStubFile && this._getLanguageVersion() < PythonVersion.V3_6) {
                this._addError(Localizer.Diagnostic.varAnnotationIllegal(), annotationExpr);
            }

            if (!this._consumeTokenIfOperator(OperatorType.Assign)) {
                return leftExpr;
            }

            // This is an unfortunate hack that's necessary to accommodate 'TypeAlias'
            // declarations properly. We need to treat this assignment differently than
            // most because the expression on the right side is treated like a type
            // annotation and therefore allows string-literal forward declarations.
            const isTypeAliasDeclaration = this._isTypingAnnotation(annotationExpr, 'TypeAlias');

            const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
            if (isTypeAliasDeclaration) {
                this._isParsingTypeAnnotation = true;
            }

            const rightExpr =
                this._tryParseYieldExpression() ||
                this._parseTestOrStarListAsExpression(
                    /* allowAssignmentExpression */ false,
                    ErrorExpressionCategory.MissingExpression,
                    Localizer.Diagnostic.expectedAssignRightHandExpr()
                );

            this._isParsingTypeAnnotation = wasParsingTypeAnnotation;

            return AssignmentNode.create(leftExpr, rightExpr);
        }

        // Is this a simple assignment?
        if (this._consumeTokenIfOperator(OperatorType.Assign)) {
            return this._parseChainAssignments(leftExpr);
        }

        if (Tokenizer.isOperatorAssignment(this._peekOperatorType())) {
            const operatorToken = this._getNextToken() as OperatorToken;

            const rightExpr =
                this._tryParseYieldExpression() ||
                this._parseTestListAsExpression(
                    ErrorExpressionCategory.MissingExpression,
                    Localizer.Diagnostic.expectedBinaryRightHandExpr()
                );

            // Make a shallow copy of the dest expression but give it a new ID.
            const destExpr = Object.assign({}, leftExpr);
            destExpr.id = getNextNodeId();

            return AugmentedAssignmentNode.create(leftExpr, rightExpr, operatorToken.operatorType, destExpr);
        }

        return leftExpr;
    }

    private _parseChainAssignments(leftExpr: ExpressionNode): ExpressionNode {
        let rightExpr =
            this._tryParseYieldExpression() ||
            this._parseTestOrStarListAsExpression(
                /* allowAssignmentExpression */ false,
                ErrorExpressionCategory.MissingExpression,
                Localizer.Diagnostic.expectedAssignRightHandExpr()
            );

        if (rightExpr.nodeType === ParseNodeType.Error) {
            return AssignmentNode.create(leftExpr, rightExpr);
        }

        // Recur until we've consumed the entire chain.
        if (this._consumeTokenIfOperator(OperatorType.Assign)) {
            rightExpr = this._parseChainAssignments(rightExpr);
            if (rightExpr.nodeType === ParseNodeType.Error) {
                return rightExpr;
            }
        }

        const assignmentNode = AssignmentNode.create(leftExpr, rightExpr);

        // Look for a type annotation comment at the end of the line.
        const typeAnnotationComment = this._parseVariableTypeAnnotationComment();
        if (typeAnnotationComment) {
            assignmentNode.typeAnnotationComment = typeAnnotationComment;
            assignmentNode.typeAnnotationComment.parent = assignmentNode;
            extendRange(assignmentNode, assignmentNode.typeAnnotationComment);
        }

        return assignmentNode;
    }

    private _parseFunctionTypeAnnotation(): FunctionAnnotationNode | undefined {
        const openParenToken = this._peekToken();
        if (!this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            this._addError(Localizer.Diagnostic.expectedOpenParen(), this._peekToken());
            return undefined;
        }

        let paramAnnotations: ExpressionNode[] = [];

        while (true) {
            const nextTokenType = this._peekTokenType();
            if (
                nextTokenType === TokenType.CloseParenthesis ||
                nextTokenType === TokenType.NewLine ||
                nextTokenType === TokenType.EndOfStream
            ) {
                break;
            }

            // Consume "*" or "**" indicators but don't do anything with them.
            // (We don't enforce that these are present, absent, or match
            // the corresponding parameter types.)
            this._consumeTokenIfOperator(OperatorType.Multiply) || this._consumeTokenIfOperator(OperatorType.Power);

            const paramAnnotation = this._parseTypeAnnotation();
            paramAnnotations.push(paramAnnotation);

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
            this._addError(Localizer.Diagnostic.expectedCloseParen(), this._peekToken());
            this._consumeTokensUntilType([TokenType.Colon]);
        }

        if (!this._consumeTokenIfType(TokenType.Arrow)) {
            this._addError(Localizer.Diagnostic.expectedArrow(), this._peekToken());
            return undefined;
        }

        const returnType = this._parseTypeAnnotation();

        let isParamListEllipsis = false;
        if (paramAnnotations.length === 1 && paramAnnotations[0].nodeType === ParseNodeType.Ellipsis) {
            paramAnnotations = [];
            isParamListEllipsis = true;
        }

        return FunctionAnnotationNode.create(openParenToken, isParamListEllipsis, paramAnnotations, returnType);
    }

    private _parseTypeAnnotation(): ExpressionNode {
        // Temporary set a flag that indicates we're parsing a type annotation.
        const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
        this._isParsingTypeAnnotation = true;

        // Allow unpack operators.
        const startToken = this._peekToken();
        const isUnpack = this._consumeTokenIfOperator(OperatorType.Multiply);
        let result = this._parseTestExpression(/* allowAssignmentExpression */ false);
        if (isUnpack) {
            result = UnpackNode.create(startToken, result);
        }

        this._isParsingTypeAnnotation = wasParsingTypeAnnotation;

        return result;
    }

    private _reportStringTokenErrors(stringToken: StringToken, unescapedResult: StringTokenUtils.UnescapedString) {
        if (stringToken.flags & StringTokenFlags.Unterminated) {
            this._addError(Localizer.Diagnostic.stringUnterminated(), stringToken);
        }

        if (unescapedResult.nonAsciiInBytes) {
            this._addError(Localizer.Diagnostic.stringNonAsciiBytes(), stringToken);
        }

        if (stringToken.flags & StringTokenFlags.Format) {
            if (this._getLanguageVersion() < PythonVersion.V3_6) {
                this._addError(Localizer.Diagnostic.formatStringIllegal(), stringToken);
            }

            if (stringToken.flags & StringTokenFlags.Bytes) {
                this._addError(Localizer.Diagnostic.formatStringBytes(), stringToken);
            }

            if (stringToken.flags & StringTokenFlags.Unicode) {
                this._addError(Localizer.Diagnostic.formatStringUnicode(), stringToken);
            }
        }
    }

    private _makeStringNode(stringToken: StringToken): StringNode {
        const unescapedResult = StringTokenUtils.getUnescapedString(stringToken);
        this._reportStringTokenErrors(stringToken, unescapedResult);
        return StringNode.create(stringToken, unescapedResult.value, unescapedResult.unescapeErrors.length > 0);
    }

    private _getTypeAnnotationCommentText(): StringToken | undefined {
        if (this._tokenIndex === 0) {
            return undefined;
        }

        const curToken = this._tokenizerOutput!.tokens.getItemAt(this._tokenIndex - 1);
        const nextToken = this._tokenizerOutput!.tokens.getItemAt(this._tokenIndex);

        if (curToken.start + curToken.length === nextToken.start) {
            return undefined;
        }

        const interTokenContents = this._fileContents!.substring(curToken.start + curToken.length, nextToken.start);
        const commentRegEx = /^(\s*#\s*type:\s*)([^\r\n]*)/;
        const match = interTokenContents.match(commentRegEx);
        if (!match) {
            return undefined;
        }

        // Synthesize a string token and StringNode.
        const typeString = match[2];

        // Ignore all "ignore" comments. Include "[" in the regular
        // expression because mypy supports ignore comments of the
        // form ignore[errorCode, ...]. We'll treat these as regular
        // ignore statements (as though no errorCodes were included).
        if (typeString.trim().match(/^ignore(\s|\[|$)/)) {
            return undefined;
        }

        const tokenOffset = curToken.start + curToken.length + match[1].length;
        return StringToken.create(tokenOffset, typeString.length, StringTokenFlags.None, typeString, 0, undefined);
    }

    private _parseVariableTypeAnnotationComment(): ExpressionNode | undefined {
        const stringToken = this._getTypeAnnotationCommentText();
        if (!stringToken) {
            return undefined;
        }

        const stringNode = this._makeStringNode(stringToken);
        const stringListNode = StringListNode.create([stringNode]);
        const parser = new Parser();
        const parseResults = parser.parseTextExpression(
            this._fileContents!,
            stringToken.start,
            stringToken.length,
            this._parseOptions,
            ParseTextMode.VariableAnnotation
        );

        parseResults.diagnostics.forEach((diag) => {
            this._addError(diag.message, stringListNode);
        });

        if (!parseResults.parseTree) {
            return undefined;
        }

        return parseResults.parseTree;
    }

    private _parseFunctionTypeAnnotationComment(stringToken: StringToken, functionNode: FunctionNode): void {
        const stringNode = this._makeStringNode(stringToken);
        const stringListNode = StringListNode.create([stringNode]);
        const parser = new Parser();
        const parseResults = parser.parseTextExpression(
            this._fileContents!,
            stringToken.start,
            stringToken.length,
            this._parseOptions,
            ParseTextMode.FunctionAnnotation
        );

        parseResults.diagnostics.forEach((diag) => {
            this._addError(diag.message, stringListNode);
        });

        if (!parseResults.parseTree || parseResults.parseTree.nodeType !== ParseNodeType.FunctionAnnotation) {
            return;
        }

        const functionAnnotation = parseResults.parseTree;

        functionNode.functionAnnotationComment = functionAnnotation;
        functionAnnotation.parent = functionNode;
        extendRange(functionNode, functionAnnotation);
    }

    private _parseFormatStringSegment(
        stringToken: StringToken,
        segment: StringTokenUtils.FormatStringSegment,
        segmentOffset: number,
        segmentLength: number
    ) {
        assert(segment.isExpression);
        const parser = new Parser();
        const parseResults = parser.parseTextExpression(
            this._fileContents!,
            stringToken.start + stringToken.prefixLength + stringToken.quoteMarkLength + segment.offset + segmentOffset,
            segmentLength,
            this._parseOptions,
            ParseTextMode.Expression,
            /* initialParenDepth */ 1
        );

        parseResults.diagnostics.forEach((diag) => {
            const textRangeStart =
                (diag.range ? convertPositionToOffset(diag.range.start, parseResults.lines) : stringToken.start) ||
                stringToken.start;
            const textRangeEnd =
                (diag.range
                    ? (convertPositionToOffset(diag.range.end, parseResults.lines) || 0) + 1
                    : stringToken.start + stringToken.length) || stringToken.start + stringToken.length;
            const textRange = { start: textRangeStart, length: textRangeEnd - textRangeStart };
            this._addError(diag.message, textRange);
        });

        return parseResults.parseTree;
    }

    private _parseFormatString(stringToken: StringToken): FormatStringNode {
        const unescapedResult = StringTokenUtils.getUnescapedString(stringToken);
        this._reportStringTokenErrors(stringToken, unescapedResult);

        const formatExpressions: ExpressionNode[] = [];

        for (const segment of unescapedResult.formatStringSegments) {
            if (segment.isExpression) {
                // Determine if we need to truncate the expression because it
                // contains formatting directives that start with a ! or :.
                const segmentExprLength = this._getFormatStringExpressionLength(segment.value.trimEnd());
                const parseTree = this._parseFormatStringSegment(stringToken, segment, 0, segmentExprLength);
                if (parseTree) {
                    formatExpressions.push(parseTree);
                }

                // Look for additional expressions within the format directive.
                const formatDirective = segment.value.substr(segmentExprLength);
                let braceDepth = 0;
                let startOfExprOffset = 0;
                for (let i = 0; i < formatDirective.length; i++) {
                    if (formatDirective.charCodeAt(i) === Char.OpenBrace) {
                        if (braceDepth === 0) {
                            startOfExprOffset = i + 1;
                        }
                        braceDepth++;
                    } else if (formatDirective.charCodeAt(i) === Char.CloseBrace) {
                        if (braceDepth > 0) {
                            braceDepth--;
                            if (braceDepth === 0) {
                                const formatSegmentLength = this._getFormatStringExpressionLength(
                                    segment.value.substr(segmentExprLength + startOfExprOffset, i - startOfExprOffset)
                                );
                                const parseTree = this._parseFormatStringSegment(
                                    stringToken,
                                    segment,
                                    segmentExprLength + startOfExprOffset,
                                    formatSegmentLength
                                );
                                if (parseTree) {
                                    formatExpressions.push(parseTree);
                                }
                            }
                        }
                    }
                }
            }
        }

        return FormatStringNode.create(
            stringToken,
            unescapedResult.value,
            unescapedResult.unescapeErrors.length > 0,
            formatExpressions
        );
    }

    private _getFormatStringExpressionLength(segmentValue: string): number {
        let segmentExprLength = 0;

        // PEP 498 says: Expressions cannot contain ':' or '!' outside of
        // strings or parentheses, brackets, or braces. The exception is
        // that the '!=' operator is allowed as a special case.
        const quoteStack: string[] = [];
        let braceCount = 0;
        let parenCount = 0;
        let bracketCount = 0;
        let indexOfDebugEqual: number | undefined;

        while (segmentExprLength < segmentValue.length) {
            const curChar = segmentValue[segmentExprLength];
            const ignoreSeparator = quoteStack.length > 0 || braceCount > 0 || parenCount > 0 || bracketCount > 0;
            const inString = quoteStack.length > 0;

            if (curChar === '=') {
                indexOfDebugEqual = segmentExprLength;
            } else {
                if (curChar === ':') {
                    if (!ignoreSeparator) {
                        break;
                    }
                } else if (curChar === '!') {
                    if (!ignoreSeparator) {
                        // Allow !=, as per PEP 498
                        if (
                            segmentExprLength === segmentValue.length - 1 ||
                            segmentValue[segmentExprLength + 1] !== '='
                        ) {
                            break;
                        }
                    }
                } else if (curChar === "'" || curChar === '"') {
                    let quoteSequence = curChar;
                    if (
                        segmentExprLength + 2 < segmentValue.length &&
                        segmentValue[segmentExprLength + 1] === curChar &&
                        segmentValue[segmentExprLength + 2] === curChar
                    ) {
                        quoteSequence = curChar + curChar + curChar;
                        segmentExprLength += 2;
                    }

                    if (quoteStack.length > 0 && quoteStack[quoteStack.length - 1] === quoteSequence) {
                        quoteStack.pop();
                    } else if (quoteStack.length === 0) {
                        quoteStack.push(quoteSequence);
                    }
                } else if (curChar === '(') {
                    if (!inString) {
                        parenCount++;
                    }
                } else if (curChar === ')') {
                    if (!inString && parenCount > 0) {
                        parenCount--;
                    }
                } else if (curChar === '{') {
                    if (!inString) {
                        braceCount++;
                    }
                } else if (curChar === '}') {
                    if (!inString && braceCount > 0) {
                        braceCount--;
                    }
                } else if (curChar === '[') {
                    if (!inString) {
                        bracketCount++;
                    }
                } else if (curChar === ']') {
                    if (!inString && bracketCount > 0) {
                        bracketCount--;
                    }
                }

                if (curChar !== ' ') {
                    indexOfDebugEqual = undefined;
                }
            }

            segmentExprLength++;
        }

        // Handle Python 3.8 f-string formatting expressions that
        // end in an "=".
        if (this._parseOptions.pythonVersion >= PythonVersion.V3_8 && indexOfDebugEqual !== undefined) {
            segmentExprLength = indexOfDebugEqual;
        }

        return segmentExprLength;
    }

    private _parseStringList(): StringListNode {
        const stringList: (StringNode | FormatStringNode)[] = [];

        while (this._peekTokenType() === TokenType.String) {
            const stringToken = this._getNextToken() as StringToken;
            if (stringToken.flags & StringTokenFlags.Format) {
                stringList.push(this._parseFormatString(stringToken));
            } else {
                stringList.push(this._makeStringNode(stringToken));
            }
        }

        const stringNode = StringListNode.create(stringList);

        // If we're parsing a type annotation, parse the contents of the string.
        if (this._isParsingTypeAnnotation) {
            // Don't allow multiple strings because we have no way of reporting
            // parse errors that span strings.
            if (stringNode.strings.length > 1) {
                this._addError(Localizer.Diagnostic.annotationSpansStrings(), stringNode);
            } else if (stringNode.strings[0].token.flags & StringTokenFlags.Format) {
                this._addError(Localizer.Diagnostic.annotationFormatString(), stringNode);
            } else {
                const stringToken = stringNode.strings[0].token;
                const stringValue = StringTokenUtils.getUnescapedString(stringNode.strings[0].token);
                const unescapedString = stringValue.value;
                const tokenOffset = stringToken.start;
                const prefixLength = stringToken.prefixLength + stringToken.quoteMarkLength;

                // Don't allow escape characters because we have no way of mapping
                // error ranges back to the escaped text.
                if (unescapedString.length !== stringToken.length - prefixLength - stringToken.quoteMarkLength) {
                    this._addError(Localizer.Diagnostic.annotationStringEscape(), stringNode);
                } else {
                    const parser = new Parser();
                    const parseResults = parser.parseTextExpression(
                        this._fileContents!,
                        tokenOffset + prefixLength,
                        unescapedString.length,
                        this._parseOptions,
                        ParseTextMode.VariableAnnotation,
                        (stringNode.strings[0].token.flags & StringTokenFlags.Triplicate) !== 0 ? 1 : 0
                    );

                    parseResults.diagnostics.forEach((diag) => {
                        this._addError(diag.message, stringNode);
                    });

                    if (parseResults.parseTree) {
                        stringNode.typeAnnotation = parseResults.parseTree;
                        stringNode.typeAnnotation.parent = stringNode;
                    }
                }
            }
        }

        return stringNode;
    }

    // Python 3.8 added support for star (unpack) expressions in tuples
    // following a return or yield statement in cases where the tuple
    // wasn't surrounded in parentheses.
    private _reportConditionalErrorForStarTupleElement(possibleTupleExpr: ExpressionNode) {
        if (possibleTupleExpr.nodeType !== ParseNodeType.Tuple) {
            return;
        }

        if (possibleTupleExpr.enclosedInParens) {
            return;
        }

        if (this._parseOptions.pythonVersion >= PythonVersion.V3_8) {
            return;
        }

        for (const expr of possibleTupleExpr.expressions) {
            if (expr.nodeType === ParseNodeType.Unpack) {
                this._addError(Localizer.Diagnostic.unpackTuplesIllegal(), expr);
                return;
            }
        }
    }

    // Peeks at the next token and returns true if it can never
    // represent the start of an expression.
    private _isNextTokenNeverExpression(): boolean {
        const nextToken = this._peekToken();
        switch (nextToken.type) {
            case TokenType.Keyword: {
                switch (this._peekKeywordType()) {
                    case KeywordType.For:
                    case KeywordType.In:
                    case KeywordType.If:
                        return true;
                }
                break;
            }

            case TokenType.Operator: {
                switch (this._peekOperatorType()) {
                    case OperatorType.AddEqual:
                    case OperatorType.SubtractEqual:
                    case OperatorType.MultiplyEqual:
                    case OperatorType.DivideEqual:
                    case OperatorType.ModEqual:
                    case OperatorType.BitwiseAndEqual:
                    case OperatorType.BitwiseOrEqual:
                    case OperatorType.BitwiseXorEqual:
                    case OperatorType.LeftShiftEqual:
                    case OperatorType.RightShiftEqual:
                    case OperatorType.PowerEqual:
                    case OperatorType.FloorDivideEqual:
                    case OperatorType.Assign:
                        return true;
                }
                break;
            }

            case TokenType.Indent:
            case TokenType.Dedent:
            case TokenType.NewLine:
            case TokenType.EndOfStream:
            case TokenType.Semicolon:
            case TokenType.CloseParenthesis:
            case TokenType.CloseBracket:
            case TokenType.CloseCurlyBrace:
            case TokenType.Comma:
            case TokenType.Colon:
                return true;
        }

        return false;
    }

    private _disallowAssignmentExpression(callback: () => void) {
        const wasAllowed = this._assignmentExpressionsAllowed;
        this._assignmentExpressionsAllowed = false;

        callback();

        this._assignmentExpressionsAllowed = wasAllowed;
    }

    private _getNextToken(): Token {
        const token = this._tokenizerOutput!.tokens.getItemAt(this._tokenIndex);
        if (!this._atEof()) {
            this._tokenIndex++;
        }

        return token;
    }

    private _atEof(): boolean {
        // Are we pointing at the last token in the stream (which is
        // assumed to be an end-of-stream token)?
        return this._tokenIndex >= this._tokenizerOutput!.tokens.count - 1;
    }

    private _peekToken(count = 0): Token {
        if (this._tokenIndex + count < 0) {
            return this._tokenizerOutput!.tokens.getItemAt(0);
        }

        if (this._tokenIndex + count >= this._tokenizerOutput!.tokens.count) {
            return this._tokenizerOutput!.tokens.getItemAt(this._tokenizerOutput!.tokens.count - 1);
        }

        return this._tokenizerOutput!.tokens.getItemAt(this._tokenIndex + count);
    }

    private _peekTokenType(): TokenType {
        return this._peekToken().type;
    }

    private _peekKeywordType(): KeywordType | undefined {
        const nextToken = this._peekToken();
        if (nextToken.type !== TokenType.Keyword) {
            return undefined;
        }

        return (nextToken as KeywordToken).keywordType;
    }

    private _peekOperatorType(): OperatorType | undefined {
        const nextToken = this._peekToken();
        if (nextToken.type !== TokenType.Operator) {
            return undefined;
        }

        return (nextToken as OperatorToken).operatorType;
    }

    private _getTokenIfIdentifier(): IdentifierToken | undefined {
        const nextToken = this._peekToken();
        if (nextToken.type === TokenType.Identifier) {
            return this._getNextToken() as IdentifierToken;
        }

        // If the next token is invalid, treat it as an identifier.
        if (nextToken.type === TokenType.Invalid) {
            this._getNextToken();
            this._addError(Localizer.Diagnostic.invalidIdentifierChar(), nextToken);
            return IdentifierToken.create(nextToken.start, nextToken.length, '', nextToken.comments);
        }

        // If this is a "soft keyword", it can be converted into an identifier.
        if (nextToken.type === TokenType.Keyword) {
            const keywordType = this._peekKeywordType();
            const softKeywords = [KeywordType.Debug, KeywordType.Match, KeywordType.Case];
            if (softKeywords.find((type) => type === keywordType)) {
                const keywordText = this._fileContents!.substr(nextToken.start, nextToken.length);
                this._getNextToken();
                return IdentifierToken.create(nextToken.start, nextToken.length, keywordText, nextToken.comments);
            }
        }

        return undefined;
    }

    // Consumes tokens until the next one in the stream is
    // either a specified terminator or the end-of-stream
    // token.
    private _consumeTokensUntilType(terminators: TokenType[]): boolean {
        while (true) {
            const token = this._peekToken();
            if (terminators.some((term) => term === token.type)) {
                return true;
            }

            if (token.type === TokenType.EndOfStream) {
                return false;
            }

            this._getNextToken();
        }
    }

    private _consumeTokenIfType(tokenType: TokenType): boolean {
        if (this._peekTokenType() === tokenType) {
            this._getNextToken();
            return true;
        }

        return false;
    }

    private _consumeTokenIfKeyword(keywordType: KeywordType): boolean {
        if (this._peekKeywordType() === keywordType) {
            this._getNextToken();
            return true;
        }

        return false;
    }

    private _consumeTokenIfOperator(operatorType: OperatorType): boolean {
        if (this._peekOperatorType() === operatorType) {
            this._getNextToken();
            return true;
        }

        return false;
    }

    private _getKeywordToken(keywordType: KeywordType): KeywordToken {
        const keywordToken = this._getNextToken() as KeywordToken;
        assert(keywordToken.type === TokenType.Keyword);
        assert(keywordToken.keywordType === keywordType);
        return keywordToken;
    }

    private _getLanguageVersion() {
        return this._parseOptions.pythonVersion;
    }

    private _suppressErrors(callback: () => void) {
        try {
            this._areErrorsSuppressed = true;
            callback();
        } finally {
            this._areErrorsSuppressed = false;
        }
    }

    private _addError(message: string, range: TextRange) {
        assert(range !== undefined);

        if (!this._areErrorsSuppressed) {
            this._diagSink.addError(
                message,
                convertOffsetsToRange(range.start, range.start + range.length, this._tokenizerOutput!.lines)
            );
        }
    }
}
