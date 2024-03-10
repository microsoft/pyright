import { ParseTreeWalker } from './parseTreeWalker';
import { TypeEvaluator } from './typeEvaluatorTypes';
import { ClassTypeFlags, FunctionType, OverloadedFunctionType, TypeCategory, TypeFlags } from './types';
import { ClassNode, FunctionNode, ImportAsNode, ImportFromNode, NameNode } from '../parser/parseNodes';
import { SemanticTokenModifiers, SemanticTokenTypes } from 'vscode-languageserver';

type SemanticTokenItem = {
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

    override visitImportFrom(node: ImportFromNode): boolean {
        for (const part of node.module.nameParts) {
            this._addItem(part.start, part.length, SemanticTokenTypes.namespace, []);
        }
        return super.visitImportFrom(node);
    }

    override visitName(node: NameNode): boolean {
        const type = this._evaluator?.getType(node);
        switch (type?.category) {
            case TypeCategory.Function:
                {
                    if ((type as FunctionType).details.declaration?.isMethod) {
                        this._addItem(node.start, node.length, SemanticTokenTypes.method, []);
                    } else {
                        this._addItem(node.start, node.length, SemanticTokenTypes.function, []);
                    }
                }
                break;

            case TypeCategory.OverloadedFunction:
                {
                    const funcType = OverloadedFunctionType.getOverloads(type)[0];
                    if (funcType.details.declaration?.isMethod) {
                        this._addItem(node.start, node.length, SemanticTokenTypes.method, []);
                    } else {
                        this._addItem(node.start, node.length, SemanticTokenTypes.function, []);
                    }
                }
                break;

            case TypeCategory.Module:
                this._addItem(node.start, node.length, SemanticTokenTypes.namespace, []);
                break;
            case TypeCategory.Union:
                this._addItem(node.start, node.length, SemanticTokenTypes.type, []);
                break;
            case TypeCategory.Unbound:
            case undefined:
                break;
            case TypeCategory.TypeVar:
                this._addItem(node.start, node.length, SemanticTokenTypes.typeParameter, []);
                break;
            case TypeCategory.Class:
                if (!(type.flags & TypeFlags.Instance)) {
                    this._addItem(node.start, node.length, SemanticTokenTypes.class, []);
                    break;
                }
            // eslint-disable-next-line no-fallthrough -- intentional
            default:
                if ((type && type.flags & ClassTypeFlags.Final) || node.value.toUpperCase() === node.value) {
                    this._addItem(node.start, node.length, SemanticTokenTypes.variable, [
                        SemanticTokenModifiers.readonly,
                    ]);
                } else {
                    this._addItem(node.start, node.length, SemanticTokenTypes.variable, []);
                }
        }
        return super.visitName(node);
    }

    private _addItem(start: number, length: number, type: string, modifiers: string[]) {
        this.items.push({ type, modifiers, start, length });
    }
}
