import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { CallSignature } from '../analyzer/typeEvaluatorTypes';
import { ProgramView } from '../common/extensibility';
import {
    AssignmentNode,
    CallNode,
    FunctionNode,
    MemberAccessNode,
    NameNode,
    ParameterCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

type TypeInlayHintsItemType = {
    inlayHintType: 'variable' | 'functionReturn' | 'parameter';
    startOffset: number;
    endOffset: number;
    value?: string;
};
// Don't generate inlay hints for arguments to builtin types and functions
const ignoredBuiltinTypes = [
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
];
const ignoredBuiltinFunctions = [
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
];

function isIgnoredBuiltin(sig: CallSignature): boolean {
    if (sig.type.details.moduleName !== 'builtins') {
        return false;
    }
    const funcName = sig.type.details.name;
    if (funcName === '__new__' || funcName === '__init__') {
        return ignoredBuiltinTypes.some((v) => `${v}.${funcName}` === sig.type.details.fullName);
    }
    return ignoredBuiltinFunctions.some((v) => v === sig.type.details.fullName);
}

function isDunder(name: string): boolean {
    return name.length != 2 && name.startsWith('__') && name.endsWith('__');
}

function isLeftSideOfAssignment(node: ParseNode): boolean {
    if (node.parent?.nodeType !== ParseNodeType.Assignment) {
        return false;
    }
    return node.start < (node.parent as AssignmentNode).rightExpression.start;
}

export class TypeInlayHintsWalker extends ParseTreeWalker {
    featureItems: TypeInlayHintsItemType[] = [];

    constructor(private readonly _program: ProgramView, private readonly _parseResults: ParseResults) {
        super();
    }

    override visitName(node: NameNode): boolean {
        if (isLeftSideOfAssignment(node) && !isDunder(node.value)) {
            this.featureItems.push({
                inlayHintType: 'variable',
                startOffset: node.start,
                endOffset: node.start + node.length - 1,
                value: node.value,
            });
        }
        return super.visitName(node);
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        if (isLeftSideOfAssignment(node) && !isDunder(node.memberName.value)) {
            this.featureItems.push({
                inlayHintType: 'variable',
                startOffset: node.memberName.start,
                endOffset: node.memberName.start + node.memberName.length - 1,
                value: node.memberName.value,
            });
        }
        return super.visitMemberAccess(node);
    }

    getFunctionParametersFromNode(node: CallNode): ParameterNode[] | undefined {
        const funcName = (node.leftExpression as NameNode).value;
        const result = this._program.evaluator?.lookUpSymbolRecursive(node.leftExpression, funcName, false);
        const declarations = result?.symbol.getTypedDeclarations();
        if (!declarations || declarations.length === 0) {
            return undefined;
        }
        const decl = declarations[0];
        if (decl.node.nodeType === ParseNodeType.Function) {
            return decl.node.parameters;
        }
        return undefined;
    }

    _generateHintsForCallNode(node: CallNode) {
        const matchedArgs = this._program.evaluator?.matchCallArgsToParams(node);
        if (!matchedArgs) {
            return;
        }
        // sort matches by relevance and use the most relevant match
        matchedArgs.sort((r1, r2) => r2.relevance - r1.relevance);
        const match = matchedArgs[0];

        if (match.argumentErrors) {
            return;
        }

        for (const p of match.argParams) {
            const argNode = p.argument.valueExpression;
            if (!argNode) {
                continue;
            }
            // If the argument is specified as a keyword argument, there is no need to generate a hint
            if (p.argument.name) {
                continue;
            }
            if (p.paramCategory !== ParameterCategory.Simple) {
                continue;
            }
            // Arguments starting with double underscores usually come from type stubs,
            // they're probably not very informative. If necessary, an option can be added
            // whether to hide such names or not.
            if (p.paramName?.startsWith('__')) {
                continue;
            }
            if (p.paramName) {
                this.featureItems.push({
                    inlayHintType: 'parameter',
                    startOffset: argNode.start,
                    endOffset: argNode.start + argNode.length - 1,
                    value: p.paramName,
                });
            }
        }
    }

    override visitCall(node: CallNode): boolean {
        this._generateHintsForCallNode(node);
        return super.visitCall(node);
    }

    override visitFunction(node: FunctionNode): boolean {
        if (!node.returnTypeAnnotation) {
            this.featureItems.push({
                inlayHintType: 'functionReturn',
                startOffset: node.name.start,
                endOffset: node.suite.start,
                value: node.name.value,
            });
        }
        return super.visitFunction(node);
    }
}
