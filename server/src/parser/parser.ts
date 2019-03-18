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
import { convertOffsetsToRange } from '../common/positionUtils';
import { LatestStablePythonVersion, PythonVersion } from '../common/pythonVersion';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { timingStats } from '../common/timing';
import { ArgumentCategory, ArgumentNode, AssertNode,
    AssignmentNode, AugmentedAssignemtnExpressionNode, AwaitExpressionNode,
    BinaryExpressionNode, BreakNode, CallExpressionNode, ClassNode,
    ConditionalExpressionNode, ConstantNode, ContinueNode, DecoratorNode,
    DelNode, DictionaryEntryNode, DictionaryExpandEntryNode,
    DictionaryKeyEntryNode, DictionaryNode, EllipsisNode, ErrorExpressionNode,
    ExceptNode, ExpressionNode, ForNode, FunctionNode, GlobalNode, IfNode,
    ImportAsNode, ImportFromAsNode, ImportFromNode, ImportNode,
    IndexExpressionNode, LambdaNode, ListComprehensionForNode,
    ListComprehensionIfNode, ListComprehensionIterNode, ListComprehensionNode,
    ListNode, MemberAccessExpressionNode, ModuleNameNode, ModuleNode, NameNode, NonlocalNode,
    NumberNode, ParameterCategory, ParameterNode, ParseNode, PassNode,
    RaiseNode, ReturnNode, SetNode, SliceExpressionNode, StarExpressionNode,
    StatementListNode, StatementNode, StringNode, SuiteNode, TryNode,
    TupleExpressionNode, TypeAnnotationExpression, TypeAnnotationExpressionNode, UnaryExpressionNode,
    WhileNode, WithItemNode, WithNode, YieldExpressionNode, YieldFromExpressionNode } from './parseNodes';
import { Tokenizer, TokenizerOutput } from './tokenizer';
import { DedentToken, IdentifierToken, KeywordToken, KeywordType,
    NumberToken, OperatorToken, OperatorType, QuoteTypeFlags, StringToken, Token, TokenType } from './tokenizerTypes';

interface ExpressionListResult {
    list: ExpressionNode[];
    trailingComma: boolean;
    parseError?: ErrorExpressionNode;
}

export class ParseOptions {
    constructor() {
        this.isStubFile = false;
        this.pythonVersion = LatestStablePythonVersion;
    }

    isStubFile: boolean;
    pythonVersion: PythonVersion;
}

export interface ParseResults {
    parseTree: ModuleNode;
    tokens: TextRangeCollection<Token>;
    lines: TextRangeCollection<TextRange>;
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

