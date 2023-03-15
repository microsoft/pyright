/*
 * dumpFileDebugInfoCommand.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Dump various token/node/type info
 */

import { CancellationToken, ExecuteCommandParams } from 'vscode-languageserver';

import { getFlowNode } from '../analyzer/analyzerNodeInfo';
import { findNodeByOffset, printParseNodeType } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import {
    ClassType,
    ClassTypeFlags,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    TypeBase,
    TypeCategory,
    TypeFlags,
    TypeVarDetails,
    TypeVarType,
    Variance,
} from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { isNumber, isString } from '../common/core';
import { convertOffsetsToRange, convertOffsetToPosition } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { LanguageServerInterface } from '../languageServerBase';
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
    DictionaryExpandEntryNode,
    DictionaryKeyEntryNode,
    DictionaryNode,
    EllipsisNode,
    ErrorExpressionCategory,
    ErrorNode,
    ExceptNode,
    ExpressionNode,
    FormatStringNode,
    ForNode,
    FunctionAnnotationNode,
    FunctionNode,
    GlobalNode,
    IfNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ImportNode,
    IndexNode,
    isExpressionNode,
    LambdaNode,
    ListComprehensionForNode,
    ListComprehensionIfNode,
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
    PatternCaptureNode,
    PatternClassArgumentNode,
    PatternClassNode,
    PatternLiteralNode,
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
    StringListNode,
    StringNode,
    SuiteNode,
    TernaryNode,
    TryNode,
    TupleNode,
    TypeAliasNode,
    TypeAnnotationNode,
    TypeParameterCategory,
    TypeParameterListNode,
    TypeParameterNode,
    UnaryOperationNode,
    UnpackNode,
    WhileNode,
    WithItemNode,
    WithNode,
    YieldFromNode,
    YieldNode,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { KeywordType, NewLineType, OperatorType, StringTokenFlags, Token, TokenType } from '../parser/tokenizerTypes';
import { ServerCommand } from './commandController';

export class DumpFileDebugInfoCommand implements ServerCommand {
    constructor(private _ls: LanguageServerInterface) {}

    async execute(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        throwIfCancellationRequested(token);

        if (!params.arguments || params.arguments.length < 2) {
            return [];
        }

        const filePath = params.arguments[0] as string;
        const kind = params.arguments[1];

        const workspace = await this._ls.getWorkspaceForFile(filePath);
        const parseResults = workspace.service.getParseResult(filePath);
        if (!parseResults) {
            return [];
        }

        const output: string[] = [];
        const collectingConsole = {
            info: (m: string) => {
                output.push(m);
            },
            log: (m: string) => {
                output.push(m);
            },
            error: (m: string) => {
                output.push(m);
            },
            warn: (m: string) => {
                output.push(m);
            },
        };

        collectingConsole.info(`* Dump debug info for '${filePath}'`);

        switch (kind) {
            case 'tokens': {
                collectingConsole.info(`* Token info (${parseResults.tokenizerOutput.tokens.count} tokens)`);

                for (let i = 0; i < parseResults.tokenizerOutput.tokens.count; i++) {
                    const token = parseResults.tokenizerOutput.tokens.getItemAt(i);
                    collectingConsole.info(
                        `[${i}] ${getTokenString(filePath, token, parseResults.tokenizerOutput.lines)}`
                    );
                }
                break;
            }
            case 'nodes': {
                collectingConsole.info(`* Node info`);

                const dumper = new TreeDumper(filePath, parseResults.tokenizerOutput.lines);
                dumper.walk(parseResults.parseTree);

                collectingConsole.info(dumper.output);
                break;
            }
            case 'types': {
                const evaluator = workspace.service.getEvaluator();
                const start = params.arguments[2] as number;
                const end = params.arguments[3] as number;
                if (!evaluator || !start || !end) {
                    return [];
                }

                collectingConsole.info(`* Type info`);
                collectingConsole.info(`${getTypeEvaluatorString(filePath, evaluator, parseResults, start, end)}`);
                break;
            }
            case 'cachedtypes': {
                const evaluator = workspace.service.getEvaluator();
                const start = params.arguments[2] as number;
                const end = params.arguments[3] as number;
                if (!evaluator || !start || !end) {
                    return [];
                }

                collectingConsole.info(`* Cached Type info`);
                collectingConsole.info(
                    `${getTypeEvaluatorString(filePath, evaluator, parseResults, start, end, true)}`
                );
                break;
            }

            case 'codeflowgraph': {
                const evaluator = workspace.service.getEvaluator();
                const offset = params.arguments[2] as number;
                if (!evaluator || offset === undefined) {
                    return [];
                }
                const node = findNodeByOffset(parseResults.parseTree, offset);
                if (!node) {
                    return [];
                }
                const flowNode = getFlowNode(node);
                if (!flowNode) {
                    return [];
                }
                collectingConsole.info(`* CodeFlow Graph`);
                evaluator.printControlFlowGraph(flowNode, undefined, 'Dump CodeFlowGraph', collectingConsole);
            }
        }

        // Print all of the output in one message so the trace log is smaller.
        this._ls.console.info(output.join('\n'));
    }
}

