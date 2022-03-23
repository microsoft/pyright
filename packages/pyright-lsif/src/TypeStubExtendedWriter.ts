import { SourceFile } from 'pyright-internal/analyzer/sourceFile';
import { TypeEvaluator } from 'pyright-internal/analyzer/typeEvaluatorTypes';
import { isFunction, isNever, isUnknown, removeUnknownFromUnion } from 'pyright-internal/analyzer/types';
import { TypeStubWriter } from 'pyright-internal/analyzer/typeStubWriter';
import {
    ArgumentCategory,
    ClassNode,
    DecoratorNode,
    ExpressionNode,
    FunctionNode,
    ParameterCategory,
    ParameterNode,
    ParseNodeType,
} from 'pyright-internal/parser/parseNodes';

// I have to ignore the private stuff for now -- can reset this later if we want.
// @ts-ignore
export class TypeStubExtendedWriter extends TypeStubWriter {
    public docstrings: Map<number, string[]>;

    constructor(_sourceFile: SourceFile, _evaluator: TypeEvaluator) {
        super('', _sourceFile, _evaluator);

        this.docstrings = new Map<number, string[]>();
    }

    override visitClass(node: ClassNode): boolean {
        const className = node.name.value;

        this._emittedSuite = true;
        this._emitDocString = false;

        let line = '';
        line += this._printDecorators(node.decorators);
        line += `class ${className}`;

        // Remove "object" from the list, since it's implied
        const args = node.arguments.filter(
            (arg) =>
                arg.name !== undefined ||
                arg.argumentCategory !== ArgumentCategory.Simple ||
                arg.valueExpression.nodeType !== ParseNodeType.Name ||
                arg.valueExpression.value !== 'object'
        );

        if (args.length > 0) {
            line += `(${args
                .map((arg) => {
                    let argString = '';
                    if (arg.name) {
                        argString = arg.name.value + '=';
                    }
                    argString += this._printExpression(arg.valueExpression);
                    return argString;
                })
                .join(', ')})`;
        }
        line += ':';

        this.docstrings.set(node.id, [line]);

        // this._emitSuite(() => {
        //     this._classNestCount++;
        //     this.walk(node.suite);
        //     this._classNestCount--;
        // });

        return false;
    }

    override visitFunction(node: FunctionNode): boolean {
        const functionName = node.name.token.value;
        let line = '';
        line += this._printDecorators(node.decorators);
        line += node.isAsync ? 'async ' : '';
        line += `def ${functionName}`;
        line += `(${node.parameters.map((param, index) => this._printParameter(param, node, index)).join(', ')})`;

        let returnAnnotation: string | undefined;
        if (node.returnTypeAnnotation) {
            // returnAnnotation = this._printExpression(node.returnTypeAnnotation, /* treatStringsAsSymbols */ true);
        } else if (node.functionAnnotationComment) {
            // returnAnnotation = this._printExpression(
            //     node.functionAnnotationComment.returnTypeAnnotation,
            //     /* treatStringsAsSymbols */ true
            // );
        } else {
            // Handle a few common cases where we always know the answer.
            if (node.name.value === '__init__') {
                returnAnnotation = 'None';
            } else if (node.name.value === '__str__') {
                returnAnnotation = 'str';
            } else if (['__int__', '__hash__'].some((name) => name === node.name.value)) {
                returnAnnotation = 'int';
            } else if (
                ['__eq__', '__ne__', '__gt__', '__lt__', '__ge__', '__le__'].some((name) => name === node.name.value)
            ) {
                returnAnnotation = 'bool';
            }
        }

        if (returnAnnotation) {
            line += ' -> ' + returnAnnotation;
        }

        line += ':';

        // If there was not return type annotation, see if we can infer
        // a type that is not unknown and add it as a comment.
        if (!returnAnnotation) {
            const functionType = this._evaluator.getTypeOfFunction(node);
            if (functionType && isFunction(functionType.functionType)) {
                let returnType = this._evaluator.getFunctionInferredReturnType(functionType.functionType);
                returnType = removeUnknownFromUnion(returnType);
                if (!isNever(returnType) && !isUnknown(returnType)) {
                    line += ` # -> ${this._evaluator.printType(returnType, /* expandTypeAlias */ false)}:`;
                }
            }
        }

        this.docstrings.set(node.id, [line]);

        return true;
    }

    private override _printParameter(paramNode: ParameterNode, functionNode: FunctionNode, paramIndex: number): string {
        let line = '';
        if (paramNode.category === ParameterCategory.VarArgList) {
            line += '*';
        } else if (paramNode.category === ParameterCategory.VarArgDictionary) {
            line += '**';
        }

        if (paramNode.name) {
            line += paramNode.name.value;
        }

        const paramTypeAnnotation = this._evaluator.getTypeAnnotationForParameter(functionNode, paramIndex);
        let paramType = '';
        if (paramTypeAnnotation) {
            paramType = this._printExpression(paramTypeAnnotation, /* treatStringsAsSymbols */ true);
        }

        if (paramType) {
            line += ': ' + paramType;
        }

        if (paramNode.defaultValue) {
            // Follow PEP8 spacing rules. Include spaces if type
            // annotation is present, no space otherwise.
            if (paramType) {
                line += ' = ';
            } else {
                line += '=';
            }
            line += this._printExpression(paramNode.defaultValue!, false, true);
        }

        return line;
    }

    override _printExpression(node: ExpressionNode, isType = false, treatStringsAsSymbols = false): string {
        // @ts-ignore
        return super._printExpression(node, isType, treatStringsAsSymbols);
    }

    private _printDecorators(decorators: DecoratorNode[]) {
        let line = '';
        decorators.forEach((decorator) => {
            line += '@' + this._printExpression(decorator.expression) + '\n';
        });

        return line;
    }
}
