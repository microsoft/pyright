import { ParseTreeWalker } from './parseTreeWalker';
import { TypeEvaluator } from './typeEvaluatorTypes';
import { FunctionType, OverloadedFunctionType, Type, TypeCategory, TypeFlags } from './types';
import {
    ClassNode,
    FunctionNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    NameNode,
    TypeAnnotationNode,
} from '../parser/parseNodes';
import { SemanticTokenModifiers, SemanticTokenTypes } from 'vscode-languageserver';

export type SemanticTokenItem = {
    type: string;
    modifiers: string[];
    start: number;
    length: number;
};

export class SemanticTokensWalker extends ParseTreeWalker {
    items: SemanticTokenItem[] = [];

    constructor(private readonly _evaluator?: TypeEvaluator) {
        super();
    }
    override visitClass(node: ClassNode): boolean {
        this._addItem(node.name.start, node.name.length, SemanticTokenTypes.class, [SemanticTokenModifiers.definition]);
        return super.visitClass(node);
    }

    override visitFunction(node: FunctionNode): boolean {
        const modifiers = [SemanticTokenModifiers.definition];
        if (node.isAsync) {
            modifiers.push(SemanticTokenModifiers.async);
        }
        if ((node as any).declaration.isMethod) {
            this._addItem(node.name.start, node.name.length, SemanticTokenTypes.method, modifiers);
        } else {
            this._addItem(node.name.start, node.name.length, SemanticTokenTypes.function, modifiers);
        }
        for (const param of node.parameters) {
            if (!param.name) {
                continue;
            }
            const modifiers = [SemanticTokenModifiers.declaration];
            this._addItem(param.start, param.name!.value.length, SemanticTokenTypes.parameter, modifiers);
            if (param.typeAnnotation) {
                this._addItem(
                    param.typeAnnotation.start,
                    param.typeAnnotation.length,
                    SemanticTokenTypes.typeParameter,
                    []
                );
            }
        }
        return super.visitFunction(node);
    }

    override visitImportAs(node: ImportAsNode): boolean {
        for (const part of node.module.nameParts) {
            this._addItem(part.start, part.length, SemanticTokenTypes.namespace, []);
        }
        if (node.alias) {
            this._addItem(node.alias.start, node.alias.length, SemanticTokenTypes.namespace, []);
        }
        return super.visitImportAs(node);
    }

    override visitImportFromAs(node: ImportFromAsNode): boolean {
        this._visitNameWithType(node.name, this._evaluator?.getType(node.alias ?? node.name));
        return super.visitImportFromAs(node);
    }

    override visitImportFrom(node: ImportFromNode): boolean {
        for (const part of node.module.nameParts) {
            this._addItem(part.start, part.length, SemanticTokenTypes.namespace, []);
        }
        return super.visitImportFrom(node);
    }

    override visitName(node: NameNode): boolean {
        this._visitNameWithType(node, this._evaluator?.getType(node));
        return super.visitName(node);
    }

    override visitTypeAnnotation(node: TypeAnnotationNode): boolean {
        const type = this._evaluator?.getType(node.typeAnnotation);
        if (type?.category === TypeCategory.Never) {
            this._addItem(node.typeAnnotation.start, node.typeAnnotation.length, SemanticTokenTypes.type, []);
        }
        return super.visitTypeAnnotation(node);
    }

    private _visitNameWithType(node: NameNode, type: Type | undefined) {
        switch (type?.category) {
            case TypeCategory.Function:
                {
                    if ((type as FunctionType).details.declaration?.isMethod) {
                        this._addItem(node.start, node.length, SemanticTokenTypes.method, []);
                    } else {
                        this._addItem(node.start, node.length, SemanticTokenTypes.function, []);
                    }
                }
                return;

            case TypeCategory.OverloadedFunction:
                {
                    const funcType = OverloadedFunctionType.getOverloads(type)[0];
                    if (funcType.details.declaration?.isMethod) {
                        this._addItem(node.start, node.length, SemanticTokenTypes.method, []);
                    } else {
                        this._addItem(node.start, node.length, SemanticTokenTypes.function, []);
                    }
                }
                return;

            case TypeCategory.Module:
                this._addItem(node.start, node.length, SemanticTokenTypes.namespace, []);
                return;
            case TypeCategory.Unbound:
            case undefined:
                return;
            case TypeCategory.TypeVar:
                this._addItem(node.start, node.length, SemanticTokenTypes.typeParameter, []);
                return;
            case TypeCategory.Union:
            case TypeCategory.Never:
                if (!(type.flags & TypeFlags.Instance)) {
                    this._addItem(node.start, node.length, SemanticTokenTypes.type, []);
                    return;
                }
                break;
            case TypeCategory.Class:
                //type annotations handled by visitTypeAnnotation
                if (!(type.flags & TypeFlags.Instance)) {
                    this._addItem(node.start, node.length, SemanticTokenTypes.class, []);
                    return;
                }
        }
        const symbol = this._evaluator?.lookUpSymbolRecursive(node, node.value, false)?.symbol;
        if (node.value.toUpperCase() === node.value || (symbol && this._evaluator.isFinalVariable(symbol))) {
            this._addItem(node.start, node.length, SemanticTokenTypes.variable, [SemanticTokenModifiers.readonly]);
        } else {
            this._addItem(node.start, node.length, SemanticTokenTypes.variable, []);
        }
    }

    private _addItem(start: number, length: number, type: string, modifiers: string[]) {
        this.items.push({ type, modifiers, start, length });
    }
}
