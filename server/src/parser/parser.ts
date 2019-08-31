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

import * as assert from 'assert';

import { CancelToken } from '../common/cancelToken';
import { Diagnostic } from '../common/diagnostic';
import { DiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetsToRange, convertPositionToOffset } from '../common/positionUtils';
import { latestStablePythonVersion, PythonVersion } from '../common/pythonVersion';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { timingStats } from '../common/timing';
import { ArgumentCategory, ArgumentNode, AssertNode,
    AssignmentNode, AugmentedAssignmentExpressionNode, AwaitExpressionNode,
    BinaryExpressionNode, BreakNode, CallExpressionNode, ClassNode,
    ConstantNode, ContinueNode, DecoratorNode, DelNode,
    DictionaryEntryNode, DictionaryExpandEntryNode, DictionaryKeyEntryNode,
    DictionaryNode, EllipsisNode, ErrorExpressionCategory, ErrorExpressionNode,
    ExceptNode, ExpressionNode, FormatStringExpression, FormatStringNode, ForNode, FunctionNode,
    GlobalNode, IfNode, ImportAsNode, ImportFromAsNode, ImportFromNode,
    ImportNode, IndexExpressionNode, IndexItemsNode, LambdaNode,
    ListComprehensionForNode, ListComprehensionIfNode, ListComprehensionIterNode, ListComprehensionNode,
    ListNode, MemberAccessExpressionNode, ModuleNameNode, ModuleNode, NameNode, NonlocalNode,
    NumberNode, ParameterCategory, ParameterNode, ParseNode, PassNode, RaiseNode,
    ReturnNode, SetNode, SliceExpressionNode, StatementListNode,
    StatementNode, StringListNode, StringNode, SuiteNode, TernaryExpressionNode,
    TryNode, TupleExpressionNode, TypeAnnotationExpressionNode,
    UnaryExpressionNode, UnpackExpressionNode, WhileNode, WithItemNode, WithNode,
    YieldExpressionNode,
    YieldFromExpressionNode } from './parseNodes';
import { StringTokenUtils, UnescapedString } from './stringTokenUtils';
import { Tokenizer, TokenizerOutput } from './tokenizer';
import { DedentToken, IdentifierToken, KeywordToken, KeywordType,
    NumberToken, OperatorToken, OperatorType, StringToken,
    StringTokenFlags, Token, TokenType } from './tokenizerTypes';

interface ExpressionListResult {
    list: ExpressionNode[];
    trailingComma: boolean;
    parseError?: ErrorExpressionNode;
}

export class ParseOptions {
    constructor() {
        this.isStubFile = false;
        this.pythonVersion = latestStablePythonVersion;
    }

    isStubFile: boolean;
    pythonVersion: PythonVersion;
    reportInvalidStringEscapeSequence: boolean;
}

export interface ParseResults {
    parseTree: ModuleNode;
    futureImports: StringMap<boolean>;
    tokens: TextRangeCollection<Token>;
    lines: TextRangeCollection<TextRange>;
    predominantLineEndSequence: string;
    predominantTabSequence: string;
}

export interface ParseExpressionTextResults {
    parseTree?: ExpressionNode;
    diagnostics: Diagnostic[];
}

export class Parser {
    private _fileContents?: string;
    private _tokenizerOutput?: TokenizerOutput;
    private _tokenIndex = 0;
    private _parseOptions: ParseOptions = new ParseOptions();
    private _cancelToken?: CancelToken;
    private _diagSink: DiagnosticSink = new DiagnosticSink();
    private _isInLoop = false;
    private _isInFinally = false;
    private _isParsingTypeAnnotation = false;
    private _futureImportMap = new StringMap<boolean>();

    parseSourceFile(fileContents: string, parseOptions: ParseOptions,
            diagSink: DiagnosticSink, cancelToken?: CancelToken): ParseResults {

        timingStats.tokenizeFileTime.timeOperation(() => {
            this._startNewParse(fileContents, 0, fileContents.length,
                parseOptions, diagSink, cancelToken);
        });

        const moduleNode = new ModuleNode(new TextRange(0, fileContents.length));

        timingStats.parseFileTime.timeOperation(() => {
            while (!this._atEof()) {
                if (!this._consumeTokenIfType(TokenType.NewLine)) {
                    // Handle a common error case and try to recover.
                    let nextToken = this._peekToken();
                    if (nextToken.type === TokenType.Indent) {
                        this._getNextToken();
                        nextToken = this._peekToken();
                        this._addError('Unexpected indentation', nextToken);
                    }

                    const statement = this._parseStatement();
                    if (!statement) {
                        // Perform basic error recovery to get to the next line.
                        this._consumeTokensUntilType(TokenType.NewLine);
                    } else {
                        moduleNode.statements.push(statement);
                    }

                    this._checkCancel();
                }
            }
        });

        return {
            parseTree: moduleNode,
            futureImports: this._futureImportMap,
            tokens: this._tokenizerOutput!.tokens,
            lines: this._tokenizerOutput!.lines,
            predominantLineEndSequence: this._tokenizerOutput!.predominantEndOfLineSequence,
            predominantTabSequence: this._tokenizerOutput!.predominantTabSequance
        };
    }

    parseTextExpression(fileContents: string, textOffset: number, textLength: number,
            parseOptions: ParseOptions): ParseExpressionTextResults {
        const diagSink = new DiagnosticSink();
        this._startNewParse(fileContents, textOffset, textLength, parseOptions, diagSink);

        const parseTree = this._parseTestExpression();

        if (this._peekTokenType() === TokenType.NewLine) {
            this._getNextToken();
        }

        if (!this._atEof()) {
            this._addError('Unexpected token at end of expression', this._peekToken());
        }

        return {
            parseTree,
            diagnostics: diagSink.diagnostics
        };
    }

    private _startNewParse(fileContents: string, textOffset: number, textLength: number,
            parseOptions: ParseOptions, diagSink: DiagnosticSink, cancelToken?: CancelToken) {
        this._fileContents = fileContents;
        this._parseOptions = parseOptions;
        this._cancelToken = cancelToken;
        this._diagSink = diagSink;

        this._checkCancel();

        // Tokenize the file contents.
        const tokenizer = new Tokenizer();
        this._tokenizerOutput = tokenizer.tokenize(fileContents, textOffset, textLength);
        this._tokenIndex = 0;

        this._checkCancel();
    }

