import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { isDunderName } from '../analyzer/symbolNameUtils';
import { FunctionType, Type, isAny, isClass, isParamSpec, isTypeVar } from '../analyzer/types';
import { ProgramView } from '../common/extensibility';
import {
    AssignmentNode,
    CallNode,
    FunctionNode,
    MemberAccessNode,
    NameNode,
    ParameterCategory,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { isLiteralType } from './typeUtils';

export type TypeInlayHintsItemType = {
    inlayHintType: 'variable' | 'functionReturn' | 'parameter';
    position: number;
    value: string;
};
// Don't generate inlay hints for arguments to builtin types and functions
const ignoredBuiltinTypes = new Set(
    [
        'builtins.bool',
        'builtins.bytes',
        'builtins.bytearray',
        'builtins.float',
        'builtins.int',
        'builtins.list',
        'builtins.memoryview',
        'builtins.str',
        'builtins.tuple',
        'builtins.range',
        'builtins.enumerate',
        'builtins.map',
        'builtins.filter',
        'builtins.slice',
        'builtins.type',
        'builtins.reversed',
        'builtins.zip',
    ].flatMap((v) => [`${v}.__new__`, `${v}.__init__`])
);
const ignoredBuiltinFunctions = new Set([
    'builtins.len',
    'builtins.max',
    'builtins.min',
    'builtins.next',
    'builtins.repr',
    'builtins.setattr',
    'builtins.getattr',
    'builtins.hasattr',
    'builtins.sorted',
    'builtins.isinstance',
    'builtins.id',
    'builtins.iter',
]);

function isIgnoredBuiltin(type: FunctionType): boolean {
    if (type.details.moduleName !== 'builtins') {
        return false;
    }
    const funcName = type.details.name;
    if (funcName === '__new__' || funcName === '__init__') {
        return ignoredBuiltinTypes.has(type.details.fullName);
    }
    return ignoredBuiltinFunctions.has(type.details.fullName);
}

function isLeftSideOfAssignment(node: ParseNode): boolean {
    if (node.parent?.nodeType !== ParseNodeType.Assignment) {
        return false;
    }
    return node.start < (node.parent as AssignmentNode).rightExpression.start;
}

export class TypeInlayHintsWalker extends ParseTreeWalker {
    featureItems: TypeInlayHintsItemType[] = [];

    constructor(private readonly _program: ProgramView) {
        super();
    }

    override visitName(node: NameNode): boolean {
        if (isLeftSideOfAssignment(node) && !isDunderName(node.value)) {
            const type = this._program.evaluator?.getType(node);
            if (
                type &&
                !isAny(type) &&
                !(isClass(type) && isLiteralType(type)) &&
                !isTypeVar(type) &&
                !isParamSpec(type)
            ) {
                this.featureItems.push({
                    inlayHintType: 'variable',
                    position: node.start + node.length,
                    value: `: ${this._printType(type)}`,
                });
            }
        }
        return super.visitName(node);
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        if (isLeftSideOfAssignment(node) && !isDunderName(node.memberName.value)) {
            this.featureItems.push({
                inlayHintType: 'variable',
                position: node.memberName.start,
                value: node.memberName.value,
            });
        }
        return super.visitMemberAccess(node);
    }

    override visitCall(node: CallNode): boolean {
        this._generateHintsForCallNode(node);
        return super.visitCall(node);
    }

    override visitFunction(node: FunctionNode): boolean {
        const evaluator = this._program.evaluator;
        const functionType = evaluator?.getTypeOfFunction(node)?.functionType;
        if (functionType !== undefined && !functionType.details.declaredReturnType) {
            const inferredReturnType = evaluator?.getFunctionInferredReturnType(functionType);
            if (inferredReturnType) {
                this.featureItems.push({
                    inlayHintType: 'functionReturn',
                    position: node.suite.start,
                    value: `-> ${this._printType(inferredReturnType)}`,
                });
            }
        }
        return super.visitFunction(node);
    }

    private _generateHintsForCallNode(node: CallNode) {
        const matchedArgs = this._program.evaluator?.matchCallArgsToParams(node);
        if (!matchedArgs) {
            return;
        }
        // sort matches by relevance and use the most relevant match
        matchedArgs.sort((r1, r2) => r2.match.relevance - r1.match.relevance);
        const result = matchedArgs[0];

        if (result.match.argumentErrors) {
            return;
        }
        if (isIgnoredBuiltin(result.type)) {
            return;
        }

        for (const p of result.match.argParams) {
            // If the argument is specified as a keyword argument, there is no need to generate a hint
            if (p.argument.name) {
                continue;
            }
            const argNode = p.argument.valueExpression;
            if (!argNode) {
                continue;
            }
            const funcParam = result.type.details.parameters.find((a) => a.name && a.name === p.paramName);
            if (funcParam?.category !== ParameterCategory.Simple) {
                continue;
            }
            // Arguments starting with double underscores usually come from type stubs,
            // they're probably not very informative. If necessary, an option can be added
            // whether to hide such names or not.
            if (p.paramName?.startsWith('__')) {
                continue;
            }
            if (p.paramName === p.argument.name) {
                continue;
            }
            if (p.paramName) {
                this.featureItems.push({
                    inlayHintType: 'parameter',
                    position: argNode.start,
                    value: `${p.paramName}=`,
                });
            }
        }
    }

    private _printType = (type: Type): string =>
        this._program.evaluator!.printType(type, { enforcePythonSyntax: true });
}