function stringify(value: any, replacer: (this: any, key: string, value: any) => any): string {
    const json = JSON.stringify(value, replacer, 2);

    // Unescape any paths so VS code shows them as clickable.
    return json.replace(/\\\\/g, '\\');
}

function getTypeEvaluatorString(
    file: string,
    evaluator: TypeEvaluator,
    results: ParseResults,
    start: number,
    end: number,
    cacheOnly?: boolean
) {
    const dumper = new TreeDumper(file, results.tokenizerOutput.lines);
    const node = findNodeByOffset(results.parseTree, start) ?? findNodeByOffset(results.parseTree, end);
    if (!node) {
        return 'N/A';
    }

    const set = new Set();

    if (node.nodeType === ParseNodeType.Name) {
        switch (node.parent?.nodeType) {
            case ParseNodeType.Class: {
                const result = cacheOnly
                    ? evaluator.getCachedType(node.parent.name)
                    : evaluator.getTypeOfClass(node.parent as ClassNode);
                if (!result) {
                    return 'N/A';
                }

                return stringify(result, replacer);
            }
            case ParseNodeType.Function: {
                const result = cacheOnly
                    ? evaluator.getCachedType(node.parent.name)
                    : evaluator.getTypeOfFunction(node.parent as FunctionNode);
                if (!result) {
                    return 'N/A';
                }

                return stringify(result, replacer);
            }
        }
    }

    const range = TextRange.fromBounds(start, end);
    const expr = getExpressionNodeWithRange(node, range);
    if (!expr) {
        return 'N/A';
    }

    const sb = `Expression node found at ${getTextSpanString(
        expr,
        results.tokenizerOutput.lines
    )} from the given span ${getTextSpanString(range, results.tokenizerOutput.lines)}\r\n`;

    const result = cacheOnly ? evaluator.getCachedType(expr) : evaluator.getType(expr);
    if (!result) {
        return sb + 'No result';
    }

    return sb + stringify(result, replacer);

    function getExpressionNodeWithRange(node: ParseNode, range: TextRange): ExpressionNode | undefined {
        // find best expression node that contains both start and end.
        let current: ParseNode | undefined = node;
        while (current && !TextRange.containsRange(current, range)) {
            current = current.parent;
        }

        if (!current) {
            return undefined;
        }

        while (!isExpressionNode(current!)) {
            current = current!.parent;
        }

        return current;
    }

    function replacer(this: any, key: string, value: any) {
        if (value === undefined) {
            return undefined;
        }

        if (!isNumber(value) && !isString(value)) {
            if (set.has(value)) {
                if (isClassType(value)) {
                    return `<cycle> class '${value.details.fullName}' typeSourceId:${value.details.typeSourceId}`;
                }

                if (isFunctionType(value)) {
                    return `<cycle> function '${value.details.fullName}' parameter count:${value.details.parameters.length}`;
                }

                if (isTypeVarType(value)) {
                    return `<cycle> function '${value.details.name}' scope id:${value.nameWithScope}`;
                }

                return undefined;
            } else {
                set.add(value);
            }
        }

        if (isTypeBase(this) && key === 'category') {
            return getTypeCategoryString(value, this);
        }

        if (isTypeBase(this) && key === 'flags') {
            return getTypeFlagsString(value);
        }

        if (isClassDetail(this) && key === 'flags') {
            return getClassTypeFlagsString(value);
        }

        if (isFunctionDetail(this) && key === 'flags') {
            return getFunctionTypeFlagsString(value);
        }

        if (isTypeVarDetails(this) && key === 'variance') {
            return getVarianceString(value);
        }

        if (isParameter(this) && key === 'category') {
            return getParameterCategoryString(value);
        }

        if (value.nodeType && value.id) {
            dumper.visitNode(value as ParseNode);

            const output = dumper.output;
            dumper.reset();
            return output;
        }

        return value;
    }

    function isTypeBase(type: any): boolean {
        return type.category && type.flags;
    }

    function isClassType(type: any): type is ClassType {
        return isTypeBase(type) && type.details && isClassDetail(type.details);
    }

    function isClassDetail(type: any): boolean {
        return (
            type.name !== undefined && type.fullName !== undefined && type.moduleName !== undefined && type.baseClasses
        );
    }

    function isFunctionType(type: any): type is FunctionType {
        return isTypeBase(type) && type.details && isFunctionDetail(type.details);
    }

    function isFunctionDetail(type: any): boolean {
        return (
            type.name !== undefined && type.fullName !== undefined && type.moduleName !== undefined && type.parameters
        );
    }

    function isTypeVarType(type: any): type is TypeVarType {
        return isTypeBase(type) && type.details && isTypeVarDetails(type.details);
    }

    function isTypeVarDetails(type: any): type is TypeVarDetails {
        return type.name !== undefined && type.constraints && type.variance !== undefined;
    }

    function isParameter(type: any): type is FunctionParameter {
        return type.category && type.type;
    }
}