    // stmt: simple_stmt | compound_stmt
    // compound_stmt: if_stmt | while_stmt | for_stmt | try_stmt | with_stmt
    //   | funcdef | classdef | decorated | async_stmt
    private _parseStatement(): StatementNode | undefined {
        // Handle the errant condition of a dedent token here to provide
        // better recovery.
        if (this._consumeTokenIfType(TokenType.Dedent)) {
            this._addError('Unindent not expected', this._peekToken());
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

        this._addError('Expected "def", "with" or "for" to follow "async".',
            asyncToken);

        return undefined;
    }

    // if_stmt: 'if' test_suite ('elif' test_suite)* ['else' suite]
    // test_suite: test suite
    // test: or_test ['if' or_test 'else' test] | lambdef
    private _parseIfStatement(keywordType: KeywordType.If | KeywordType.Elif = KeywordType.If): IfNode {
        const ifOrElifToken = this._getKeywordToken(keywordType);

        const test = this._parseTestExpression();
        const suite = this._parseSuite();
        const ifNode = new IfNode(ifOrElifToken, test, suite);

        if (this._consumeTokenIfKeyword(KeywordType.Else)) {
            ifNode.elseSuite = this._parseSuite();
            ifNode.extend(ifNode.elseSuite);
        } else if (this._peekKeywordType() === KeywordType.Elif) {
            // Recursively handle an "elif" statement.
            ifNode.elseSuite = this._parseIfStatement(KeywordType.Elif);
            ifNode.extend(ifNode.elseSuite);
        }

        return ifNode;
    }

    private _parseLoopSuite(): SuiteNode {
        const wasInLoop = this._isInLoop;
        const wasInFinally = this._isInFinally;
        this._isInLoop = true;
        this._isInFinally = false;

        const suite = this._parseSuite();

        this._isInLoop = wasInLoop;
        this._isInFinally = wasInFinally;

        return suite;
    }

    // suite: ':' (simple_stmt | NEWLINE INDENT stmt+ DEDENT)
    private _parseSuite(): SuiteNode {
        const nextToken = this._peekToken();
        const suite = new SuiteNode(nextToken);

        if (!this._consumeTokenIfType(TokenType.Colon)) {
            this._addError('Expected ":"', nextToken);
            return suite;
        }

        if (this._consumeTokenIfType(TokenType.NewLine)) {
            if (!this._consumeTokenIfType(TokenType.Indent)) {
                this._addError('Expected indented block', this._peekToken());
            }

            while (true) {
                // Handle a common error here and see if we can recover.
                let nextToken = this._peekToken();
                if (nextToken.type === TokenType.Indent) {
                    this._getNextToken();
                    nextToken = this._peekToken();
                    this._addError('Unexpected indentation', nextToken);
                }

                const statement = this._parseStatement();
                if (!statement) {
                    // Perform basic error recovery to get to the next line.
                    this._consumeTokensUntilType(TokenType.NewLine);
                } else {
                    suite.statements.push(statement);
                }

                const dedentToken = this._peekToken() as DedentToken;
                if (this._consumeTokenIfType(TokenType.Dedent)) {
                    if (!dedentToken.matchesIndent) {
                        this._addError('Unindent amount does not match previous indent', dedentToken);
                    }
                    break;
                }

                if (this._peekTokenType() === TokenType.EndOfStream) {
                    break;
                }
            }
        } else {
            suite.statements.push(this._parseSimpleStatement());
        }

        if (suite.statements.length > 0) {
            suite.extend(suite.statements);
        }

        return suite;
    }

    // for_stmt: [async] 'for' exprlist 'in' testlist suite ['else' suite]
    private _parseForStatement(asyncToken?: KeywordToken): ForNode {
        const forToken = this._getKeywordToken(KeywordType.For);

        const exprListResult = this._parseExpressionList(true);
        const targetExpr = this._makeExpressionOrTuple(exprListResult);
        let seqExpr: ExpressionNode;
        let forSuite: SuiteNode;
        let elseSuite: SuiteNode | undefined;

        if (!this._consumeTokenIfKeyword(KeywordType.In)) {
            seqExpr = this._handleExpressionParseError(
                ErrorExpressionCategory.MissingIn, 'Expected "in"');
            forSuite = new SuiteNode(this._peekToken());
        } else {
            seqExpr = this._parseTestListAsExpression(
                ErrorExpressionCategory.MissingExpression, 'Expected expression after "in"');
            forSuite = this._parseLoopSuite();

            if (this._consumeTokenIfKeyword(KeywordType.Else)) {
                elseSuite = this._parseSuite();
            }
        }

        const forNode = new ForNode(forToken, targetExpr, seqExpr, forSuite);
        forNode.elseSuite = elseSuite;
        forNode.extend(elseSuite);

        if (asyncToken) {
            forNode.isAsync = true;
            forNode.extend(asyncToken);
        }

        return forNode;
    }

    // comp_iter: comp_for | comp_if
    private _tryParseListComprehension<T extends ParseNode>(target: T): ListComprehensionNode<T> | undefined {
        const compFor = this._tryParseCompForStatement();

        if (!compFor) {
            return undefined;
        }

        const compList: ListComprehensionIterNode[] = [compFor];
        while (true) {
            const compIter = this._tryParseCompForStatement() || this._tryParseCompIfStatement();
            if (!compIter) {
                break;
            }
            compList.push(compIter);
        }

        const listCompNode = new ListComprehensionNode(target);
        listCompNode.comprehensions = compList;
        listCompNode.extend(compList);
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

        const exprListResult = this._parseExpressionList(true);
        const targetExpr = this._makeExpressionOrTuple(exprListResult);
        let seqExpr: ExpressionNode;

        if (!this._consumeTokenIfKeyword(KeywordType.In)) {
            seqExpr = this._handleExpressionParseError(
                ErrorExpressionCategory.MissingIn, 'Expected "in"');
        } else {
            seqExpr = this._parseOrTest();
        }

        const compForNode = new ListComprehensionForNode(asyncToken || forToken,
            targetExpr, seqExpr);

        if (asyncToken) {
            compForNode.isAsync = true;
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
        const ifExpr = this._tryParseLambdaExpression() || this._parseOrTest();

        const compIfNode = new ListComprehensionIfNode(ifToken, ifExpr);

        return compIfNode;
    }

    // while_stmt: 'while' test suite ['else' suite]
    private _parseWhileStatement(): WhileNode {
        const whileToken = this._getKeywordToken(KeywordType.While);

        const whileNode = new WhileNode(whileToken);

        whileNode.testExpression = this._parseTestExpression();
        whileNode.whileSuite = this._parseLoopSuite();

        if (this._consumeTokenIfKeyword(KeywordType.Else)) {
            whileNode.elseSuite = this._parseSuite();
        }
        whileNode.extend(whileNode.elseSuite || whileNode.whileSuite);

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
        const trySuite = this._parseSuite();
        const tryNode = new TryNode(tryToken, trySuite);
        let sawCatchAllExcept = false;

        while (true) {
            const exceptToken = this._peekToken();
            if (!this._consumeTokenIfKeyword(KeywordType.Except)) {
                break;
            }

            let typeExpr: ExpressionNode | undefined;
            let symbolName: IdentifierToken | undefined;
            if (this._peekTokenType() !== TokenType.Colon) {
                typeExpr = this._parseTestExpression();

                if (this._consumeTokenIfKeyword(KeywordType.As)) {
                    symbolName = this._getTokenIfIdentifier();
                    if (!symbolName) {
                        this._addError('Expected symbol name after "as"', this._peekToken());
                    }
                }
            }

            if (!typeExpr) {
                if (sawCatchAllExcept) {
                    this._addError('Only one catch-all except clause is allowed', exceptToken);
                }
                sawCatchAllExcept = true;
            } else {
                if (sawCatchAllExcept) {
                    this._addError('A named except clause cannot appear after catch-all except clause',
                        typeExpr);
                }
            }

            const exceptSuite = this._parseSuite();
            const exceptNode = new ExceptNode(exceptToken, exceptSuite);
            exceptNode.typeExpression = typeExpr;
            if (symbolName) {
                exceptNode.name = new NameNode(symbolName);
            }

            tryNode.exceptClauses.push(exceptNode);
        }
        tryNode.extend(tryNode.exceptClauses);

        if (tryNode.exceptClauses.length > 0) {
            if (this._consumeTokenIfKeyword(KeywordType.Else)) {
                tryNode.elseSuite = this._parseSuite();
                tryNode.extend(tryNode.elseSuite);
            }
        }

        if (this._consumeTokenIfKeyword(KeywordType.Finally)) {
            tryNode.finallySuite = this._parseSuite();
            tryNode.extend(tryNode.finallySuite);
        }

        return tryNode;
    }

    // funcdef: 'def' NAME parameters ['->' test] ':' suite
    // parameters: '(' [typedargslist] ')'
    private _parseFunctionDef(asyncToken?: KeywordToken, decorators?: DecoratorNode[]): FunctionNode {
        const defToken = this._getKeywordToken(KeywordType.Def);

        let nameToken = this._getTokenIfIdentifier();
        if (!nameToken) {
            this._addError('Expected function name after "def"', defToken);
            nameToken = new IdentifierToken(0, 0, '', undefined);
        }

        if (!this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            this._addError('Expected "("', this._peekToken());
        }

        const paramList = this._parseVarArgsList(TokenType.CloseParenthesis, true);

        if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
            this._addError('Expected ")"', this._peekToken());
        }

        let returnType: ExpressionNode | undefined;
        if (this._consumeTokenIfType(TokenType.Arrow)) {
            this._parseTypeAnnotation(() => {
                returnType = this._parseTestExpression();
            });
        }

        const suite = this._parseSuite();

        const functionNode = new FunctionNode(defToken, new NameNode(nameToken), suite);
        if (asyncToken) {
            functionNode.isAsync = true;
            functionNode.extend(asyncToken);
        }
        functionNode.parameters = paramList;
        if (decorators) {
            functionNode.decorators = decorators;
            if (decorators.length > 0) {
                functionNode.extend(decorators[0]);
            }
        }
        if (returnType) {
            functionNode.returnTypeAnnotation = returnType;
            functionNode.extend(returnType);
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
        const paramMap = new StringMap<string>();
        const paramList: ParameterNode[] = [];
        let sawDefaultParam = false;
        let reportedNonDefaultParamErr = false;
        let sawKwSeparator = false;
        let sawVarArgs = false;
        let sawKwArgs = false;

        while (true) {
            if (this._peekTokenType() === terminator) {
                break;
            }

            const param = this._parseParameter(allowAnnotations);
            if (!param) {
                this._consumeTokensUntilType(terminator);
                break;
            }

            if (param.name) {
                const name = param.name.nameToken.value;
                if (!paramMap.set(name, name)) {
                    this._addError(`Duplicate parameter '${ name }'`, param.name);
                }
            }

            if (param.category === ParameterCategory.Simple) {
                if (param.defaultValue) {
                    sawDefaultParam = true;
                } else if (sawDefaultParam && !sawKwSeparator) {
                    // Report this error only once.
                    if (!reportedNonDefaultParamErr) {
                        this._addError(`Non-default argument follows default argument`, param);
                        reportedNonDefaultParamErr = true;
                    }
                }
            }

            paramList.push(param);

            if (param.category === ParameterCategory.VarArgList) {
                if (!param.name) {
                    if (sawKwSeparator) {
                        this._addError(`Only one '*' separator is allowed`, param);
                    }
                    sawKwSeparator = true;
                } else {
                    if (sawVarArgs) {
                        this._addError(`Only one '*' parameter is allowed`, param);
                    }
                    sawVarArgs = true;
                }
            }

            if (param.category === ParameterCategory.VarArgDictionary) {
                if (sawKwArgs) {
                    this._addError(`Only one '**' parameter is allowed`, param);
                }
                sawKwArgs = true;
            } else if (sawKwArgs) {
                this._addError(`Parameter cannot follow '**' parameter`, param);
            }

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        if (paramList.length > 0) {
            const lastParam = paramList[paramList.length - 1];
            if (!lastParam.name) {
                this._addError('Named argument must follow bar \'*\'', lastParam);
            }
        }

        return paramList;
    }

    private _parseParameter(allowAnnotations: boolean): ParameterNode {
        let starCount = 0;
        const firstToken = this._peekToken();

        if (this._consumeTokenIfOperator(OperatorType.Multiply)) {
            starCount = 1;
        } else if (this._consumeTokenIfOperator(OperatorType.Power)) {
            starCount = 2;
        }

        const paramName = this._getTokenIfIdentifier();
        if (!paramName) {
            if (starCount === 1) {
                const paramNode = new ParameterNode(firstToken, ParameterCategory.VarArgList);
                return paramNode;
            }
            this._addError('Expected parameter name', this._peekToken());
        }

        let paramType = ParameterCategory.Simple;
        if (starCount === 1) {
            paramType = ParameterCategory.VarArgList;
        } else if (starCount === 2) {
            paramType = ParameterCategory.VarArgDictionary;
        }
        const paramNode = new ParameterNode(firstToken, paramType);
        if (paramName) {
            paramNode.name = new NameNode(paramName);
        }
        paramNode.extend(paramName);

        if (allowAnnotations && this._consumeTokenIfType(TokenType.Colon)) {
            this._parseTypeAnnotation(() => {
                paramNode.typeAnnotation = this._parseTestExpression();
                paramNode.extend(paramNode.typeAnnotation);
            });
        }

        if (this._consumeTokenIfOperator(OperatorType.Assign)) {
            paramNode.defaultValue = this._parseTestExpression();
            paramNode.extend(paramNode.defaultValue);

            if (starCount > 0) {
                this._addError(`Parameter with '*' or '**' cannot have default value`,
                    paramNode.defaultValue);
            }
        }

        return paramNode;
    }

    // with_stmt: 'with' with_item (',' with_item)*  ':' suite
    private _parseWithStatement(asyncToken?: KeywordToken): WithNode {
        const withToken = this._getKeywordToken(KeywordType.With);
        const withItemList: WithItemNode[] = [];

        while (true) {
            withItemList.push(this._parseWithItem());

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        const withSuite = this._parseSuite();
        const withNode = new WithNode(withToken, withSuite);
        if (asyncToken) {
            withNode.isAsync = true;
            withNode.extend(asyncToken);
        }
        withNode.withItems = withItemList;
        return withNode;
    }

    // with_item: test ['as' expr]
    private _parseWithItem(): WithItemNode {
        const expr = this._parseTestExpression();
        const itemNode = new WithItemNode(expr);

        if (this._consumeTokenIfKeyword(KeywordType.As)) {
            itemNode.target = this._parseExpression(false);
            itemNode.extend(itemNode.target);
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
                    this._addError('Expected function definition after "async"', this._peekToken());
                    return undefined;
                }
                return this._parseFunctionDef(nextToken, decoratorList);
            } else if (nextToken.keywordType === KeywordType.Def) {
                return this._parseFunctionDef(undefined, decoratorList);
            } else if (nextToken.keywordType === KeywordType.Class) {
                return this._parseClassDef(decoratorList);
            }
        }

        this._addError('Expected function or class declaration after decorator', this._peekToken());
        return undefined;
    }

    // decorator: '@' dotted_name [ '(' [arglist] ')' ] NEWLINE
    private _parseDecorator(): DecoratorNode {
        const atOperator = this._getNextToken() as OperatorToken;
        assert.equal(atOperator.operatorType, OperatorType.MatrixMultiply);

        let callNameExpr: ExpressionNode | undefined;
        while (true) {
            const namePart = this._getTokenIfIdentifier();
            if (!namePart) {
                this._addError('Expected decorator name', this._peekToken());
                callNameExpr = new ErrorExpressionNode(
                    this._peekToken(),
                    ErrorExpressionCategory.MissingDecoratorCallName);
                break;
            }

            const namePartNode = new NameNode(namePart);

            if (!callNameExpr) {
                callNameExpr = namePartNode;
            } else {
                callNameExpr = new MemberAccessExpressionNode(callNameExpr, namePartNode);
            }

            if (!this._consumeTokenIfType(TokenType.Dot)) {
                break;
            }
        }

        const decoratorNode = new DecoratorNode(atOperator, callNameExpr);

        if (this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            decoratorNode.arguments = this._parseArgList();

            const nextToken = this._peekToken();
            if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                this._addError('Expected ")"', this._peekToken());
            } else {
                decoratorNode.extend(nextToken);
            }
        }

        if (!this._consumeTokenIfType(TokenType.NewLine)) {
            this._addError('Expected new line at end of decorator', this._peekToken());
            this._consumeTokensUntilType(TokenType.NewLine);
        }

        return decoratorNode;
    }

    // classdef: 'class' NAME ['(' [arglist] ')'] suite
    private _parseClassDef(decorators?: DecoratorNode[]): ClassNode {
        const classToken = this._getKeywordToken(KeywordType.Class);

        let nameToken = this._getTokenIfIdentifier();
        if (!nameToken) {
            this._addError('Expected class name', this._peekToken());
            nameToken = new IdentifierToken(0, 0, '', undefined);
        }

        let argList: ArgumentNode[] = [];
        if (this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            argList = this._parseArgList();

            if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                this._addError('Expected ")"', this._peekToken());
            }
        }

        const suite = this._parseSuite();

        const classNode = new ClassNode(classToken, new NameNode(nameToken), suite);
        classNode.arguments = argList;
        if (decorators) {
            classNode.decorators = decorators;
            if (decorators.length > 0) {
                classNode.extend(decorators[0]);
            }
        }

        return classNode;
    }

