import * as debug from '../common/debug';
import { ExpressionNode, getParserStringAnnotation, ParseNode, ParseNodeType, StringListNode } from './parseNodes';

export type StringAnnotationProvider = (node: StringListNode) => ExpressionNode | undefined;

export function getChildNodes(
    node: ParseNode,
    getStringAnnotation: StringAnnotationProvider = getParserStringAnnotation
): (ParseNode | undefined)[] {
    switch (node.nodeType) {
        case ParseNodeType.Error:
            return [...(node.d.decorators ?? []), node.d.child];

        case ParseNodeType.Argument:
            return [node.d.name, node.d.valueExpr];

        case ParseNodeType.Assert:
            return [node.d.testExpr, node.d.exceptionExpr];

        case ParseNodeType.AssignmentExpression:
            return [node.d.name, node.d.rightExpr];

        case ParseNodeType.Assignment:
            return [node.d.leftExpr, node.d.rightExpr, node.d.annotationComment];

        case ParseNodeType.AugmentedAssignment:
            return [node.d.leftExpr, node.d.rightExpr];

        case ParseNodeType.Await:
            return [node.d.expr];

        case ParseNodeType.BinaryOperation:
            return [node.d.leftExpr, node.d.rightExpr];

        case ParseNodeType.Break:
            return [];

        case ParseNodeType.Call:
            return [node.d.leftExpr, ...node.d.args];

        case ParseNodeType.Case:
            return [node.d.pattern, node.d.guardExpr, node.d.suite];

        case ParseNodeType.Class:
            return [...node.d.decorators, node.d.name, node.d.typeParams, ...node.d.arguments, node.d.suite];

        case ParseNodeType.Comprehension:
            return [node.d.expr, ...node.d.forIfNodes];

        case ParseNodeType.ComprehensionFor:
            return [node.d.targetExpr, node.d.iterableExpr];

        case ParseNodeType.ComprehensionIf:
            return [node.d.testExpr];

        case ParseNodeType.Constant:
            return [];

        case ParseNodeType.Continue:
            return [];

        case ParseNodeType.Decorator:
            return [node.d.expr];

        case ParseNodeType.Del:
            return node.d.targets;

        case ParseNodeType.Dictionary:
            return node.d.items;

        case ParseNodeType.DictionaryExpandEntry:
            return [node.d.expr];

        case ParseNodeType.DictionaryKeyEntry:
            return [node.d.keyExpr, node.d.valueExpr];

        case ParseNodeType.Ellipsis:
            return [];

        case ParseNodeType.If:
            return [node.d.testExpr, node.d.ifSuite, node.d.elseSuite];

        case ParseNodeType.Import:
            return node.d.list;

        case ParseNodeType.ImportAs:
            return [node.d.module, node.d.alias];

        case ParseNodeType.ImportFrom:
            return [node.d.module, ...node.d.imports];

        case ParseNodeType.ImportFromAs:
            return [node.d.name, node.d.alias];

        case ParseNodeType.Index:
            return [node.d.leftExpr, ...node.d.items];

        case ParseNodeType.Except:
            return [node.d.typeExpr, node.d.name, node.d.exceptSuite];

        case ParseNodeType.For:
            return [node.d.targetExpr, node.d.iterableExpr, node.d.forSuite, node.d.elseSuite];

        case ParseNodeType.FormatString:
            return [...node.d.fieldExprs, ...(node.d.formatExprs ?? [])];

        case ParseNodeType.Function:
            return [
                ...node.d.decorators,
                node.d.name,
                node.d.typeParams,
                ...node.d.params,
                node.d.returnAnnotation,
                node.d.funcAnnotationComment,
                node.d.suite,
            ];

        case ParseNodeType.FunctionAnnotation:
            return [...node.d.paramAnnotations, node.d.returnAnnotation];

        case ParseNodeType.Global:
            return node.d.targets;

        case ParseNodeType.Lambda:
            return [...node.d.params, node.d.expr];

        case ParseNodeType.List:
            return node.d.items;

        case ParseNodeType.Match:
            return [node.d.expr, ...node.d.cases];

        case ParseNodeType.MemberAccess:
            return [node.d.leftExpr, node.d.member];

        case ParseNodeType.ModuleName:
            return node.d.nameParts;

        case ParseNodeType.Module:
            return [...node.d.statements];

        case ParseNodeType.Name:
            return [];

        case ParseNodeType.Nonlocal:
            return node.d.targets;

        case ParseNodeType.Number:
            return [];

        case ParseNodeType.Parameter:
            return [node.d.name, node.d.annotation, node.d.annotationComment, node.d.defaultValue];

        case ParseNodeType.Pass:
            return [];

        case ParseNodeType.PatternAs:
            return [...node.d.orPatterns, node.d.target];

        case ParseNodeType.PatternClass:
            return [node.d.className, ...node.d.args];

        case ParseNodeType.PatternClassArgument:
            return [node.d.name, node.d.pattern];

        case ParseNodeType.PatternCapture:
            return [node.d.target];

        case ParseNodeType.PatternLiteral:
            return [node.d.expr];

        case ParseNodeType.PatternMappingExpandEntry:
            return [node.d.target];

        case ParseNodeType.PatternMappingKeyEntry:
            return [node.d.keyPattern, node.d.valuePattern];

        case ParseNodeType.PatternMapping:
            return [...node.d.entries];

        case ParseNodeType.PatternSequence:
            return [...node.d.entries];

        case ParseNodeType.PatternValue:
            return [node.d.expr];

        case ParseNodeType.Raise:
            return [node.d.expr, node.d.fromExpr];

        case ParseNodeType.Return:
            return [node.d.expr];

        case ParseNodeType.Set:
            return node.d.items;

        case ParseNodeType.Slice:
            return [node.d.startValue, node.d.endValue, node.d.stepValue];

        case ParseNodeType.StatementList:
            return node.d.statements;

        case ParseNodeType.StringList:
            return [getStringAnnotation(node), ...node.d.strings];

        case ParseNodeType.String:
            return [];

        case ParseNodeType.Suite:
            return [...node.d.statements];

        case ParseNodeType.Ternary:
            return [node.d.ifExpr, node.d.testExpr, node.d.elseExpr];

        case ParseNodeType.Tuple:
            return node.d.items;

        case ParseNodeType.Try:
            return [node.d.trySuite, ...node.d.exceptClauses, node.d.elseSuite, node.d.finallySuite];

        case ParseNodeType.TypeAlias:
            return [node.d.name, node.d.typeParams, node.d.expr];

        case ParseNodeType.TypeAnnotation:
            return [node.d.valueExpr, node.d.annotation];

        case ParseNodeType.TypeParameter:
            return [node.d.name, node.d.boundExpr, node.d.defaultExpr];

        case ParseNodeType.TypeParameterList:
            return [...node.d.params];

        case ParseNodeType.UnaryOperation:
            return [node.d.expr];

        case ParseNodeType.Unpack:
            return [node.d.expr];

        case ParseNodeType.While:
            return [node.d.testExpr, node.d.whileSuite, node.d.elseSuite];

        case ParseNodeType.With:
            return [...node.d.withItems, node.d.suite];

        case ParseNodeType.WithItem:
            return [node.d.expr, node.d.target];

        case ParseNodeType.Yield:
            return [node.d.expr];

        case ParseNodeType.YieldFrom:
            return [node.d.expr];

        default:
            debug.assertNever(node, `Unknown node type ${node}`);
    }
}