function getVarianceString(type: Variance) {
    switch (type) {
        case Variance.Invariant:
            return 'Invariant';
        case Variance.Covariant:
            return 'Covariant';
        case Variance.Contravariant:
            return 'Contravariant';
        default:
            return `Unknown Value!! (${type})`;
    }
}

function getFlagEnumString<E extends number>(enumMap: [E, string][], enumValue: E): string {
    const str: string[] = [];
    enumMap.forEach((e) => {
        if (enumValue & e[0]) {
            str.push(e[1]);
        }
    });
    if (str.length === 0) {
        if (enumValue === 0) {
            return 'None';
        }
        return '<Unknown>';
    }

    return str.join(',');
}

const FunctionTypeFlagsToString: [FunctionTypeFlags, string][] = [
    [FunctionTypeFlags.AbstractMethod, 'AbstractMethod'],
    [FunctionTypeFlags.Async, 'Async'],
    [FunctionTypeFlags.ClassMethod, 'ClassMethod'],
    [FunctionTypeFlags.ConstructorMethod, 'ConstructorMethod'],
    [FunctionTypeFlags.DisableDefaultChecks, 'DisableDefaultChecks'],
    [FunctionTypeFlags.Final, 'Final'],
    [FunctionTypeFlags.Generator, 'Generator'],
    [FunctionTypeFlags.Overloaded, 'Overloaded'],
    [FunctionTypeFlags.ParamSpecValue, 'ParamSpecValue'],
    [FunctionTypeFlags.PartiallyEvaluated, 'PartiallyEvaluated'],
    [FunctionTypeFlags.PyTypedDefinition, 'PyTypedDefinition'],
    [FunctionTypeFlags.SkipArgsKwargsCompatibilityCheck, 'SkipArgsKwargsCompatibilityCheck'],
    [FunctionTypeFlags.SkipConstructorCheck, 'SkipConstructorCheck'],
    [FunctionTypeFlags.StaticMethod, 'StaticMethod'],
    [FunctionTypeFlags.StubDefinition, 'StubDefinition'],
    [FunctionTypeFlags.SynthesizedMethod, 'SynthesizedMethod'],
    [FunctionTypeFlags.UnannotatedParams, 'UnannotatedParams'],
    [FunctionTypeFlags.WrapReturnTypeInAwait, 'WrapReturnTypeInAwait'],
];

function getFunctionTypeFlagsString(flags: FunctionTypeFlags) {
    return getFlagEnumString(FunctionTypeFlagsToString, flags);
}

