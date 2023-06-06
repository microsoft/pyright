import { getCallNodeAndActiveParameterIndex, printParseNodeType } from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { CallSignature } from '../analyzer/typeEvaluatorTypes';
import { ProgramView } from '../common/extensibility';
import {
    ArgumentNode,
    CallNode,
    FunctionNode,
    MemberAccessNode,
    NameNode,
    ParameterCategory,
    ParameterNode,
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

export class TypeInlayHintsWalker extends ParseTreeWalker {
    featureItems: TypeInlayHintsItemType[] = [];

    constructor(private readonly _program: ProgramView, private readonly _parseResults: ParseResults) {
        super();
    }

    override visitName(node: NameNode): boolean {
        if (node.parent) {
            const parentNodeType = printParseNodeType(node.parent.nodeType);
            if (parentNodeType === 'Assignment') {
                this.featureItems.push({
                    inlayHintType: 'variable',
                    startOffset: node.start,
                    endOffset: node.start + node.length - 1,
                    value: node.value,
                });
            }
        }
        return super.visitName(node);
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        if (node.parent) {
            const parentNodeType = printParseNodeType(node.parent.nodeType);
            if (parentNodeType === 'Assignment') {
                this.featureItems.push({
                    inlayHintType: 'variable',
                    startOffset: node.memberName.start,
                    endOffset: node.memberName.start + node.memberName.length - 1,
                    value: node.memberName.value,
                });
            }
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

    private getParameterNameHint(node: ArgumentNode): string | undefined {
        const result = getCallNodeAndActiveParameterIndex(node, node.start, this._parseResults.tokenizerOutput.tokens);
        if (!result?.callNode || result.callNode.arguments[result.activeIndex].name) {
            return undefined;
        }

        const signatureInfo = this._program.evaluator?.getCallSignatureInfo(
            result.callNode,
            result.activeIndex,
            result.activeOrFake
        );
        if (!signatureInfo) {
            return undefined;
        }

        const sig = signatureInfo.signatures[0];
        if (isIgnoredBuiltin(sig)) {
            return undefined;
        }

        const activeParam = sig.activeParam;
        if (activeParam?.category !== ParameterCategory.Simple) {
            return undefined;
        }

        // Arguments starting with double underscores usually come from type stubs,
        // they're probably not very informative. If necessary, an option can be added
        // whether to hide such names or not.
        if (activeParam.name?.startsWith('__')) {
            return undefined;
        }

        return activeParam.name;
    }

    override visitArgument(node: ArgumentNode): boolean {
        if (node.parent) {
            if (node.parent.nodeType === ParseNodeType.Assignment) {
                return false;
            }
            const paramName = this.getParameterNameHint(node);
            if (paramName) {
                this.featureItems.push({
                    inlayHintType: 'parameter',
                    startOffset: node.start,
                    endOffset: node.start + node.length - 1,
                    value: paramName,
                });
            }
        }
        return super.visitArgument(node);
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