    parseSourceFile(fileContents: string, parseOptions: ParseOptions,
            diagSink: DiagnosticSink, cancelToken?: CancelToken): ParseResults {
        timingStats.tokenizeFileTime.timeOperation(() => {
            this._startNewParse(fileContents, 0, fileContents.length,
                parseOptions, diagSink, cancelToken);
        });

        let moduleNode = new ModuleNode(new TextRange(0, fileContents.length));

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

                    let statement = this._parseStatement();
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
            tokens: this._tokenizerOutput!.tokens,
            lines: this._tokenizerOutput!.lines
        };
    }

    parseTextExpression(fileContents: string, textOffset: number, textLength: number,
            parseOptions: ParseOptions): ParseExpressionTextResults {
        let diagSink = new DiagnosticSink();
        this._startNewParse(fileContents, textOffset, textLength, parseOptions, diagSink);

        let parseTree = this._parseTestExpression();

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
        let tokenizer = new Tokenizer();
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
        let asyncToken = this._getKeywordToken(KeywordType.Async);

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
        let ifOrElifToken = this._getKeywordToken(keywordType);

        let test = this._parseTestExpression();
        let suite = this._parseSuite();
        let ifNode = new IfNode(ifOrElifToken, test, suite);

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

        let suite = this._parseSuite();

        this._isInLoop = wasInLoop;
        this._isInFinally = wasInFinally;

        return suite;
    }

    // suite: ':' (simple_stmt | NEWLINE INDENT stmt+ DEDENT)
    private _parseSuite(): SuiteNode {
        let nextToken = this._peekToken();
        let suite = new SuiteNode(nextToken);

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

                let statement = this._parseStatement();
                if (!statement) {
                    // Perform basic error recovery to get to the next line.
                    this._consumeTokensUntilType(TokenType.NewLine);
                } else {
                    suite.statements.push(statement);
                }

                let dedentToken = this._peekToken() as DedentToken;
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
        let forToken = this._getKeywordToken(KeywordType.For);

        let exprListResult = this._parseExpressionList(true);
        let targetExpr = this._makeExpressionOrTuple(exprListResult);
        let seqExpr: ExpressionNode;
        let forSuite: SuiteNode;
        let elseSuite: SuiteNode | undefined;

        if (!this._consumeTokenIfKeyword(KeywordType.In)) {
            seqExpr = this._handleExpressionParseError('Expected "in"');
            forSuite = new SuiteNode(this._peekToken());
        } else {
            seqExpr = this._parseTestListAsExpression('Expected expression after "in"');
            forSuite = this._parseLoopSuite();

            if (this._consumeTokenIfKeyword(KeywordType.Else)) {
                elseSuite = this._parseSuite();
            }
        }

        let forNode = new ForNode(forToken, targetExpr, seqExpr, forSuite);
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
        let compFor = this._tryParseCompForStatement();

        if (!compFor) {
            return undefined;
        }

        let compList: ListComprehensionIterNode[] = [compFor];
        while (true) {
            let compIter = this._tryParseCompForStatement() || this._tryParseCompIfStatement();
            if (!compIter) {
                break;
            }
            compList.push(compIter);
        }

        let listCompNode = new ListComprehensionNode(target);
        listCompNode.comprehensions = compList;
        listCompNode.extend(compList);
        return listCompNode;
    }

    // comp_for: ['async'] 'for' exprlist 'in' or_test [comp_iter]
    private _tryParseCompForStatement(): ListComprehensionForNode | undefined {
        let startTokenKeywordType = this._peekKeywordType();

        if (startTokenKeywordType === KeywordType.Async) {
            let nextToken = this._peekToken(1) as KeywordToken;
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

        let forToken = this._getKeywordToken(KeywordType.For);

        let exprListResult = this._parseExpressionList(true);
        let targetExpr = this._makeExpressionOrTuple(exprListResult);
        let seqExpr: ExpressionNode;

        if (!this._consumeTokenIfKeyword(KeywordType.In)) {
            seqExpr = this._handleExpressionParseError('Expected "in"');
        } else {
            seqExpr = this._parseOrTest();
        }

        let compForNode = new ListComprehensionForNode(asyncToken || forToken,
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

        let ifToken = this._getKeywordToken(KeywordType.If);
        let ifExpr = this._tryParseLambdaExpression() || this._parseOrTest();

        let compIfNode = new ListComprehensionIfNode(ifToken, ifExpr);

        return compIfNode;
    }

    // while_stmt: 'while' test suite ['else' suite]
    private _parseWhileStatement(): WhileNode {
        let whileToken = this._getKeywordToken(KeywordType.While);

        let whileNode = new WhileNode(whileToken);

        whileNode.whileExpression = this._parseTestExpression();
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
        let tryToken = this._getKeywordToken(KeywordType.Try);
        let trySuite = this._parseSuite();
        let tryNode = new TryNode(tryToken, trySuite);
        let sawCatchAllExcept = false;

        while (true) {
            let exceptToken = this._peekToken();
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

            let exceptSuite = this._parseSuite();
            let exceptNode = new ExceptNode(exceptToken, exceptSuite);
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
        let defToken = this._getKeywordToken(KeywordType.Def);

        let nameToken = this._getTokenIfIdentifier();
        if (!nameToken) {
            this._addError('Expected function name after "def"', defToken);
            nameToken = new IdentifierToken(0, 0, '');
        }

        if (!this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            this._addError('Expected "("', this._peekToken());
        }

        let paramList = this._parseVarArgsList(TokenType.CloseParenthesis, true);

        if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
            this._addError('Expected ")"', this._peekToken());
        }

        let returnType: ExpressionNode | undefined;
        if (this._consumeTokenIfType(TokenType.Arrow)) {
            returnType = this._parseTestExpression();
        }

        let suite = this._parseSuite();

        let functionNode = new FunctionNode(defToken, new NameNode(nameToken), suite);
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
            functionNode.returnTypeAnnotation = this._parseTypeAnnotation(returnType);
            functionNode.extend(functionNode.returnTypeAnnotation.rawExpression);
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
        let paramMap = new StringMap<string>();
        let paramList: ParameterNode[] = [];
        let sawDefaultParam = false;
        let reportedNonDefaultParamErr = false;
        let sawKwSeparator = false;
        let sawVarArgs = false;
        let sawKwArgs = false;

        while (true) {
            if (this._peekTokenType() === terminator) {
                break;
            }

            let param = this._parseParameter(allowAnnotations);
            if (!param) {
                this._consumeTokensUntilType(terminator);
                break;
            }

            if (param.name) {
                let name = param.name.nameToken.value;
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
            let lastParam = paramList[paramList.length - 1];
            if (!lastParam.name) {
                this._addError('Named argument must follow bar \'*\'', lastParam);
            }
        }

        return paramList;
    }

    private _parseParameter(allowAnnotations: boolean): ParameterNode {
        let starCount = 0;
        let firstToken = this._peekToken();

        if (this._consumeTokenIfOperator(OperatorType.Multiply)) {
            starCount = 1;
        } else if (this._consumeTokenIfOperator(OperatorType.Power)) {
            starCount = 2;
        }

        let paramName = this._getTokenIfIdentifier();
        if (!paramName) {
            if (starCount === 1) {
                let paramNode = new ParameterNode(firstToken, ParameterCategory.VarArgList);
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
        let paramNode = new ParameterNode(firstToken, paramType);
        if (paramName) {
            paramNode.name = new NameNode(paramName);
        }
        paramNode.extend(paramName);

        if (allowAnnotations && this._consumeTokenIfType(TokenType.Colon)) {
            paramNode.typeAnnotation = this._parseTypeAnnotation(this._parseTestExpression());
            paramNode.extend(paramNode.typeAnnotation.rawExpression);
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
        let withToken = this._getKeywordToken(KeywordType.With);
        let withItemList: WithItemNode[] = [];

        while (true) {
            withItemList.push(this._parseWithItem());

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        let withSuite = this._parseSuite();
        let withNode = new WithNode(withToken, withSuite);
        if (asyncToken) {
            withNode.isAsync = true;
            withNode.extend(asyncToken);
        }
        withNode.withItems = withItemList;
        return withNode;
    }

    // with_item: test ['as' expr]
    private _parseWithItem(): WithItemNode {
        let expr = this._parseTestExpression();
        let itemNode = new WithItemNode(expr);

        if (this._consumeTokenIfKeyword(KeywordType.As)) {
            itemNode.target = this._parseExpression(false);
            itemNode.extend(itemNode.target);
        }

        return itemNode;
    }

    // decorators: decorator+
    // decorated: decorators (classdef | funcdef | async_funcdef)
    private _parseDecorated(): StatementNode | undefined {
        let decoratorList: DecoratorNode[] = [];

        while (true) {
            if (this._peekOperatorType() === OperatorType.MatrixMultiply) {
                decoratorList.push(this._parseDecorator());
            } else {
                break;
            }
        }

        let nextToken = this._peekToken() as KeywordToken;
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
        let atOperator = this._getNextToken() as OperatorToken;
        assert.equal(atOperator.operatorType, OperatorType.MatrixMultiply);

        let callNameExpr: ExpressionNode | undefined;
        while (true) {
            let namePart = this._getTokenIfIdentifier();
            if (!namePart) {
                this._addError('Expected decorator name', this._peekToken());
                break;
            }

            let namePartNode = new NameNode(namePart);

            if (!callNameExpr) {
                callNameExpr = namePartNode;
            } else {
                callNameExpr = new MemberAccessExpressionNode(callNameExpr, namePartNode);
            }

            if (!this._consumeTokenIfType(TokenType.Dot)) {
                break;
            }
        }

        if (!callNameExpr) {
            callNameExpr = new ErrorExpressionNode(this._peekToken());
        }

        let decoratorNode = new DecoratorNode(atOperator, callNameExpr);

        if (this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            decoratorNode.arguments = this._parseArgList();

            let nextToken = this._peekToken();
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
        let classToken = this._getKeywordToken(KeywordType.Class);

        let nameToken = this._getTokenIfIdentifier();
        if (!nameToken) {
            this._addError('Expected class name', this._peekToken());
            nameToken = new IdentifierToken(0, 0, '');
        }

        let argList: ArgumentNode[] = [];
        if (this._consumeTokenIfType(TokenType.OpenParenthesis)) {
            argList = this._parseArgList();

            if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                this._addError('Expected ")"', this._peekToken());
            }
        }

        let suite = this._parseSuite();

        let classNode = new ClassNode(classToken, new NameNode(nameToken), suite);
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
        let breakToken = this._getKeywordToken(KeywordType.Break);

        if (!this._isInLoop) {
            this._addError('"break" can be used only within a loop',
                breakToken);
        }

        return new BreakNode(breakToken);
    }

    private _parseContinueStatement(): ContinueNode {
        let continueToken = this._getKeywordToken(KeywordType.Continue);

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
        let returnToken = this._getKeywordToken(KeywordType.Return);

        let returnNode = new ReturnNode(returnToken);

        if (!this._isNextTokenNeverExpression()) {
            let returnExpr = this._parseTestListAsExpression('Expected expression after "return"');
            returnNode.returnExpression = returnExpr;
            returnNode.extend(returnExpr);
        }

        // TODO - report error if version is < V33 and one or more
        // parameters are being returned from a generator (i.e.
        // the block also contains a yield statement).

        return returnNode;
    }

    // import_from: ('from' (('.' | '...')* dotted_name | ('.' | '...')+)
    //             'import' ('*' | '(' import_as_names ')' | import_as_names))
    // import_as_names: import_as_name (',' import_as_name)* [',']
    // import_as_name: NAME ['as' NAME]
    private _parseFromStatement(): ImportFromNode {
        let fromToken = this._getKeywordToken(KeywordType.From);

        let modName = this._parseDottedModuleName(true);
        let importFromNode = new ImportFromNode(fromToken, modName);

        if (!this._consumeTokenIfKeyword(KeywordType.Import)) {
            this._addError('Expected "import"', this._peekToken());
        } else {
            // Look for "*" token.
            if (!this._consumeTokenIfOperator(OperatorType.Multiply)) {
                let inParen = this._consumeTokenIfType(TokenType.OpenParenthesis);

                while (true) {
                    let importName = this._getTokenIfIdentifier();
                    if (!importName) {
                        break;
                    }

                    let importFromAsNode = new ImportFromAsNode(new NameNode(importName));

                    if (this._consumeTokenIfKeyword(KeywordType.As)) {
                        let aliasName = this._getTokenIfIdentifier();
                        if (!aliasName) {
                            this._addError('Expected alias symbol name', this._peekToken());
                        } else {
                            importFromAsNode.alias = new NameNode(aliasName);
                            importFromAsNode.extend(aliasName);
                        }
                    }

                    importFromNode.imports.push(importFromAsNode);
                    importFromNode.extend(importFromAsNode);

                    if (!this._consumeTokenIfType(TokenType.Comma)) {
                        break;
                    }
                }

                if (importFromNode.imports.length === 0) {
                    this._addError('Expected imported symbol name', this._peekToken());
                }

                if (inParen) {
                    let nextToken = this._peekToken();
                    if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                        this._addError('Expected ")"', this._peekToken());
                    } else {
                        importFromNode.extend(nextToken);
                    }
                }
            }
        }

        // TODO - need to process __future__ imports

        return importFromNode;
    }

    // import_name: 'import' dotted_as_names
    // dotted_as_names: dotted_as_name (',' dotted_as_name)*
    // dotted_as_name: dotted_name ['as' NAME]
    private _parseImportStatement(): ImportNode {
        let importToken = this._getKeywordToken(KeywordType.Import);

        let importNode = new ImportNode(importToken);

        while (true) {
            let modName = this._parseDottedModuleName();
            let importAsNode = new ImportAsNode(modName);

            if (this._consumeTokenIfKeyword(KeywordType.As)) {
                let aliasToken = this._getTokenIfIdentifier();
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
        let moduleNameNode = new ModuleNameNode(this._peekToken());

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
            let identifier = this._getTokenIfIdentifier([KeywordType.Import]);
            if (!identifier) {
                if (!allowJustDots || moduleNameNode.leadingDots === 0) {
                    this._addError('Expected module name', this._peekToken());
                }
                break;
            }

            moduleNameNode.nameParts.push(new NameNode(identifier));
            moduleNameNode.extend(identifier);

            if (!this._consumeTokenIfType(TokenType.Dot)) {
                break;
            }
        }

        return moduleNameNode;
    }

    private _parseGlobalStatement(): GlobalNode {
        let globalToken = this._getKeywordToken(KeywordType.Global);

        let globalNode = new GlobalNode(globalToken);
        globalNode.nameList = this._parseNameList();
        globalNode.extend(globalNode.nameList);
        return globalNode;
    }

    private _parseNonlocalStatement(): NonlocalNode {
        let nonlocalToken = this._getKeywordToken(KeywordType.Nonlocal);

        let nonlocalNode = new NonlocalNode(nonlocalToken);
        nonlocalNode.nameList = this._parseNameList();
        nonlocalNode.extend(nonlocalNode.nameList);
        return nonlocalNode;
    }

    private _parseNameList(): NameNode[] {
        let nameList: NameNode[] = [];

        while (true) {
            let name = this._getTokenIfIdentifier();
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
        let raiseToken = this._getKeywordToken(KeywordType.Raise);

        let raiseNode = new RaiseNode(raiseToken);
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
        let assertToken = this._getKeywordToken(KeywordType.Assert);

        let assertNode = new AssertNode(assertToken);

        while (true) {
            let expr = this._parseTestExpression();
            assertNode.expressions.push(expr);

            if (!this._consumeTokenIfType(TokenType.Comma)) {
                break;
            }
        }

        assertNode.extend(assertNode.expressions);
        return assertNode;
    }

    // del_stmt: 'del' exprlist
    private _parseDelStatement(): DelNode {
        let delToken = this._getKeywordToken(KeywordType.Del);

        let exprListResult = this._parseExpressionList(true);
        if (!exprListResult.parseError && exprListResult.list.length === 0) {
            this._addError('Expected expression after "del"', this._peekToken());
        }
        let delNode = new DelNode(delToken);
        delNode.expressions = exprListResult.list;
        delNode.extend(delNode.expressions);
        return delNode;
    }

    // yield_expr: 'yield' [yield_arg]
    // yield_arg: 'from' test | testlist
    private _parseYieldExpression(): YieldExpressionNode | YieldFromExpressionNode {
        let yieldToken = this._getKeywordToken(KeywordType.Yield);

        if (this._consumeTokenIfKeyword(KeywordType.From)) {
            return new YieldFromExpressionNode(yieldToken, this._parseTestExpression());
        }

        let exprListResult = this._parseTestExpressionList();
        let exprList = this._makeExpressionOrTuple(exprListResult);

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
        let statement = new StatementListNode(this._peekToken());

        while (true) {
            // Swallow invalid tokens to make sure we make forward progress.
            if (this._peekTokenType() === TokenType.Invalid) {
                const invalidToken = this._getNextToken();
                const text = this._fileContents!.substr(invalidToken.start, invalidToken.length);
                this._addError(`Invalid token: "${ text }"`, invalidToken);
                this._consumeTokensUntilType(TokenType.NewLine);
                break;
            }

            let smallStatement = this._parseSmallStatement();
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

            let nextTokenType = this._peekTokenType();
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

        let tupleStartRange: TextRange = exprListResult.list.length > 0 ?
            exprListResult.list[0] : this._peekToken(-1);

        let tupleNode = new TupleExpressionNode(tupleStartRange);
        tupleNode.expressions = exprListResult.list;
        tupleNode.extend(exprListResult.list);

        return tupleNode;
    }

    private _parseTestListAsExpression(errorString: string): ExpressionNode {
        if (this._isNextTokenNeverExpression()) {
            return this._handleExpressionParseError(errorString);
        }

        let exprListResult = this._parseTestExpressionList();
        if (exprListResult.parseError) {
            return exprListResult.parseError;
        }
        return this._makeExpressionOrTuple(exprListResult);
    }

    private _parseTestOrStarListAsExpression(): ExpressionNode {
        if (this._isNextTokenNeverExpression()) {
            return this._handleExpressionParseError('Expected expression');
        }

        let exprListResult = this._parseTestOrStarExpressionList();
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
        let exprListResult = this._parseExpressionListGeneric(() => this._parseTestOrStarExpression());

        if (!exprListResult.parseError) {
            // Make sure that we don't have more than one star expression in the list.
            let sawStar = false;
            for (let expr of exprListResult.list) {
                if (expr instanceof StarExpressionNode) {
                    if (sawStar) {
                        this._addError('Only one starred expression allowed in list', expr);
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
    private _parseExpression(allowStar: boolean): ExpressionNode {
        let startToken = this._peekToken();

        if (allowStar && this._consumeTokenIfOperator(OperatorType.Multiply)) {
            return new StarExpressionNode(startToken, this._parseExpression(false));
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

        let ifExpr = this._parseOrTest();
        if (ifExpr instanceof ErrorExpressionNode) {
            return ifExpr;
        }

        if (!this._consumeTokenIfKeyword(KeywordType.If)) {
            return ifExpr;
        }

        let testExpr = this._parseOrTest();
        if (testExpr instanceof ErrorExpressionNode) {
            return testExpr;
        }

        if (!this._consumeTokenIfKeyword(KeywordType.Else)) {
            return this._handleExpressionParseError('Expected "else"');
        }

        let elseExpr = this._parseTestExpression();
        if (elseExpr instanceof ErrorExpressionNode) {
            return elseExpr;
        }

        return new ConditionalExpressionNode(ifExpr, testExpr, elseExpr);
    }

    // or_test: and_test ('or' and_test)*
    private _parseOrTest(): ExpressionNode {
        let leftExpr = this._parseAndTest();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        if (this._consumeTokenIfKeyword(KeywordType.Or)) {
            let rightExpr = this._parseOrTest();

            return new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.Or);
        }

        return leftExpr;
    }

    // and_test: not_test ('and' not_test)*
    private _parseAndTest(): ExpressionNode {
        let leftExpr = this._parseNotTest();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        if (this._consumeTokenIfKeyword(KeywordType.And)) {
            let rightExpr = this._parseAndTest();
            return new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.And);
        }

        return leftExpr;
    }

    // not_test: 'not' not_test | comparison
    private _parseNotTest(): ExpressionNode {
        if (this._consumeTokenIfKeyword(KeywordType.Not)) {
            let notExpr = this._parseNotTest();
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
            let tokenAfterNot = this._peekToken(1);
            if (tokenAfterNot.type === TokenType.Keyword &&
                    (tokenAfterNot as KeywordToken).keywordType === KeywordType.In) {
                this._getNextToken();
                this._getNextToken();
                comparisonOperator = OperatorType.NotIn;
            }
        }

        if (comparisonOperator !== undefined) {
            let rightExpr = this._parseComparison();
            return new BinaryExpressionNode(leftExpr, rightExpr, comparisonOperator);
        }

        return leftExpr;
    }

    // expr: xor_expr ('|' xor_expr)*
    private _parseBitwiseOrExpression(): ExpressionNode {
        let leftExpr = this._parseExclusiveOrExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        if (this._consumeTokenIfOperator(OperatorType.BitwiseOr)) {
            let rightExpr = this._parseBitwiseOrExpression();
            return new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.BitwiseOr);
        }

        return leftExpr;
    }

    // xor_expr: and_expr ('^' and_expr)*
    private _parseExclusiveOrExpression(): ExpressionNode {
        let leftExpr = this._parseBitwiseAndExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        if (this._consumeTokenIfOperator(OperatorType.ExclusiveOr)) {
            let rightExpr = this._parseExclusiveOrExpression();
            return new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.ExclusiveOr);
        }

        return leftExpr;
    }

    // and_expr: shift_expr ('&' shift_expr)*
    private _parseBitwiseAndExpression(): ExpressionNode {
        let leftExpr = this._parseShiftExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        if (this._consumeTokenIfOperator(OperatorType.BitwiseAnd)) {
            let rightExpr = this._parseBitwiseAndExpression();
            return new BinaryExpressionNode(leftExpr, rightExpr, OperatorType.BitwiseAnd);
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
        if (nextOperator === OperatorType.LeftShift || nextOperator === OperatorType.RightShift) {
            this._getNextToken();
            let rightExpr = this._parseShiftExpression();
            return new BinaryExpressionNode(leftExpr, rightExpr, nextOperator);
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
        if (nextOperator === OperatorType.Add || nextOperator === OperatorType.Subtract) {
            this._getNextToken();
            let rightExpr = this._parseAirthmeticExpression();
            if (rightExpr instanceof ErrorExpressionNode) {
                return rightExpr;
            }

            return new BinaryExpressionNode(leftExpr, rightExpr, nextOperator);
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
        if (nextOperator === OperatorType.Multiply ||
                nextOperator === OperatorType.MatrixMultiply ||
                nextOperator === OperatorType.Divide ||
                nextOperator === OperatorType.Mod ||
                nextOperator === OperatorType.FloorDivide) {
            this._getNextToken();
            let rightExpr = this._parseAirthmeticTerm();
            return new BinaryExpressionNode(leftExpr, rightExpr, nextOperator);
        }

        return leftExpr;
    }

    // factor: ('+'|'-'|'~') factor | power
    // power: atom_expr ['**' factor]
    private _parseAirthmeticFactor(): ExpressionNode {
        let nextOperator = this._peekOperatorType();
        if (nextOperator === OperatorType.Add ||
                nextOperator === OperatorType.Subtract ||
                nextOperator === OperatorType.BitwiseInvert) {
            this._getNextToken();
            let expression = this._parseAirthmeticFactor();
            return new UnaryExpressionNode(expression, nextOperator);
        }

        let leftExpr = this._parseAtomExpression();
        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        if (this._consumeTokenIfOperator(OperatorType.Power)) {
            let rightExpr = this._parseAirthmeticFactor();
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
                    `Support for 'await' keyword requires Python 3.5 or newer`,
                    awaitToken);
            }
        }

        let atomExpression = this._parseAtom();
        if (atomExpression instanceof ErrorExpressionNode) {
            return atomExpression;
        }

        // Consume trailers.
        while (true) {
            // Is it a function call?
            if (this._consumeTokenIfType(TokenType.OpenParenthesis)) {
                let argList = this._parseArgList();
                let callNode = new CallExpressionNode(atomExpression);
                callNode.arguments = argList;
                callNode.extend(argList);

                let nextToken = this._peekToken();
                if (!this._consumeTokenIfType(TokenType.CloseParenthesis)) {
                    return this._handleExpressionParseError('Expected ")"');
                } else {
                    callNode.extend(nextToken);
                }

                atomExpression = callNode;
            } else if (this._consumeTokenIfType(TokenType.OpenBracket)) {
                // Is it an index operator?
                let indexExpr = this._parseSubscriptList();
                let indexNode = new IndexExpressionNode(atomExpression, indexExpr);
                indexNode.extend(indexNode);

                let nextToken = this._peekToken();
                if (!this._consumeTokenIfType(TokenType.CloseBracket)) {
                    return this._handleExpressionParseError('Expected "]"');
                } else {
                    indexNode.extend(nextToken);
                }

                atomExpression = indexNode;
            } else if (this._consumeTokenIfType(TokenType.Dot)) {
                // Is it a member access?
                let memberName = this._getTokenIfIdentifier();
                if (!memberName) {
                    return this._handleExpressionParseError('Expected member name after "."');
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
        let listResult = this._parseExpressionListGeneric(() => this._parseSubscript(), () => {
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
            return this._handleExpressionParseError('Expected index or slice expression');
        }

        return this._makeExpressionOrTuple(listResult);
    }

    // subscript: test | [test] ':' [test] [sliceop]
    // sliceop: ':' [test]
    private _parseSubscript(): ExpressionNode {
        let firstToken = this._peekToken();
        let sliceExpressions: (ExpressionNode | undefined)[] = [undefined, undefined, undefined];
        let sliceIndex = 0;
        let sawColon = false;

        while (true) {
            let nextTokenType = this._peekTokenType();
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

        let sliceNode = new SliceExpressionNode(firstToken);
        sliceNode.startValue = sliceExpressions[0];
        sliceNode.endValue = sliceExpressions[1];
        sliceNode.stepValue = sliceExpressions[2];
        sliceNode.extend(sliceExpressions[2] || sliceExpressions[1] || sliceExpressions[0]);

        return sliceNode;
    }

    // arglist: argument (',' argument)*  [',']
    private _parseArgList(): ArgumentNode[] {
        let argList: ArgumentNode[] = [];
        let sawKeywordArg = false;

        while (true) {
            let nextTokenType = this._peekTokenType();
            if (nextTokenType === TokenType.CloseParenthesis ||
                    nextTokenType === TokenType.NewLine ||
                    nextTokenType === TokenType.EndOfStream) {
                break;
            }

            let arg = this._parseArgument();
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
        let firstToken = this._peekToken();

        let argType = ArgumentCategory.Simple;
        if (this._consumeTokenIfOperator(OperatorType.Multiply)) {
            argType = ArgumentCategory.List;
        } else if (this._consumeTokenIfOperator(OperatorType.Power)) {
            argType = ArgumentCategory.Dictionary;
        }

        let valueExpr = this._parseTestExpression();
        let nameIdentifier: IdentifierToken | undefined;

        if (argType === ArgumentCategory.Simple) {
            if (this._consumeTokenIfOperator(OperatorType.Assign)) {
                let nameExpr = valueExpr;
                valueExpr = this._parseTestExpression();

                if (nameExpr instanceof NameNode) {
                    nameIdentifier = nameExpr.nameToken;
                } else {
                    this._addError('Expected parameter name', nameExpr);
                }
            } else {
                let listComp = this._tryParseListComprehension(valueExpr);
                if (listComp) {
                    valueExpr = listComp;
                }
            }
        }

        let argNode = new ArgumentNode(firstToken, valueExpr, argType);
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
        let nextToken = this._peekToken();

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
            let stringTokenList: StringToken[] = [];

            while (this._peekTokenType() === TokenType.String) {
                stringTokenList.push(this._getNextToken() as StringToken);
            }

            return new StringNode(stringTokenList);
        }

        if (nextToken.type === TokenType.OpenParenthesis) {
            return this._parseTupleAtom();
        } else if (nextToken.type === TokenType.OpenBracket) {
            return this._parseListAtom();
        } else if (nextToken.type === TokenType.OpenCurlyBrace) {
            return this._parseDictionaryOrSetAtom();
        }

        if (nextToken.type === TokenType.Keyword) {
            let keywordToken = nextToken as KeywordToken;
            if (keywordToken.keywordType === KeywordType.False ||
                    keywordToken.keywordType === KeywordType.True ||
                    keywordToken.keywordType === KeywordType.Debug ||
                    keywordToken.keywordType === KeywordType.None) {
                return new ConstantNode(this._getNextToken() as KeywordToken);
            }

            // Make an identifier out of the keyword.
            let keywordAsIdentifier = this._getTokenIfIdentifier();
            if (keywordAsIdentifier) {
                return new NameNode(keywordAsIdentifier);
            }
        }

        return this._handleExpressionParseError('Expected expression');
    }

    // Allocates a dummy "error expression" and consumes the remainder
    // of the tokens on the line for error recovery.
    private _handleExpressionParseError(errorMsg: string): ErrorExpressionNode {
        this._addError(errorMsg, this._peekToken());
        let expr = new ErrorExpressionNode(this._peekToken());
        this._consumeTokensUntilType(TokenType.NewLine);
        return expr;
    }

    // lambdef: 'lambda' [varargslist] ':' test
    private _parseLambdaExpression(allowConditional = true): LambdaNode {
        let labmdaToken = this._getKeywordToken(KeywordType.Lambda);

        let argList = this._parseVarArgsList(TokenType.Colon, false);

        if (!this._consumeTokenIfType(TokenType.Colon)) {
            this._addError('Expected ":"', this._peekToken());
        }

        let testExpr: ExpressionNode;
        if (allowConditional) {
            testExpr = this._parseTestExpression();
        } else {
            testExpr = this._tryParseLambdaExpression(false) || this._parseOrTest();
        }

        let lambdaNode = new LambdaNode(labmdaToken, testExpr);
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
        let startParen = this._getNextToken();
        assert.equal(startParen.type, TokenType.OpenParenthesis);

        let yieldExpr = this._tryParseYieldExpression();
        if (yieldExpr) {
            if (this._peekTokenType() !== TokenType.CloseParenthesis) {
                return this._handleExpressionParseError('Expected ")"');
            } else {
                yieldExpr.extend(this._getNextToken());
            }

            return yieldExpr;
        }

        let exprListResult = this._parseTestListWithComprehension();
        let tupleOrExpression = this._makeExpressionOrTuple(exprListResult);

        if (this._peekTokenType() !== TokenType.CloseParenthesis) {
            return this._handleExpressionParseError('Expected ")"');
        } else {
            tupleOrExpression.extend(this._getNextToken());
        }

        return tupleOrExpression;
    }

    // '[' [testlist_comp] ']'
    // testlist_comp: (test | star_expr) (comp_for | (',' (test | star_expr))* [','])
    private _parseListAtom(): ListNode | ErrorExpressionNode {
        let startBracket = this._getNextToken();
        assert.equal(startBracket.type, TokenType.OpenBracket);

        let exprListResult = this._parseTestListWithComprehension();
        let closeBracket: Token | undefined = this._peekToken();
        if (!this._consumeTokenIfType(TokenType.CloseBracket)) {
            return this._handleExpressionParseError('Expected "]"');
        }

        let listAtom = new ListNode(startBracket);
        listAtom.extend(closeBracket);
        listAtom.extend(exprListResult.list);
        listAtom.entries = exprListResult.list;
        return listAtom;
    }

    private _parseTestListWithComprehension(): ExpressionListResult {
        let sawComprehension = false;

        return this._parseExpressionListGeneric(() => {
            let expr = this._parseTestOrStarExpression();
            let listComp = this._tryParseListComprehension(expr);
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
        let startBrace = this._getNextToken();
        assert.equal(startBrace.type, TokenType.OpenCurlyBrace);

        let dictionaryEntries: DictionaryEntryNode[] = [];
        let setEntries: ExpressionNode[] = [];
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
                if (keyExpression instanceof StarExpressionNode) {
                    this._addError('Star expressions not allowed in dictionaries', keyExpression);
                }

                if (isSet) {
                    this._addError('Key/value pairs are not allowed within a set', valueExpression);
                } else {
                    let dictEntry: DictionaryEntryNode = new DictionaryKeyEntryNode(keyExpression, valueExpression);
                    let listComp = this._tryParseListComprehension(dictEntry);
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
                    let expandEntryNode: ExpressionNode = new DictionaryExpandEntryNode(doubleStarExpression);
                    let listComp = this._tryParseListComprehension(expandEntryNode);
                    if (listComp) {
                        expandEntryNode = listComp;
                        sawListComprehension = true;
                    }
                    dictionaryEntries.push();
                    isDictionary = true;
                }
            } else {
                assert(keyExpression !== undefined);
                if (keyExpression) {
                    if (isDictionary) {
                        this._addError('Dictionary entries must contain key/value pairs', keyExpression);
                    } else {
                        let listComp = this._tryParseListComprehension(keyExpression);
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
            let setAtom = new SetNode(startBrace);
            setAtom.extend(closeCurlyBrace);
            setAtom.extend(setEntries);
            setAtom.entries = setEntries;
            return setAtom;
        }

        let dictionaryAtom = new DictionaryNode(startBrace);
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
        let list: ExpressionNode[] = [];
        let parseError: ErrorExpressionNode | undefined;

        while (true) {
            if (teminalCheck()) {
                break;
            }

            let expr = parser();
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
        let annotationExpr: TypeAnnotationExpression | undefined;

        if (leftExpr instanceof ErrorExpressionNode) {
            return leftExpr;
        }

        // Is this a type annotation assignment?
        if (this._consumeTokenIfType(TokenType.Colon)) {
            annotationExpr = this._parseTypeAnnotation(this._parseTestExpression());
            leftExpr = new TypeAnnotationExpressionNode(leftExpr, annotationExpr);

            if (!this._consumeTokenIfOperator(OperatorType.Assign)) {
                return leftExpr;
            }

            if (!this._parseOptions.isStubFile && this._getLanguageVersion() < PythonVersion.V36) {
                this._addError('Type annotations for variables requires Python 3.6 or newer',
                    annotationExpr.rawExpression);
            }

            let rightExpr = this._parseTestExpression();
            return new AssignmentNode(leftExpr, rightExpr);
        }

        // Is this a simple assignment?
        if (this._consumeTokenIfOperator(OperatorType.Assign)) {
            return this._parseChainAssignments(leftExpr);
        }

        if (!annotationExpr && Tokenizer.isOperatorAssignment(this._peekOperatorType())) {
            let operatorToken = this._getNextToken() as OperatorToken;

            // Is the left side of the assignment assignable?
            const assignError = leftExpr.getAssignmentError();
            if (assignError) {
                this._addError(assignError, leftExpr);
            }

            let rightExpr = this._tryParseYieldExpression() ||
                this._parseTestListAsExpression('Expected expression to the right of operator');
            return new AugmentedAssignemtnExpressionNode(leftExpr, rightExpr, operatorToken.operatorType);
        }

        return leftExpr;
    }

    private _parseChainAssignments(leftExpr: ExpressionNode): ExpressionNode {
        // Is the left side of the assignment assignable?
        const assignError = leftExpr.getAssignmentError();
        if (assignError) {
            this._addError(assignError, leftExpr);
        }

        let rightExpr: ExpressionNode | undefined;
        rightExpr = this._tryParseYieldExpression();
        if (!rightExpr) {
            rightExpr = this._parseTestListAsExpression('Expected expression to the right of "="');
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

        return new AssignmentNode(leftExpr, rightExpr);
    }

    private _parseTypeAnnotation(node: ExpressionNode): TypeAnnotationExpression {
        let rawExpression = node;
        let parsedExpression = node;

        if (rawExpression instanceof StringNode) {
            if (rawExpression.tokens.length > 1) {
                this._addError('Type hints cannot span multiple string literals', node);
            } else if (rawExpression.tokens[0].quoteTypeFlags & QuoteTypeFlags.Triplicate) {
                this._addError('Type hints cannot use triple quotes', node);
            } else if (rawExpression.tokens[0].quoteTypeFlags &
                    (QuoteTypeFlags.Raw | QuoteTypeFlags.Unicode | QuoteTypeFlags.Byte)) {
                this._addError('Type hints cannot use raw, unicode or byte string literals', node);
            } else if (rawExpression.tokens[0].value.length !== rawExpression.tokens[0].length - 2) {
                this._addError('Type hints cannot contain escape characters', node);
            } else {
                let stringValue = rawExpression.tokens[0].value;
                let tokenOffset = rawExpression.tokens[0].start;
                let parser = new Parser();
                let parseResults = parser.parseTextExpression(this._fileContents!,
                    tokenOffset + 1, stringValue.length, this._parseOptions);

                parseResults.diagnostics.forEach(diag => {
                    this._addError(diag.message, node);
                });

                if (parseResults.parseTree) {
                    parsedExpression = parseResults.parseTree;
                }
            }
        }

        return {
            rawExpression,
            expression: parsedExpression
        };
    }

    // Peeks at the next token and returns true if it can never
    // represent the start of an expression.
    private _isNextTokenNeverExpression(): boolean {
        let nextToken = this._peekToken();
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
                    case OperatorType.ExclusiveOrEqual:
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
        let token = this._tokenizerOutput!.tokens.getItemAt(this._tokenIndex);
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
        let nextToken = this._peekToken();
        if (nextToken.type !== TokenType.Keyword) {
            return undefined;
        }

        return (nextToken as KeywordToken).keywordType;
    }

    private _peekOperatorType(): OperatorType | undefined {
        let nextToken = this._peekToken();
        if (nextToken.type !== TokenType.Operator) {
            return undefined;
        }

        return (nextToken as OperatorToken).operatorType;
    }

    private _getTokenIfIdentifier(disallowedKeywords: KeywordType[] = []): IdentifierToken | undefined {
        let nextToken = this._peekToken();
        if (nextToken.type === TokenType.Identifier) {
            return this._getNextToken() as IdentifierToken;
        }

        // If keywords are allowed in this context, convert the keyword
        // to an identifier token.
        if (nextToken.type === TokenType.Keyword) {
            let keywordType = this._peekKeywordType();
            if (!disallowedKeywords.find(type => type === keywordType)) {
                const keywordText = this._fileContents!.substring(nextToken.start, nextToken.end);
                this._getNextToken();
                return new IdentifierToken(nextToken.start, nextToken.end, keywordText);
            }
        }

        return undefined;
    }

    // Consumes tokens until the next one in the stream is
    // either a specified terminator or the end-of-stream
    // token.
    private _consumeTokensUntilType(terminator: TokenType): boolean {
        while (true) {
            let token = this._peekToken();
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
        let keywordToken = this._getNextToken() as KeywordToken;
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