const ClassTypeFlagsToString: [ClassTypeFlags, string][] = [
    [ClassTypeFlags.BuiltInClass, 'BuiltInClass'],
    [ClassTypeFlags.CanOmitDictValues, 'CanOmitDictValues'],
    [ClassTypeFlags.ClassProperty, 'ClassProperty'],
    [ClassTypeFlags.DataClass, 'DataClass'],
    [ClassTypeFlags.DataClassKeywordOnlyParams, 'DataClassKeywordOnlyParams'],
    [ClassTypeFlags.DefinedInStub, 'DefinedInStub'],
    [ClassTypeFlags.EnumClass, 'EnumClass'],
    [ClassTypeFlags.Final, 'Final'],
    [ClassTypeFlags.FrozenDataClass, 'FrozenDataClass'],
    [ClassTypeFlags.GenerateDataClassSlots, 'GenerateDataClassSlots'],
    [ClassTypeFlags.HasCustomClassGetItem, 'HasCustomClassGetItem'],
    [ClassTypeFlags.PartiallyEvaluated, 'PartiallyEvaluated'],
    [ClassTypeFlags.PropertyClass, 'PropertyClass'],
    [ClassTypeFlags.ProtocolClass, 'ProtocolClass'],
    [ClassTypeFlags.PseudoGenericClass, 'PseudoGenericClass'],
    [ClassTypeFlags.ReadOnlyInstanceVariables, 'ReadOnlyInstanceVariables'],
    [ClassTypeFlags.RuntimeCheckable, 'RuntimeCheckable'],
    [ClassTypeFlags.SkipSynthesizedDataClassEq, 'SkipSynthesizedDataClassEq'],
    [ClassTypeFlags.SkipSynthesizedDataClassInit, 'SkipSynthesizedDataClassInit'],
    [ClassTypeFlags.SpecialBuiltIn, 'SpecialBuiltIn'],
    [ClassTypeFlags.SupportsAbstractMethods, 'SupportsAbstractMethods'],
    [ClassTypeFlags.SynthesizeDataClassUnsafeHash, 'SynthesizeDataClassUnsafeHash'],
    [ClassTypeFlags.SynthesizedDataClassOrder, 'SynthesizedDataClassOrder'],
    [ClassTypeFlags.TupleClass, 'TupleClass'],
    [ClassTypeFlags.TypedDictClass, 'TypedDictClass'],
    [ClassTypeFlags.TypingExtensionClass, 'TypingExtensionClass'],
];

function getClassTypeFlagsString(flags: ClassTypeFlags) {
    return getFlagEnumString(ClassTypeFlagsToString, flags);
}

function getTypeFlagsString(flags: TypeFlags) {
    const str = [];

    if (flags & TypeFlags.Instantiable) {
        str.push('Instantiable');
    }

    if (flags & TypeFlags.Instance) {
        str.push('Instance');
    }

    if (str.length === 0) return 'None';

    return str.join(',');
}

function getTypeCategoryString(typeCategory: TypeCategory, type: any) {
    switch (typeCategory) {
        case TypeCategory.Unbound:
            return 'Unbound';
        case TypeCategory.Unknown:
            return 'Unknown';
        case TypeCategory.Any:
            return 'Any';
        case TypeCategory.None:
            return 'None';
        case TypeCategory.Never:
            return 'Never';
        case TypeCategory.Function:
            return 'Function';
        case TypeCategory.OverloadedFunction:
            return 'OverloadedFunction';
        case TypeCategory.Class:
            if (TypeBase.isInstantiable(type)) {
                return 'Class';
            } else {
                return 'Object';
            }
        case TypeCategory.Module:
            return 'Module';
        case TypeCategory.Union:
            return 'Union';
        case TypeCategory.TypeVar:
            return 'TypeVar';
        default:
            return `Unknown Value!! (${typeCategory})`;
    }
}

class TreeDumper extends ParseTreeWalker {
    private _indentation = '';
    private _output = '';

    constructor(private _file: string, private _lines: TextRangeCollection<TextRange>) {
        super();
    }

    get output(): string {
        return this._output;
    }

    override walk(node: ParseNode): void {
        const childrenToWalk = this.visitNode(node);
        if (childrenToWalk.length > 0) {
            this._indentation += '  ';
            this.walkMultiple(childrenToWalk);
            this._indentation = this._indentation.substr(0, this._indentation.length - 2);
        }
    }

    private _log(value: string) {
        this._output += `${this._indentation}${value}\r\n`;
    }

    private _getPrefix(node: ParseNode) {
        const pos = convertOffsetToPosition(node.start, this._lines);
        // VS code's output window expects 1 based values, print the line/char with 1 based.
        return `[${node.id}] '${this._file}:${pos.line + 1}:${pos.character + 1}' => ${printParseNodeType(
            node.nodeType
        )} ${getTextSpanString(node, this._lines)} =>`;
    }

    reset() {
        this._indentation = '';
        this._output = '';
    }

    override visitArgument(node: ArgumentNode) {
        this._log(`${this._getPrefix(node)} ${getArgumentCategoryString(node.argumentCategory)}`);
        return true;
    }