    private _parsePassStatement(): PassNode {
        return new PassNode(this._getKeywordToken(KeywordType.Pass));
    }

    private _parseBreakStatement(): BreakNode {
        const breakToken = this._getKeywordToken(KeywordType.Break);

        if (!this._isInLoop) {
            this._addError('"break" can be used only within a loop',
                breakToken);
        }

        return new BreakNode(breakToken);
    }

    private _parseContinueStatement(): ContinueNode {
        const continueToken = this._getKeywordToken(KeywordType.Continue);

        if (!this._isInLoop) {
            this._addError('"continue" can be used only within a loop',
                continueToken);
        } else if (this._isInFinally) {
            this._addError('"continue" cannot be used within a finally clause',
                continueToken);
        }

        return new ContinueNode(continueToken);
    }

    // return_stmt: 'return' [testlist]
    private _parseReturnStatement(): ReturnNode {
        const returnToken = this._getKeywordToken(KeywordType.Return);

        const returnNode = new ReturnNode(returnToken);

        if (!this._isNextTokenNeverExpression()) {
            const returnExpr = this._parseTestListAsExpression(
                ErrorExpressionCategory.MissingExpression,
                'Expected expression after "return"');
            returnNode.returnExpression = returnExpr;
            returnNode.extend(returnExpr);
        }

        return returnNode;
    }

    // import_from: ('from' (('.' | '...')* dotted_name | ('.' | '...')+)
    //             'import' ('*' | '(' import_as_names ')' | import_as_names))
    // import_as_names: import_as_name (',' import_as_name)* [',']
    // import_as_name: NAME ['as' NAME]
    private _parseFromStatement(): ImportFromNode {
        const fromToken = this._getKeywordToken(KeywordType.From);

        const modName = this._parseDottedModuleName(true);
        const importFromNode = new ImportFromNode(fromToken, modName);

        // Handle imports from __future__ specially because they can
        // change the way we interpret the rest of the file.
        const isFutureImport = modName.leadingDots === 0 &&
            modName.nameParts.length === 1 &&
            modName.nameParts[0].nameToken.value === '__future__';

        const possibleInputToken = this._peekToken();
        if (!this._consumeTokenIfKeyword(KeywordType.Import)) {
            this._addError('Expected "import"', this._peekToken());
        } else {
            importFromNode.extend(possibleInputToken);

            // Look for "*" token.
            const possibleStarToken = this._peekToken();
            if (this._consumeTokenIfOperator(OperatorType.Multiply)) {
                importFromNode.extend(possibleStarToken);
                importFromNode.isWildcardImport = true;
            } else {
                const inParen = this._consumeTokenIfType(TokenType.OpenParenthesis);

                while (true) {
                    const importName = this._getTokenIfIdentifier();
                    if (!importName) {
                        break;
                    }

                    const importFromAsNode = new ImportFromAsNode(new NameNode(importName));

                    if (this._consumeTokenIfKeyword(KeywordType.As)) {
                        const aliasName = this._getTokenIfIdentifier();
                        if (!aliasName) {
                            this._addError('Expected alias symbol name', this._peekToken());
                        } else {
                            importFromAsNode.alias = new NameNode(aliasName);
                            importFromAsNode.extend(aliasName);
                        }
                    }

                    importFromNode.imports.push(importFromAsNode);
                    importFromNode.extend(importFromAsNode);

                    if (isFutureImport) {
                        // Add the future import to the map.
                        this._futureImportMap.set(importName.value, true);
                    }

                    if (!this._consumeTokenIfType(TokenType.Comma)) {
                        break;
                    }
                }

                if (importFromNode.imports.length === 0) {
                    this._addError('Expected one or more symbol names after import', this._peekToken());
                }

                if (inParen) {
                    importFromNode.usesParens = true;

                    const nextToken = this._peekToken();
                    if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                        this._addError('Expected ")"', this._peekToken());
                    } else {
                        importFromNode.extend(nextToken);
                    }
                }
            }
        }