    override visitAssert(node: AssertNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitAssignment(node: AssignmentNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitAssignmentExpression(node: AssignmentExpressionNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitAugmentedAssignment(node: AugmentedAssignmentNode) {
        this._log(`${this._getPrefix(node)} ${getOperatorTypeString(node.operator)}`);
        return true;
    }

    override visitAwait(node: AwaitNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitBinaryOperation(node: BinaryOperationNode) {
        this._log(
            `${this._getPrefix(node)} ${getTokenString(
                this._file,
                node.operatorToken,
                this._lines
            )} ${getOperatorTypeString(node.operator)}} parenthesized:(${node.parenthesized})`
        );
        return true;
    }

    override visitBreak(node: BreakNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitCall(node: CallNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitClass(node: ClassNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitTernary(node: TernaryNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitContinue(node: ContinueNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitConstant(node: ConstantNode) {
        this._log(`${this._getPrefix(node)} ${getKeywordTypeString(node.constType)}`);
        return true;
    }

    override visitDecorator(node: DecoratorNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitDel(node: DelNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitDictionary(node: DictionaryNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitDictionaryKeyEntry(node: DictionaryKeyEntryNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitDictionaryExpandEntry(node: DictionaryExpandEntryNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitError(node: ErrorNode) {
        this._log(`${this._getPrefix(node)} ${getErrorExpressionCategoryString(node.category)}`);
        return true;
    }

    override visitEllipsis(node: EllipsisNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitIf(node: IfNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitImport(node: ImportNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitImportAs(node: ImportAsNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitImportFrom(node: ImportFromNode) {
        this._log(
            `${this._getPrefix(node)} wildcard import:(${node.isWildcardImport}) paren:(${
                node.usesParens
            }) wildcard token:(${
                node.wildcardToken ? getTokenString(this._file, node.wildcardToken, this._lines) : 'N/A'
            }) missing import keyword:(${node.missingImportKeyword})`
        );
        return true;
    }

    override visitImportFromAs(node: ImportFromAsNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitIndex(node: IndexNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitExcept(node: ExceptNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitFor(node: ForNode) {
        this._log(`${this._getPrefix(node)} async:(${node.isAsync})`);
        return true;
    }

    override visitFormatString(node: FormatStringNode) {
        this._log(
            `${this._getPrefix(node)} ${getTokenString(this._file, node.token, this._lines)} ${
                node.value
            } unescape errors:(${node.hasUnescapeErrors})`
        );
        return true;
    }

    override visitFunction(node: FunctionNode) {
        this._log(`${this._getPrefix(node)} async:(${node.isAsync})`);
        return true;
    }

    override visitFunctionAnnotation(node: FunctionAnnotationNode) {
        this._log(`${this._getPrefix(node)} ellipsis:(${node.isParamListEllipsis})`);
        return true;
    }

    override visitGlobal(node: GlobalNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitLambda(node: LambdaNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitList(node: ListNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitListComprehension(node: ListComprehensionNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitListComprehensionFor(node: ListComprehensionForNode) {
        this._log(`${this._getPrefix(node)} async:(${node.isAsync})`);
        return true;
    }

    override visitListComprehensionIf(node: ListComprehensionIfNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitMemberAccess(node: MemberAccessNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitModule(node: ModuleNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitModuleName(node: ModuleNameNode) {
        this._log(`${this._getPrefix(node)} leading dots:(${node.leadingDots}) trailing dot:(${node.hasTrailingDot})`);
        return true;
    }

    override visitName(node: NameNode) {
        this._log(`${this._getPrefix(node)} ${getTokenString(this._file, node.token, this._lines)} ${node.value}`);
        return true;
    }

    override visitNonlocal(node: NonlocalNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitNumber(node: NumberNode) {
        this._log(`${this._getPrefix(node)} ${node.value} int:(${node.isInteger}) imaginary:(${node.isImaginary})`);
        return true;
    }

    override visitParameter(node: ParameterNode) {
        this._log(`${this._getPrefix(node)} ${getParameterCategoryString(node.category)}`);
        return true;
    }

    override visitPass(node: PassNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitRaise(node: RaiseNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitReturn(node: ReturnNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitSet(node: SetNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitSlice(node: SliceNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitStatementList(node: StatementListNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitString(node: StringNode) {
        this._log(
            `${this._getPrefix(node)} ${getTokenString(this._file, node.token, this._lines)} ${
                node.value
            } unescape errors:(${node.hasUnescapeErrors})`
        );
        return true;
    }

    override visitStringList(node: StringListNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitSuite(node: SuiteNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitTuple(node: TupleNode) {
        this._log(`${this._getPrefix(node)} paren:(${node.enclosedInParens})`);
        return true;
    }

    override visitTry(node: TryNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitTypeAnnotation(node: TypeAnnotationNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitUnaryOperation(node: UnaryOperationNode) {
        this._log(
            `${this._getPrefix(node)} ${getTokenString(
                this._file,
                node.operatorToken,
                this._lines
            )} ${getOperatorTypeString(node.operator)}`
        );
        return true;
    }

    override visitUnpack(node: UnpackNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitWhile(node: WhileNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitWith(node: WithNode) {
        this._log(`${this._getPrefix(node)} async:(${node.isAsync})`);
        return true;
    }

    override visitWithItem(node: WithItemNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitYield(node: YieldNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitYieldFrom(node: YieldFromNode) {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitCase(node: CaseNode): boolean {
        this._log(`${this._getPrefix(node)} isIrrefutable: ${node.isIrrefutable}`);
        return true;
    }

    override visitMatch(node: MatchNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitPatternAs(node: PatternAsNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitPatternCapture(node: PatternCaptureNode): boolean {
        this._log(`${this._getPrefix(node)} isStar:${node.isStar} isWildcard:${node.isWildcard}`);
        return true;
    }

    override visitPatternClass(node: PatternClassNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitPatternClassArgument(node: PatternClassArgumentNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitPatternLiteral(node: PatternLiteralNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitPatternMapping(node: PatternMappingNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitPatternMappingExpandEntry(node: PatternMappingExpandEntryNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitPatternMappingKeyEntry(node: PatternMappingKeyEntryNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitPatternSequence(node: PatternSequenceNode): boolean {
        this._log(`${this._getPrefix(node)} starEntryIndex: ${node.starEntryIndex}`);
        return true;
    }

    override visitPatternValue(node: PatternValueNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitTypeAlias(node: TypeAliasNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }

    override visitTypeParameter(node: TypeParameterNode): boolean {
        this._log(
            `${this._getPrefix(node)} typeParamCategory:${getTypeParameterCategoryString(node.typeParamCategory)}`
        );
        return true;
    }

    override visitTypeParameterList(node: TypeParameterListNode): boolean {
        this._log(`${this._getPrefix(node)}`);
        return true;
    }
}

function getTypeParameterCategoryString(type: TypeParameterCategory) {
    switch (type) {
        case TypeParameterCategory.TypeVar:
            return 'TypeVar';
        case TypeParameterCategory.TypeVarTuple:
            return 'TypeVarTuple';
        case TypeParameterCategory.ParamSpec:
            return 'ParamSpec';
    }
}

function getParameterCategoryString(type: ParameterCategory) {
    switch (type) {
        case ParameterCategory.Simple:
            return 'Simple';
        case ParameterCategory.VarArgList:
            return 'VarArgList';
        case ParameterCategory.VarArgDictionary:
            return 'VarArgDictionary';
    }
}

function getArgumentCategoryString(type: ArgumentCategory) {
    switch (type) {
        case ArgumentCategory.Simple:
            return 'Simple';
        case ArgumentCategory.UnpackedList:
            return 'UnpackedList';
        case ArgumentCategory.UnpackedDictionary:
            return 'UnpackedDictionary';
        default:
            return `Unknown Value!! (${type})`;
    }
}

function getErrorExpressionCategoryString(type: ErrorExpressionCategory) {
    switch (type) {
        case ErrorExpressionCategory.MissingIn:
            return 'MissingIn';
        case ErrorExpressionCategory.MissingElse:
            return 'MissingElse';
        case ErrorExpressionCategory.MissingExpression:
            return 'MissingExpression';
        case ErrorExpressionCategory.MissingIndexOrSlice:
            return 'MissingIndexOrSlice';
        case ErrorExpressionCategory.MissingDecoratorCallName:
            return 'MissingDecoratorCallName';
        case ErrorExpressionCategory.MissingCallCloseParen:
            return 'MissingCallCloseParen';
        case ErrorExpressionCategory.MissingIndexCloseBracket:
            return 'MissingIndexCloseBracket';
        case ErrorExpressionCategory.MissingMemberAccessName:
            return 'MissingMemberAccessName';
        case ErrorExpressionCategory.MissingTupleCloseParen:
            return 'MissingTupleCloseParen';
        case ErrorExpressionCategory.MissingListCloseBracket:
            return 'MissingListCloseBracket';
        case ErrorExpressionCategory.MissingFunctionParameterList:
            return 'MissingFunctionParameterList';
        case ErrorExpressionCategory.MissingPattern:
            return 'MissingPattern';
        case ErrorExpressionCategory.MissingPatternSubject:
            return 'MissingPatternSubject';
        case ErrorExpressionCategory.MissingDictValue:
            return 'MissingDictValue';
        case ErrorExpressionCategory.MaxDepthExceeded:
            return 'MaxDepthExceeded';
        default:
            return `Unknown Value!! (${type})`;
    }
}

function getTokenString(file: string, token: Token, lines: TextRangeCollection<TextRange>) {
    const pos = convertOffsetToPosition(token.start, lines);
    let str = `'${file}:${pos.line + 1}:${pos.character + 1}' (`;
    str += getTokenTypeString(token.type);
    str += getNewLineInfo(token);
    str += getOperatorInfo(token);
    str += getKeywordInfo(token);
    str += getStringTokenFlags(token);
    str += `, ${getTextSpanString(token, lines)}`;
    str += ') ';
    str += JSON.stringify(token);

    return str;

    function getNewLineInfo(t: any) {
        return t.newLineType ? `, ${getNewLineTypeString(t.newLineType)}` : '';
    }

    function getOperatorInfo(t: any) {
        return t.operatorType ? `, ${getOperatorTypeString(t.operatorType)}` : '';
    }

    function getKeywordInfo(t: any) {
        return t.keywordType ? `, ${getKeywordTypeString(t.keywordType)}` : '';
    }

    function getStringTokenFlags(t: any) {
        return t.flags ? `, [${getStringTokenFlagsString(t.flags)}]` : '';
    }
}

function getTextSpanString(span: TextRange, lines: TextRangeCollection<TextRange>) {
    const range = convertOffsetsToRange(span.start, TextRange.getEnd(span), lines);
    return `(${range.start.line},${range.start.character})-(${range.end.line},${range.end.character})`;
}

function getTokenTypeString(type: TokenType) {
    switch (type) {
        case TokenType.Invalid:
            return 'Invalid';
        case TokenType.EndOfStream:
            return 'EndOfStream';
        case TokenType.NewLine:
            return 'NewLine';
        case TokenType.Indent:
            return 'Indent';
        case TokenType.Dedent:
            return 'Dedent';
        case TokenType.String:
            return 'String';
        case TokenType.Number:
            return 'Number';
        case TokenType.Identifier:
            return 'Identifier';
        case TokenType.Keyword:
            return 'Keyword';
        case TokenType.Operator:
            return 'Operator';
        case TokenType.Colon:
            return 'Colon';
        case TokenType.Semicolon:
            return 'Semicolon';
        case TokenType.Comma:
            return 'Comma';
        case TokenType.OpenParenthesis:
            return 'OpenParenthesis';
        case TokenType.CloseParenthesis:
            return 'CloseParenthesis';
        case TokenType.OpenBracket:
            return 'OpenBracket';
        case TokenType.CloseBracket:
            return 'CloseBracket';
        case TokenType.OpenCurlyBrace:
            return 'OpenCurlyBrace';
        case TokenType.CloseCurlyBrace:
            return 'CloseCurlyBrace';
        case TokenType.Ellipsis:
            return 'Ellipsis';
        case TokenType.Dot:
            return 'Dot';
        case TokenType.Arrow:
            return 'Arrow';
        case TokenType.Backtick:
            return 'Backtick';
        default:
            return `Unknown Value!! (${type})`;
    }
}

function getNewLineTypeString(type: NewLineType) {
    switch (type) {
        case NewLineType.CarriageReturn:
            return 'CarriageReturn';
        case NewLineType.LineFeed:
            return 'LineFeed';
        case NewLineType.CarriageReturnLineFeed:
            return 'CarriageReturnLineFeed';
        case NewLineType.Implied:
            return 'Implied';
        default:
            return `Unknown Value!! (${type})`;
    }
}

function getOperatorTypeString(type: OperatorType) {
    switch (type) {
        case OperatorType.Add:
            return 'Add';
        case OperatorType.AddEqual:
            return 'AddEqual';
        case OperatorType.Assign:
            return 'Assign';
        case OperatorType.BitwiseAnd:
            return 'BitwiseAnd';
        case OperatorType.BitwiseAndEqual:
            return 'BitwiseAndEqual';
        case OperatorType.BitwiseInvert:
            return 'BitwiseInvert';
        case OperatorType.BitwiseOr:
            return 'BitwiseOr';
        case OperatorType.BitwiseOrEqual:
            return 'BitwiseOrEqual';
        case OperatorType.BitwiseXor:
            return 'BitwiseXor';
        case OperatorType.BitwiseXorEqual:
            return 'BitwiseXorEqual';
        case OperatorType.Divide:
            return 'Divide';
        case OperatorType.DivideEqual:
            return 'DivideEqual';
        case OperatorType.Equals:
            return 'Equals';
        case OperatorType.FloorDivide:
            return 'FloorDivide';
        case OperatorType.FloorDivideEqual:
            return 'FloorDivideEqual';
        case OperatorType.GreaterThan:
            return 'GreaterThan';
        case OperatorType.GreaterThanOrEqual:
            return 'GreaterThanOrEqual';
        case OperatorType.LeftShift:
            return 'LeftShift';
        case OperatorType.LeftShiftEqual:
            return 'LeftShiftEqual';
        case OperatorType.LessOrGreaterThan:
            return 'LessOrGreaterThan';
        case OperatorType.LessThan:
            return 'LessThan';
        case OperatorType.LessThanOrEqual:
            return 'LessThanOrEqual';
        case OperatorType.MatrixMultiply:
            return 'MatrixMultiply';
        case OperatorType.MatrixMultiplyEqual:
            return 'MatrixMultiplyEqual';
        case OperatorType.Mod:
            return 'Mod';
        case OperatorType.ModEqual:
            return 'ModEqual';
        case OperatorType.Multiply:
            return 'Multiply';
        case OperatorType.MultiplyEqual:
            return 'MultiplyEqual';
        case OperatorType.NotEquals:
            return 'NotEquals';
        case OperatorType.Power:
            return 'Power';
        case OperatorType.PowerEqual:
            return 'PowerEqual';
        case OperatorType.RightShift:
            return 'RightShift';
        case OperatorType.RightShiftEqual:
            return 'RightShiftEqual';
        case OperatorType.Subtract:
            return 'Subtract';
        case OperatorType.SubtractEqual:
            return 'SubtractEqual';
        case OperatorType.Walrus:
            return 'Walrus';
        case OperatorType.And:
            return 'And';
        case OperatorType.Or:
            return 'Or';
        case OperatorType.Not:
            return 'Not';
        case OperatorType.Is:
            return 'Is';
        case OperatorType.IsNot:
            return 'IsNot';
        case OperatorType.In:
            return 'In';
        case OperatorType.NotIn:
            return 'NotIn';
        default:
            return `Unknown Value!! (${type})`;
    }
}

function getKeywordTypeString(type: KeywordType) {
    switch (type) {
        case KeywordType.And:
            return 'And';
        case KeywordType.As:
            return 'As';
        case KeywordType.Assert:
            return 'Assert';
        case KeywordType.Async:
            return 'Async';
        case KeywordType.Await:
            return 'Await';
        case KeywordType.Break:
            return 'Break';
        case KeywordType.Class:
            return 'Class';
        case KeywordType.Continue:
            return 'Continue';
        case KeywordType.Debug:
            return 'Debug';
        case KeywordType.Def:
            return 'Def';
        case KeywordType.Del:
            return 'Del';
        case KeywordType.Elif:
            return 'Elif';
        case KeywordType.Else:
            return 'Else';
        case KeywordType.Except:
            return 'Except';
        case KeywordType.False:
            return 'False';
        case KeywordType.Finally:
            return 'Finally';
        case KeywordType.For:
            return 'For';
        case KeywordType.From:
            return 'From';
        case KeywordType.Global:
            return 'Global';
        case KeywordType.If:
            return 'If';
        case KeywordType.Import:
            return 'Import';
        case KeywordType.In:
            return 'In';
        case KeywordType.Is:
            return 'Is';
        case KeywordType.Lambda:
            return 'Lambda';
        case KeywordType.None:
            return 'None';
        case KeywordType.Nonlocal:
            return 'Nonlocal';
        case KeywordType.Not:
            return 'Not';
        case KeywordType.Or:
            return 'Or';
        case KeywordType.Pass:
            return 'Pass';
        case KeywordType.Raise:
            return 'Raise';
        case KeywordType.Return:
            return 'Return';
        case KeywordType.True:
            return 'True';
        case KeywordType.Try:
            return 'Try';
        case KeywordType.While:
            return 'While';
        case KeywordType.With:
            return 'With';
        case KeywordType.Yield:
            return 'Yield';
        default:
            return `Unknown Value!! (${type})`;
    }
}

const StringTokenFlagsStrings: [StringTokenFlags, string][] = [
    [StringTokenFlags.Bytes, 'Bytes'],
    [StringTokenFlags.DoubleQuote, 'DoubleQuote'],
    [StringTokenFlags.ExceedsMaxSize, 'ExceedsMaxSize'],
    [StringTokenFlags.Format, 'Format'],
    [StringTokenFlags.Raw, 'Raw'],
    [StringTokenFlags.SingleQuote, 'SingleQuote'],
    [StringTokenFlags.Triplicate, 'Triplicate'],
    [StringTokenFlags.Unicode, 'Unicode'],
    [StringTokenFlags.Unterminated, 'Unterminated'],
];

function getStringTokenFlagsString(flags: StringTokenFlags) {
    return getFlagEnumString(StringTokenFlagsStrings, flags);
}