        return importFromNode;
    }

    // import_name: 'import' dotted_as_names
    // dotted_as_names: dotted_as_name (',' dotted_as_name)*
    // dotted_as_name: dotted_name ['as' NAME]
    private _parseImportStatement(): ImportNode {
        const importToken = this._getKeywordToken(KeywordType.Import);

        const importNode = new ImportNode(importToken);

        while (true) {
            const modName = this._parseDottedModuleName();
            const importAsNode = new ImportAsNode(modName);

            if (this._consumeTokenIfKeyword(KeywordType.As)) {
                const aliasToken = this._getTokenIfIdentifier();
                if (aliasToken) {
                    importAsNode.alias = new NameNode(aliasToken);
                    importAsNode.extend(importAsNode.alias);
                } else {
                    this._addError('Expected identifier after "as"', this._peekToken());
                }
            }

            importNode.list.push(importAsNode);

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        importNode.extend(importNode.list);

        return importNode;
    }

    // ('.' | '...')* dotted_name | ('.' | '...')+
    // dotted_name: NAME ('.' NAME)*
    private _parseDottedModuleName(allowJustDots = false): ModuleNameNode {
        const moduleNameNode = new ModuleNameNode(this._peekToken());

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
            const identifier = this._getTokenIfIdentifier([KeywordType.Import]);
            if (!identifier) {
                if (!allowJustDots || moduleNameNode.leadingDots === 0) {
                    this._addError('Expected module name', this._peekToken());
                    moduleNameNode.hasTrailingDot = true;
                }
                break;
            }

            moduleNameNode.nameParts.push(new NameNode(identifier));
            moduleNameNode.extend(identifier);

            const nextToken = this._peekToken();
            if (!this._consumeTokenIfType(TokenType.Dot)) {
                break;
            }

            // Extend the module name to include the dot.
            moduleNameNode.extend(nextToken);
        }

        return moduleNameNode;
    }

    private _parseGlobalStatement(): GlobalNode {
        const globalToken = this._getKeywordToken(KeywordType.Global);

        const globalNode = new GlobalNode(globalToken);
        globalNode.nameList = this._parseNameList();
        globalNode.extend(globalNode.nameList);
        return globalNode;
    }

    private _parseNonlocalStatement(): NonlocalNode {
        const nonlocalToken = this._getKeywordToken(KeywordType.Nonlocal);

        const nonlocalNode = new NonlocalNode(nonlocalToken);
        nonlocalNode.nameList = this._parseNameList();
        nonlocalNode.extend(nonlocalNode.nameList);
        return nonlocalNode;
    }

    private _parseNameList(): NameNode[] {
        const nameList: NameNode[] = [];

        while (true) {
            const name = this._getTokenIfIdentifier();
            if (!name) {
                this._addError('Expected identifier', this._peekToken());
                break;
            }

            nameList.push(new NameNode(name));

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

        const raiseNode = new RaiseNode(raiseToken);
        if (!this._isNextTokenNeverExpression()) {
            raiseNode.typeExpression = this._parseTestExpression();
            raiseNode.extend(raiseNode.typeExpression);

            if (this._consumeTokenIfKeyword(KeywordType.From)) {
                raiseNode.valueExpression = this._parseTestExpression();
                raiseNode.extend(raiseNode.valueExpression);
            } else {
                if (this._consumeTokenIfType(TokenType.Comma)) {
                    // Handle the Python 2.x variant
                    raiseNode.valueExpression = this._parseTestExpression();
                    raiseNode.extend(raiseNode.valueExpression);

                    if (this._consumeTokenIfType(TokenType.Comma)) {
                        raiseNode.tracebackExpression = this._parseTestExpression();
                        raiseNode.extend(raiseNode.tracebackExpression);
                    }
                }
            }
        }

        return raiseNode;
    }

    // assert_stmt: 'assert' test [',' test]
    private _parseAssertStatement(): AssertNode {
        const assertToken = this._getKeywordToken(KeywordType.Assert);

        const expr = this._parseTestExpression();
        const assertNode = new AssertNode(assertToken, expr);

        if (this._consumeTokenIfType(TokenType.Comma)) {
            const exceptionExpr = this._parseTestExpression();
            assertNode.exceptionExpression = exceptionExpr;
            assertNode.extend(exceptionExpr);
        }

        return assertNode;
    }

    // del_stmt: 'del' exprlist
    private _parseDelStatement(): DelNode {
        const delToken = this._getKeywordToken(KeywordType.Del);

        const exprListResult = this._parseExpressionList(true);
        if (!exprListResult.parseError && exprListResult.list.length === 0) {
            this._addError('Expected expression after "del"', this._peekToken());
        }
        const delNode = new DelNode(delToken);
        delNode.expressions = exprListResult.list;
        delNode.extend(delNode.expressions);
        return delNode;
    }

    // yield_expr: 'yield' [yield_arg]
    // yield_arg: 'from' test | testlist
    private _parseYieldExpression(): YieldExpressionNode | YieldFromExpressionNode {
        const yieldToken = this._getKeywordToken(KeywordType.Yield);

        const nextToken = this._peekToken();
        if (this._consumeTokenIfKeyword(KeywordType.From)) {
            if (this._getLanguageVersion() < PythonVersion.V33) {
                this._addError(
                    `Use of 'yield from' requires Python 3.3 or newer`,
                    nextToken);
            }
            return new YieldFromExpressionNode(yieldToken, this._parseTestExpression());
        }

        const exprListResult = this._parseTestExpressionList();
        const exprList = this._makeExpressionOrTuple(exprListResult);

        return new YieldExpressionNode(yieldToken, exprList);
    }

    private _tryParseYieldExpression(): YieldExpressionNode | YieldFromExpressionNode | undefined {
        if (this._peekKeywordType() !== KeywordType.Yield) {
            return undefined;
        }

        return this._parseYieldExpression();
    }

    // simple_stmt: small_stmt (';' small_stmt)* [';'] NEWLINE
    private _parseSimpleStatement(): StatementListNode {
        const statement = new StatementListNode(this._peekToken());

        while (true) {
            // Swallow invalid tokens to make sure we make forward progress.
            if (this._peekTokenType() === TokenType.Invalid) {
                const invalidToken = this._getNextToken();
                const text = this._fileContents!.substr(invalidToken.start, invalidToken.length);
                this._addError(`Invalid token: "${ text }"`, invalidToken);
                this._consumeTokensUntilType(TokenType.NewLine);
                break;
            }

            const smallStatement = this._parseSmallStatement();
            statement.statements.push(smallStatement);
            statement.extend(smallStatement);

            if (smallStatement instanceof ErrorExpressionNode) {
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
            this._addError('Statements must be separated by newlines or semicolons',
                this._peekToken());
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

    private _makeExpressionOrTuple(exprListResult: ExpressionListResult): ExpressionNode {
        if (exprListResult.list.length === 1 && !exprListResult.trailingComma) {
            return exprListResult.list[0];
        }

        // To accommodate empty tuples ("()"), we will reach back to get
        // the opening parenthesis as the opening token.

        const tupleStartRange: TextRange = exprListResult.list.length > 0 ?
            exprListResult.list[0] : this._peekToken(-1);

        const tupleNode = new TupleExpressionNode(tupleStartRange);
        tupleNode.expressions = exprListResult.list;
        tupleNode.extend(exprListResult.list);

        return tupleNode;
    }

    private _parseTestListAsExpression(errorCategory: ErrorExpressionCategory,
            errorString: string): ExpressionNode {

        if (this._isNextTokenNeverExpression()) {
            return this._handleExpressionParseError(errorCategory, errorString);
        }

        const exprListResult = this._parseTestExpressionList();
        if (exprListResult.parseError) {
            return exprListResult.parseError;
        }
        return this._makeExpressionOrTuple(exprListResult);
    }

    private _parseTestOrStarListAsExpression(): ExpressionNode {
        if (this._isNextTokenNeverExpression()) {
            return this._handleExpressionParseError(
                ErrorExpressionCategory.MissingExpression, 'Expected expression');
        }

        const exprListResult = this._parseTestOrStarExpressionList();
        if (exprListResult.parseError) {
            return exprListResult.parseError;
        }
        return this._makeExpressionOrTuple(exprListResult);
    }

    private _parseExpressionList(allowStar: boolean): ExpressionListResult {
        return this._parseExpressionListGeneric(() => this._parseExpression(allowStar));
    }

    // testlist: test (',' test)* [',']
    private _parseTestExpressionList(): ExpressionListResult {
        return this._parseExpressionListGeneric(() => this._parseTestExpression());
    }

    private _parseTestOrStarExpressionList(): ExpressionListResult {
        const exprListResult = this._parseExpressionListGeneric(() => this._parseTestOrStarExpression());

        if (!exprListResult.parseError) {
            // Make sure that we don't have more than one star expression in the list.
            let sawStar = false;
            for (const expr of exprListResult.list) {
                if (expr instanceof UnpackExpressionNode) {
                    if (sawStar) {
                        this._addError('Only one unpack operation allowed in list', expr);
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
            return new UnpackExpressionNode(startToken, this._parseExpression(false));
        }

        return this._parseBitwiseOrExpression();
    }

    // test_or_star: test | star_expr
    private _parseTestOrStarExpression(): ExpressionNode {
        if (this._peekOperatorType() === OperatorType.Multiply) {
            return this._parseExpression(true);
        }

        return this._parseTestExpression();
    }

    // test: or_test ['if' or_test 'else' test] | lambdef
    private _parseTestExpression(): ExpressionNode {
        if (this._peekKeywordType() === KeywordType.Lambda) {
            return this._parseLambdaExpression();
        }

        const ifExpr = this._parseOrTest();
        if (ifExpr instanceof ErrorExpressionNode) {
            return ifExpr;
        }

        if (!this._consumeTokenIfKeyword(KeywordType.If)) {
            return ifExpr;
        }

        const testExpr = this._parseOrTest();
        if (testExpr instanceof ErrorExpressionNode) {
            return testExpr;
        }

        if (!this._consumeTokenIfKeyword(KeywordType.Else)) {
            return this._handleExpressionParseError(
                ErrorExpressionCategory.MissingElse, 'Expected "else"');
        }

        const elseExpr = this._parseTestExpression();
        if (elseExpr instanceof ErrorExpressionNode) {
            return elseExpr;
        }

        return new TernaryExpressionNode(ifExpr, testExpr, elseExpr);
    }

    // or_test: and_test ('or' and_test)*
    private _parseOrTest(): ExpressionNode {
        let leftExpr = this._parseAndTest();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        while (this._consumeTokenIfKeyword(KeywordType.Or)) {
            const rightExpr = this._parseAndTest();
            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.Or);
        }

        return leftExpr;
    }

    // and_test: not_test ('and' not_test)*
    private _parseAndTest(): ExpressionNode {
        let leftExpr = this._parseNotTest();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        while (this._consumeTokenIfKeyword(KeywordType.And)) {
            const rightExpr = this._parseNotTest();
            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.And);
        }

        return leftExpr;
    }

    // not_test: 'not' not_test | comparison
    private _parseNotTest(): ExpressionNode {
        if (this._consumeTokenIfKeyword(KeywordType.Not)) {
            const notExpr = this._parseNotTest();
            return new UnaryExpressionNode(notExpr, OperatorType.Not);
        }

        return this._parseComparison();
    }

    // comparison: expr (comp_op expr)*
    // comp_op: '<'|'>'|'=='|'>='|'<='|'<>'|'!='|'in'|'not' 'in'|'is'|'is' 'not'
    private _parseComparison(): ExpressionNode {
        let leftExpr = this._parseBitwiseOrExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        while (true) {
            let comparisonOperator: OperatorType | undefined;

            if (Tokenizer.isOperatorComparison(this._peekOperatorType())) {
                comparisonOperator = this._peekOperatorType();
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
                if (tokenAfterNot.type === TokenType.Keyword &&
                        (tokenAfterNot as KeywordToken).keywordType === KeywordType.In) {
                    this._getNextToken();
                    this._getNextToken();
                    comparisonOperator = OperatorType.NotIn;
                }
            }

            if (comparisonOperator === undefined) {
                break;
            }

            const rightExpr = this._parseBitwiseOrExpression();
            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, comparisonOperator);
        }

        return leftExpr;
    }

    // expr: xor_expr ('|' xor_expr)*
    private _parseBitwiseOrExpression(): ExpressionNode {
        let leftExpr = this._parseBitwiseXorExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        while (this._consumeTokenIfOperator(OperatorType.BitwiseOr)) {
            const rightExpr = this._parseBitwiseXorExpression();
            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.BitwiseOr);
        }

        return leftExpr;
    }

    // xor_expr: and_expr ('^' and_expr)*
    private _parseBitwiseXorExpression(): ExpressionNode {
        let leftExpr = this._parseBitwiseAndExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        while (this._consumeTokenIfOperator(OperatorType.BitwiseXor)) {
            const rightExpr = this._parseBitwiseAndExpression();
            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.BitwiseXor);
        }

        return leftExpr;
    }

    // and_expr: shift_expr ('&' shift_expr)*
    private _parseBitwiseAndExpression(): ExpressionNode {
        let leftExpr = this._parseShiftExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        while (this._consumeTokenIfOperator(OperatorType.BitwiseAnd)) {
            const rightExpr = this._parseShiftExpression();
            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.BitwiseAnd);
        }

        return leftExpr;
    }

    // shift_expr: arith_expr (('<<'|'>>') arith_expr)*
    private _parseShiftExpression(): ExpressionNode {
        let leftExpr = this._parseAirthmeticExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        let nextOperator = this._peekOperatorType();
        while (nextOperator === OperatorType.LeftShift || nextOperator === OperatorType.RightShift) {
            this._getNextToken();
            const rightExpr = this._parseAirthmeticExpression();
            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, nextOperator);
            nextOperator = this._peekOperatorType();
        }

        return leftExpr;
    }

    // arith_expr: term (('+'|'-') term)*
    private _parseAirthmeticExpression(): ExpressionNode {
        let leftExpr = this._parseAirthmeticTerm();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        let nextOperator = this._peekOperatorType();
        while (nextOperator === OperatorType.Add || nextOperator === OperatorType.Subtract) {
            this._getNextToken();
            const rightExpr = this._parseAirthmeticTerm();
            if (rightExpr instanceof ErrorExpressionNode) {
                return rightExpr;
            }

            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, nextOperator);
            nextOperator = this._peekOperatorType();
        }

        return leftExpr;
    }

    // term: factor (('*'|'@'|'/'|'%'|'//') factor)*
    private _parseAirthmeticTerm(): ExpressionNode {
        let leftExpr = this._parseAirthmeticFactor();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        let nextOperator = this._peekOperatorType();
        while (nextOperator === OperatorType.Multiply ||
                nextOperator === OperatorType.MatrixMultiply ||
                nextOperator === OperatorType.Divide ||
                nextOperator === OperatorType.Mod ||
                nextOperator === OperatorType.FloorDivide) {
            this._getNextToken();
            const rightExpr = this._parseAirthmeticFactor();
            leftExpr = new BinaryExpressionNode(leftExpr, rightExpr, nextOperator);
            nextOperator = this._peekOperatorType();
        }

        return leftExpr;
    }

    // factor: ('+'|'-'|'~') factor | power
    // power: atom_expr ['**' factor]
    private _parseAirthmeticFactor(): ExpressionNode {
        const nextOperator = this._peekOperatorType();
        if (nextOperator === OperatorType.Add ||
                nextOperator === OperatorType.Subtract ||
                nextOperator === OperatorType.BitwiseInvert) {
            this._getNextToken();
            const expression = this._parseAirthmeticFactor();
            return new UnaryExpressionNode(expression, nextOperator);
        }

        const leftExpr = this._parseAtomExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        if (this._consumeTokenIfOperator(OperatorType.Power)) {
            const rightExpr = this._parseAirthmeticFactor();
            return new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.Power);
        }

        return leftExpr;
    }

    // atom_expr: ['await'] atom trailer*
    // trailer: '(' [arglist] ')' | '[' subscriptlist ']' | '.' NAME
    private _parseAtomExpression(): ExpressionNode {
        let awaitToken: KeywordToken | undefined;
        if (this._peekKeywordType() === KeywordType.Await) {
            awaitToken = this._getKeywordToken(KeywordType.Await);
            if (this._getLanguageVersion() < PythonVersion.V35) {
                this._addError(
                    `Use of 'await' requires Python 3.5 or newer`,
                    awaitToken);
            }
        }

        let atomExpression = this._parseAtom();
        if (atomExpression instanceof ErrorExpressionNode) {
            return atomExpression;
        }

        // Consume trailers.
        while (true) {
            const nextToken = this._peekToken();

            // Is it a function call?
            if (this._consumeTokenIfType(TokenType.OpenParenthesis)) {
                const argList = this._parseArgList();
                const callNode = new CallExpressionNode(atomExpression);
                callNode.arguments = argList;
                callNode.extend(argList);

                const nextToken = this._peekToken();
                if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                    this._addError('Expected ")"', this._peekToken());

                    // Consume the remainder of tokens on the line for error
                    // recovery.
                    this._consumeTokensUntilType(TokenType.NewLine);

                    // Extend the node's range to include the rest of the line.
                    // This helps the signatureHelpProvider.
                    callNode.extend(this._peekToken());
                    return callNode;
                } else {
                    callNode.extend(nextToken);
                }

                atomExpression = callNode;
            } else if (this._consumeTokenIfType(TokenType.OpenBracket)) {
                // Is it an index operator?
                const indexExpr = this._parseSubscriptList();
                let expressions = [indexExpr];
                if (indexExpr instanceof TupleExpressionNode) {
                    expressions = indexExpr.expressions;
                }

                const closingToken = this._peekToken();
                const indexItemsNode = new IndexItemsNode(nextToken, closingToken, expressions);
                const indexNode = new IndexExpressionNode(atomExpression, indexItemsNode);
                indexNode.extend(indexNode);

                if (!this._consumeTokenIfType(TokenType.CloseBracket)) {
                    return this._handleExpressionParseError(
                        ErrorExpressionCategory.MissingIndexCloseBracket,
                        'Expected "]"', indexNode);
                }

                atomExpression = indexNode;
            } else if (this._consumeTokenIfType(TokenType.Dot)) {
                // Is it a member access?
                const memberName = this._getTokenIfIdentifier();
                if (!memberName) {
                    return this._handleExpressionParseError(
                        ErrorExpressionCategory.MissingMemberAccessName,
                        'Expected member name after "."', atomExpression);
                }
                atomExpression = new MemberAccessExpressionNode(
                        atomExpression, new NameNode(memberName));
            } else {
                break;
            }
        }

        if (awaitToken) {
            return new AwaitExpressionNode(awaitToken, atomExpression);
        }

        return atomExpression;
    }

    // subscriptlist: subscript (',' subscript)* [',']
    private _parseSubscriptList(): ExpressionNode {
        const listResult = this._parseExpressionListGeneric(() => this._parseSubscript(), () => {
            // Override the normal terminal check to exclude colons,
            // which are a valid way to start subscription expressions.
            if (this._peekTokenType() === TokenType.Colon) {
                return false;
            }
            return this._isNextTokenNeverExpression();
        });

        if (listResult.parseError) {
            return listResult.parseError;
        }

        if (listResult.list.length === 0) {
            return this._handleExpressionParseError(
                ErrorExpressionCategory.MissingExpression,
                'Expected index or slice expression');
        }

        return this._makeExpressionOrTuple(listResult);
    }

    // subscript: test | [test] ':' [test] [sliceop]
    // sliceop: ':' [test]
    private _parseSubscript(): ExpressionNode {
        const firstToken = this._peekToken();
        const sliceExpressions: (ExpressionNode | undefined)[] = [undefined, undefined, undefined];
        let sliceIndex = 0;
        let sawColon = false;

        while (true) {
            const nextTokenType = this._peekTokenType();
            if (nextTokenType === TokenType.CloseBracket ||
                    nextTokenType === TokenType.Comma) {
                break;
            }

            if (nextTokenType !== TokenType.Colon) {
                sliceExpressions[sliceIndex] = this._parseTestExpression();
            }
            sliceIndex++;

            if (sliceIndex >= 3 || !this._consumeTokenIfType(TokenType.Colon)) {
                break;
            }
            sawColon = true;
        }

        // If this was a simple expression with no colons return it.
        if (!sawColon) {
            return sliceExpressions[0]!;
        }

        const sliceNode = new SliceExpressionNode(firstToken);
        sliceNode.startValue = sliceExpressions[0];
        sliceNode.endValue = sliceExpressions[1];
        sliceNode.stepValue = sliceExpressions[2];
        sliceNode.extend(sliceExpressions[2] || sliceExpressions[1] || sliceExpressions[0]);

        return sliceNode;
    }

    // arglist: argument (',' argument)*  [',']
    private _parseArgList(): ArgumentNode[] {
        const argList: ArgumentNode[] = [];
        let sawKeywordArg = false;

        while (true) {
            const nextTokenType = this._peekTokenType();
            if (nextTokenType === TokenType.CloseParenthesis ||
                    nextTokenType === TokenType.NewLine ||
                    nextTokenType === TokenType.EndOfStream) {
                break;
            }

            const arg = this._parseArgument();
            if (arg.name) {
                sawKeywordArg = true;
            } else if (sawKeywordArg && arg.argumentCategory === ArgumentCategory.Simple) {
                this._addError(
                    'Positional argument cannot appear after named arguments',
                    arg);
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

        let valueExpr = this._parseTestExpression();
        let nameIdentifier: IdentifierToken | undefined;

        if (argType === ArgumentCategory.Simple) {
            if (this._consumeTokenIfOperator(OperatorType.Assign)) {
                const nameExpr = valueExpr;
                valueExpr = this._parseTestExpression();

                if (nameExpr instanceof NameNode) {
                    nameIdentifier = nameExpr.nameToken;
                } else {
                    this._addError('Expected parameter name', nameExpr);
                }
            } else {
                const listComp = this._tryParseListComprehension(valueExpr);
                if (listComp) {
                    valueExpr = listComp;
                }
            }
        }

        const argNode = new ArgumentNode(firstToken, valueExpr, argType);
        if (nameIdentifier) {
            argNode.name = new NameNode(nameIdentifier);
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
            return new EllipsisNode(this._getNextToken());
        }

        if (nextToken.type === TokenType.Number) {
            return new NumberNode(this._getNextToken() as NumberToken);
        }

        if (nextToken.type === TokenType.Identifier) {
            return new NameNode(this._getNextToken() as IdentifierToken);
        }

        if (nextToken.type === TokenType.String) {
            return this._parseStringList();
        }

        if (nextToken.type === TokenType.OpenParenthesis) {
            return this._parseTupleAtom();
        } else if (nextToken.type === TokenType.OpenBracket) {
            return this._parseListAtom();
        } else if (nextToken.type === TokenType.OpenCurlyBrace) {
            return this._parseDictionaryOrSetAtom();
        }

        if (nextToken.type === TokenType.Keyword) {
            const keywordToken = nextToken as KeywordToken;
            if (keywordToken.keywordType === KeywordType.False ||
                    keywordToken.keywordType === KeywordType.True ||
                    keywordToken.keywordType === KeywordType.Debug ||
                    keywordToken.keywordType === KeywordType.None) {
                return new ConstantNode(this._getNextToken() as KeywordToken);
            }

            // Make an identifier out of the keyword.
            const keywordAsIdentifier = this._getTokenIfIdentifier();
            if (keywordAsIdentifier) {
                return new NameNode(keywordAsIdentifier);
            }
        }

        return this._handleExpressionParseError(
            ErrorExpressionCategory.MissingExpression,
            'Expected expression');
    }

    // Allocates a dummy "error expression" and consumes the remainder
    // of the tokens on the line for error recovery. A partially-completed
    // child node can be passed to help the completion provider determine
    // what to do.
    private _handleExpressionParseError(category: ErrorExpressionCategory,
            errorMsg: string, childNode?: ParseNode): ErrorExpressionNode {

        this._addError(errorMsg, this._peekToken());
        const expr = new ErrorExpressionNode(this._peekToken(), category, childNode);
        this._consumeTokensUntilType(TokenType.NewLine);
        return expr;
    }

    // lambdef: 'lambda' [varargslist] ':' test
    private _parseLambdaExpression(allowConditional = true): LambdaNode {
        const labmdaToken = this._getKeywordToken(KeywordType.Lambda);

        const argList = this._parseVarArgsList(TokenType.Colon, false);

        if (!this._consumeTokenIfType(TokenType.Colon)) {
            this._addError('Expected ":"', this._peekToken());
        }

        let testExpr: ExpressionNode;
        if (allowConditional) {
            testExpr = this._parseTestExpression();
        } else {
            testExpr = this._tryParseLambdaExpression(false) || this._parseOrTest();
        }

        const lambdaNode = new LambdaNode(labmdaToken, testExpr);
        lambdaNode.parameters = argList;
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
        assert.equal(startParen.type, TokenType.OpenParenthesis);

        const yieldExpr = this._tryParseYieldExpression();
        if (yieldExpr) {
            if (this._peekTokenType() !== TokenType.CloseParenthesis) {
                return this._handleExpressionParseError(
                    ErrorExpressionCategory.MissingTupleCloseParen,
                    'Expected ")"');
            } else {
                yieldExpr.extend(this._getNextToken());
            }

            return yieldExpr;
        }

        const exprListResult = this._parseTestListWithComprehension();
        const tupleOrExpression = this._makeExpressionOrTuple(exprListResult);

        if (this._peekTokenType() !== TokenType.CloseParenthesis) {
            return this._handleExpressionParseError(
                ErrorExpressionCategory.MissingTupleCloseParen,
                'Expected ")"');
        } else {
            tupleOrExpression.extend(this._getNextToken());
        }

        return tupleOrExpression;
    }

    // '[' [testlist_comp] ']'
    // testlist_comp: (test | star_expr) (comp_for | (',' (test | star_expr))* [','])
    private _parseListAtom(): ListNode | ErrorExpressionNode {
        const startBracket = this._getNextToken();
        assert.equal(startBracket.type, TokenType.OpenBracket);

        const exprListResult = this._parseTestListWithComprehension();
        const closeBracket: Token | undefined = this._peekToken();
        if (!this._consumeTokenIfType(TokenType.CloseBracket)) {
            return this._handleExpressionParseError(
                ErrorExpressionCategory.MissingListCloseBracket,
                'Expected "]"');
        }

        const listAtom = new ListNode(startBracket);
        listAtom.extend(closeBracket);
        listAtom.extend(exprListResult.list);
        listAtom.entries = exprListResult.list;
        return listAtom;
    }

    private _parseTestListWithComprehension(): ExpressionListResult {
        let sawComprehension = false;

        return this._parseExpressionListGeneric(() => {
            let expr = this._parseTestOrStarExpression();
            const listComp = this._tryParseListComprehension(expr);
            if (listComp) {
                expr = listComp;
                sawComprehension = true;
            }
            return expr;
        },
        () => this._isNextTokenNeverExpression(),
        () => sawComprehension);
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
        assert.equal(startBrace.type, TokenType.OpenCurlyBrace);

        const dictionaryEntries: DictionaryEntryNode[] = [];
        const setEntries: ExpressionNode[] = [];
        let isDictionary = false;
        let isSet = false;
        let sawListComprehension = false;

        while (true) {
            if (this._peekTokenType() === TokenType.CloseCurlyBrace) {
                break;
            }

            let doubleStarExpression: ExpressionNode | undefined;
            let keyExpression: ExpressionNode | undefined;
            let valueExpression: ExpressionNode | undefined;

            if (this._consumeTokenIfOperator(OperatorType.Power)) {
                doubleStarExpression = this._parseExpression(false);
            } else {
                keyExpression = this._parseTestOrStarExpression();

                if (this._consumeTokenIfType(TokenType.Colon)) {
                    valueExpression = this._parseTestExpression();
                }
            }

            if (keyExpression && valueExpression) {
                if (keyExpression instanceof UnpackExpressionNode) {
                    this._addError('Unpack operation not allowed in dictionaries', keyExpression);
                }

                if (isSet) {
                    this._addError('Key/value pairs are not allowed within a set', valueExpression);
                } else {
                    const keyEntryNode = new DictionaryKeyEntryNode(keyExpression, valueExpression);
                    let dictEntry: DictionaryEntryNode = keyEntryNode;
                    const listComp = this._tryParseListComprehension(keyEntryNode);
                    if (listComp) {
                        dictEntry = listComp;
                        sawListComprehension = true;
                    }
                    dictionaryEntries.push(dictEntry);
                    isDictionary = true;
                }
            } else if (doubleStarExpression) {
                if (isSet) {
                    this._addError('Unpack operator not allowed within a set', doubleStarExpression);
                } else {
                    const listEntryNode = new DictionaryExpandEntryNode(doubleStarExpression);
                    let expandEntryNode: DictionaryEntryNode = listEntryNode;
                    const listComp = this._tryParseListComprehension(listEntryNode);
                    if (listComp) {
                        expandEntryNode = listComp;
                        sawListComprehension = true;
                    }
                    dictionaryEntries.push(expandEntryNode);
                    isDictionary = true;
                }
            } else {
                assert(keyExpression !== undefined);
                if (keyExpression) {
                    if (isDictionary) {
                        this._addError('Dictionary entries must contain key/value pairs', keyExpression);
                    } else {
                        const listComp = this._tryParseListComprehension(keyExpression);
                        if (listComp) {
                            keyExpression = listComp;
                            sawListComprehension = true;
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
        }

        let closeCurlyBrace: Token | undefined = this._peekToken();
        if (!this._consumeTokenIfType(TokenType.CloseCurlyBrace)) {
            this._addError('Expected "}"', this._peekToken());
            closeCurlyBrace = undefined;
        }

        if (isSet) {
            const setAtom = new SetNode(startBrace);
            setAtom.extend(closeCurlyBrace);
            setAtom.extend(setEntries);
            setAtom.entries = setEntries;
            return setAtom;
        }

        const dictionaryAtom = new DictionaryNode(startBrace);
        dictionaryAtom.extend(closeCurlyBrace);
        dictionaryAtom.extend(dictionaryEntries);
        dictionaryAtom.entries = dictionaryEntries;
        return dictionaryAtom;
    }

    private _parseExpressionListGeneric(parser: () => ExpressionNode,
            teminalCheck: () => boolean = () => this._isNextTokenNeverExpression(),
            finalEntryCheck: () => boolean = () => false):
                ExpressionListResult {
        let trailingComma = false;
        const list: ExpressionNode[] = [];
        let parseError: ErrorExpressionNode | undefined;

        while (true) {
            if (teminalCheck()) {
                break;
            }

            const expr = parser();
            if (expr instanceof ErrorExpressionNode) {
                parseError = expr;
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
    // annassign: ':' test ['=' test]
    // augassign: ('+=' | '-=' | '*=' | '@=' | '/=' | '%=' | '&=' | '|=' | '^=' |
    //             '<<=' | '>>=' | '**=' | '//=')
    private _parseExpressionStatement(): ExpressionNode {
        let leftExpr = this._parseTestOrStarListAsExpression();
        let annotationExpr: ExpressionNode | undefined;

        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        // Is this a type annotation assignment?
        if (this._consumeTokenIfType(TokenType.Colon)) {
            this._parseTypeAnnotation(() => {
                annotationExpr = this._parseTestExpression();
                leftExpr = new TypeAnnotationExpressionNode(leftExpr, annotationExpr);

                if (!this._parseOptions.isStubFile && this._getLanguageVersion() < PythonVersion.V36) {
                    this._addError('Type annotations for variables requires Python 3.6 or newer',
                        annotationExpr);
                }
            });

            if (!this._consumeTokenIfOperator(OperatorType.Assign)) {
                return leftExpr;
            }

            const rightExpr = this._parseTestExpression();
            return new AssignmentNode(leftExpr, rightExpr);
        }

        // Is this a simple assignment?
        if (this._consumeTokenIfOperator(OperatorType.Assign)) {
            return this._parseChainAssignments(leftExpr);
        }

        if (!annotationExpr && Tokenizer.isOperatorAssignment(this._peekOperatorType())) {
            const operatorToken = this._getNextToken() as OperatorToken;

            const rightExpr = this._tryParseYieldExpression() ||
                this._parseTestListAsExpression(
                    ErrorExpressionCategory.MissingExpression,
                    'Expected expression to the right of operator');
            return new AugmentedAssignmentExpressionNode(leftExpr, rightExpr, operatorToken.operatorType);
        }

        return leftExpr;
    }

    private _parseChainAssignments(leftExpr: ExpressionNode): ExpressionNode {
        let rightExpr: ExpressionNode | undefined;
        rightExpr = this._tryParseYieldExpression();
        if (!rightExpr) {
            rightExpr = this._parseTestListAsExpression(
                ErrorExpressionCategory.MissingExpression,
                'Expected expression to the right of "="');
        }

        if (rightExpr instanceof ErrorExpressionNode) {
            return rightExpr;
        }

        // Recurse until we've consumed the entire chain.
        if (this._consumeTokenIfOperator(OperatorType.Assign)) {
            rightExpr = this._parseChainAssignments(rightExpr);
            if (rightExpr instanceof ErrorExpressionNode) {
                return rightExpr;
            }
        }

        const assignmentNode = new AssignmentNode(leftExpr, rightExpr);

        // Look for a type annotation comment at the end of the line.
        const typeAnnotationComment = this._getTypeAnnotationComment();
        if (typeAnnotationComment) {
            assignmentNode.typeAnnotationComment = typeAnnotationComment;
            assignmentNode.extend(assignmentNode.typeAnnotationComment);
        }

        return assignmentNode;
    }

    private _parseTypeAnnotation(callback: () => void) {
        // Temporary set a flag that indicates we're parsing a type annotation.
        const wasParsingTypeAnnotation = this._isParsingTypeAnnotation;
        this._isParsingTypeAnnotation = true;

        callback();

        this._isParsingTypeAnnotation = wasParsingTypeAnnotation;
    }

    private _reportStringTokenErrors(stringToken: StringToken, unescapedResult: UnescapedString) {
        if (stringToken.flags & StringTokenFlags.Unterminated) {
            this._addError('String literal is unterminated', stringToken);
        }

        if (unescapedResult.nonAsciiInBytes) {
            this._addError('Non-ASCII character not allowed in bytes string literal', stringToken);
        }

        if (stringToken.flags & StringTokenFlags.Format) {
            if (this._getLanguageVersion() < PythonVersion.V36) {
                this._addError('Format string literals (f-strings) require Python 3.6 or newer', stringToken);
            }

            if (stringToken.flags & StringTokenFlags.Bytes) {
                this._addError('Format string literals (f-strings) cannot be binary', stringToken);
            }

            if (stringToken.flags & StringTokenFlags.Unicode) {
                this._addError('Format string literals (f-strings) cannot be unicode', stringToken);
            }
        }
    }

    private _makeStringNode(stringToken: StringToken): StringNode {
        const unescapedResult = StringTokenUtils.getUnescapedString(stringToken);
        this._reportStringTokenErrors(stringToken, unescapedResult);
        return new StringNode(stringToken, unescapedResult.value, unescapedResult.unescapeErrors.length > 0);
    }

    private _getTypeAnnotationComment(): ExpressionNode | undefined {
        if (this._tokenIndex === 0) {
            return undefined;
        }

        const curToken = this._tokenizerOutput!.tokens.getItemAt(this._tokenIndex - 1);
        const nextToken = this._tokenizerOutput!.tokens.getItemAt(this._tokenIndex);

        if (curToken.end === nextToken.start) {
            return undefined;
        }

        const interTokenContents = this._fileContents!.substring(curToken.end, nextToken.start);
        const commentRegEx = /^(\s*#\s*type:\s*)([^\r\n]*)/;
        const match = interTokenContents.match(commentRegEx);
        if (!match) {
            return undefined;
        }

        // Synthesize a string token and StringNode.
        const typeString = match[2];
        const tokenOffset = curToken.end + match[1].length;
        const stringToken = new StringToken(tokenOffset,
            typeString.length, StringTokenFlags.None, typeString, 0, undefined);
        const stringNode = this._makeStringNode(stringToken);
        const stringListNode = new StringListNode([stringNode]);

        const parser = new Parser();
        const parseResults = parser.parseTextExpression(this._fileContents!,
            tokenOffset, typeString.length, this._parseOptions);

        parseResults.diagnostics.forEach(diag => {
            this._addError(diag.message, stringListNode);
        });

        if (!parseResults.parseTree) {
            return undefined;
        }

        stringListNode.typeAnnotation = parseResults.parseTree;

        return stringListNode;
    }

    private _parseFormatString(stringToken: StringToken): FormatStringNode {
        const unescapedResult = StringTokenUtils.getUnescapedString(stringToken);
        this._reportStringTokenErrors(stringToken, unescapedResult);

        const formatExpressions: FormatStringExpression[] = [];

        for (const segment of unescapedResult.formatStringSegments) {
            if (segment.isExpression) {
                const parser = new Parser();

                // Determine if we need to truncate the expression because it
                // contains formatting directives that start with a ! or :.
                const segmentExprLength = this._getFormatStringExpressionLength(segment.value);

                const parseResults = parser.parseTextExpression(this._fileContents!,
                    stringToken.start + stringToken.prefixLength + stringToken.quoteMarkLength +
                    segment.offset, segmentExprLength, this._parseOptions);

                parseResults.diagnostics.forEach(diag => {
                    const textRangeStart = (diag.range ?
                        convertPositionToOffset(diag.range.start, this._tokenizerOutput!.lines) :
                        stringToken.start) || stringToken.start;
                    const textRangeEnd = (diag.range ?
                        convertPositionToOffset(diag.range.end, this._tokenizerOutput!.lines) :
                        stringToken.end) || stringToken.end;
                    const textRange = new TextRange(textRangeStart, textRangeEnd - textRangeStart);
                    this._addError(diag.message, textRange);
                });

                if (parseResults.parseTree) {
                    formatExpressions.push({
                        expression: parseResults.parseTree
                    });
                }
            }
        }

        return new FormatStringNode(stringToken, unescapedResult.value,
            unescapedResult.unescapeErrors.length > 0, formatExpressions);
    }

    private _getFormatStringExpressionLength(segmentValue: string): number {
        let segmentExprLength = 0;

        // PEP 498 says: Expressions cannot contain ':' or '!' outside of
        // strings or parentheses, brackets, or braces. The exception is
        // that the '!=' operator is allowed as a special case.
        let inSingleQuote = false;
        let inDoubleQuote = false;
        let braceCount = 0;
        let parenCount = 0;
        let bracketCount = 0;

        while (segmentExprLength < segmentValue.length) {
            const curChar = segmentValue[segmentExprLength];
            const ignoreSeparator = inSingleQuote || inDoubleQuote || braceCount > 0 ||
                parenCount > 0 || bracketCount > 0;
            const inString = inSingleQuote || inDoubleQuote;

            if (curChar === ':') {
                if (!ignoreSeparator) {
                    break;
                }
            } else if (curChar === '!') {
                if (!ignoreSeparator) {
                    if (segmentExprLength === segmentValue.length - 1 ||
                            segmentValue[segmentExprLength + 1] !== '!') {
                        break;
                    }
                }
            } else if (curChar === '\'') {
                if (!inDoubleQuote) {
                    inSingleQuote = !inSingleQuote;
                }
            } else if (curChar === '"') {
                if (!inSingleQuote) {
                    inDoubleQuote = !inDoubleQuote;
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

            segmentExprLength++;
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

        const stringNode = new StringListNode(stringList);

        // If we're parsing a type annotation, parse the contents of the string.
        if (this._isParsingTypeAnnotation) {
            // Don't allow multiple strings because we have no way of reporting
            // parse errors that span strings.
            if (stringNode.strings.length > 1) {
                this._addError('Type hints cannot span multiple string literals', stringNode);
            } else if (stringNode.strings[0].token.flags & StringTokenFlags.Triplicate) {
                this._addError('Type hints cannot use triple quotes', stringNode);
            } else if (stringNode.strings[0].token.flags & StringTokenFlags.Format) {
                this._addError('Type hints cannot use format string literals (f-strings)', stringNode);
            } else {
                const stringToken = stringNode.strings[0].token;
                const stringValue = StringTokenUtils.getUnescapedString(stringNode.strings[0].token);
                const unescapedString = stringValue.value;
                const tokenOffset = stringToken.start;
                const prefixLength = stringToken.prefixLength + stringToken.quoteMarkLength;

                // Don't allow escape characters because we have no way of mapping
                // error ranges back to the escaped text.
                if (unescapedString.length !== stringToken.length - prefixLength - stringToken.quoteMarkLength) {
                    this._addError('Type hints cannot contain escape characters', stringNode);
                } else {
                    const parser = new Parser();
                    const parseResults = parser.parseTextExpression(this._fileContents!,
                        tokenOffset + prefixLength, unescapedString.length, this._parseOptions);

                    parseResults.diagnostics.forEach(diag => {
                        this._addError(diag.message, stringNode);
                    });

                    if (parseResults.parseTree) {
                        stringNode.typeAnnotation = parseResults.parseTree;
                    }
                }
            }
        }

        return stringNode;
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

    private _checkCancel() {
        if (this._cancelToken) {
            this._cancelToken.throwIfCanceled();
        }
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
            this._tokenizerOutput!.tokens.getItemAt(0);
        }

        if (this._tokenIndex + count >= this._tokenizerOutput!.tokens.count) {
            return this._tokenizerOutput!.tokens.getItemAt(
                this._tokenizerOutput!.tokens.count - 1);
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

    private _getTokenIfIdentifier(disallowedKeywords: KeywordType[] = []): IdentifierToken | undefined {
        const nextToken = this._peekToken();
        if (nextToken.type === TokenType.Identifier) {
            return this._getNextToken() as IdentifierToken;
        }

        // If keywords are allowed in this context, convert the keyword
        // to an identifier token.
        if (nextToken.type === TokenType.Keyword) {
            const keywordType = this._peekKeywordType();
            if (!disallowedKeywords.find(type => type === keywordType)) {
                const keywordText = this._fileContents!.substring(nextToken.start, nextToken.end);
                this._getNextToken();
                return new IdentifierToken(nextToken.start,
                    nextToken.end - nextToken.start, keywordText, nextToken.comments);
            }
        }

        return undefined;
    }

    // Consumes tokens until the next one in the stream is
    // either a specified terminator or the end-of-stream
    // token.
    private _consumeTokensUntilType(terminator: TokenType): boolean {
        while (true) {
            const token = this._peekToken();
            if (token.type === terminator) {
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
        assert.equal(keywordToken.keywordType, keywordType);
        return keywordToken;
    }

    private _getLanguageVersion() {
        return this._parseOptions.pythonVersion;
    }

    private _addError(message: string, range: TextRange) {
        assert(range !== undefined);
        this._diagSink.addError(message,
            convertOffsetsToRange(range.start, range.end, this._tokenizerOutput!.lines));
    }
}
