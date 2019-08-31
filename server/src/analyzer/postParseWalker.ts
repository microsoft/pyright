/*
* postParseWalker.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A parse tree walker that's used immediately after generating
* the parse tree, effectively as an extension of the parser.
* It does the following:
*   Adds parent links to all parse tree nodes
*   Builds nameBindings for module, class, function and lambda scopes
*   Reports name binding inconsistencies (e.g. if a name is bound
*       both locally and globally)
*   Builds a list of imported modules
*/

import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { NameBindings, NameBindingType } from '../parser/nameBindings';
import { AssignmentNode, ClassNode, DelNode, ExpressionNode,
    ForNode, FunctionNode, GlobalNode, ImportAsNode, ImportFromAsNode,
    ImportFromNode, LambdaNode, ListNode, ModuleNameNode, ModuleNode, NameNode,
    NonlocalNode, ParseNode, TupleExpressionNode, TypeAnnotationExpressionNode,
    UnpackExpressionNode, WithNode } from '../parser/parseNodes';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ParseTreeWalker } from './parseTreeWalker';

export interface ModuleImport {
    nameNode: ModuleNameNode;
    leadingDots: number;
    nameParts: string[];

    // Used for "from X import Y" pattern. An empty
    // array implies "from X import *".
    importedSymbols: string[] | undefined;
}

export class PostParseWalker extends ParseTreeWalker {
    private _parseTree: ModuleNode;
    private _diagnosticSink: TextRangeDiagnosticSink;
    private _importedModules: ModuleImport[] = [];
    private _currentNameBindings: NameBindings;
    private _currentBindingType: NameBindingType;

    constructor(diagSink: TextRangeDiagnosticSink, parseTree: ModuleNode) {
        super();

        this._diagnosticSink = diagSink;
        this._parseTree = parseTree;

        const moduleNameBindings = new NameBindings(
            NameBindingType.Global, undefined);
        AnalyzerNodeInfo.setNameBindings(parseTree, moduleNameBindings);
        this._currentNameBindings = moduleNameBindings;
        this._currentBindingType = NameBindingType.Global;
    }

    analyze() {
        this.walk(this._parseTree);
    }

    getImportedModules(): ModuleImport[] {
        return this._importedModules;
    }

    visitNode(node: ParseNode): boolean {
        const children = node.getChildren();

        // Add the parent link to each of the child nodes.
        children.forEach(child => {
            if (child) {
                child.parent = node;
            }
        });

        return super.visitNode(node);
    }

    visitImportAs(node: ImportAsNode): boolean {
        if (node.alias) {
            this._addName(node.alias.nameToken.value);
        } else if (node.module.nameParts.length > 0) {
            this._addName(node.module.nameParts[0].nameToken.value);
        }

        this._importedModules.push({
            nameNode: node.module,
            leadingDots: node.module.leadingDots,
            nameParts: node.module.nameParts.map(p => p.nameToken.value),
            importedSymbols: undefined
        });

        return true;
    }

    visitImportFrom(node: ImportFromNode): boolean {
        this._importedModules.push({
            nameNode: node.module,
            leadingDots: node.module.leadingDots,
            nameParts: node.module.nameParts.map(p => p.nameToken.value),
            importedSymbols: node.imports.map(imp => imp.name.nameToken.value)
        });

        return true;
    }

    visitImportFromAs(node: ImportFromAsNode): boolean {
        if (node.alias) {
            this._addName(node.alias.nameToken.value);
        } else {
            this._addName(node.name.nameToken.value);
        }

        return false;
    }

    visitWith(node: WithNode): boolean {
        node.withItems.forEach(item => {
            this.walk(item);
        });

        node.withItems.forEach(item => {
            if (item.target) {
                this._addPossibleTupleNamedTarget(item.target);
            }
        });

        this.walk(node.suite);
        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        const nameBindings = new NameBindings(
            NameBindingType.Local, this._currentNameBindings);
        AnalyzerNodeInfo.setNameBindings(node, nameBindings);

        // Decorators are executed in the scope outside the function.
        this.walkMultiple(node.decorators);

        this._addName(node.name.nameToken.value);
        this._createNewScope(nameBindings, () => {
            // Populate the new scope with parameter names.
            node.parameters.forEach(param => {
                if (param.name) {
                    this._addName(param.name.nameToken.value);
                }
            });

            this.walkMultiple(node.parameters);

            if (node.returnTypeAnnotation) {
                this.walk(node.returnTypeAnnotation);
            }

            this.walk(node.suite);
        });

        return false;
    }

    visitClass(node: ClassNode) {
        const nameBindings = new NameBindings(
            NameBindingType.Local, this._currentNameBindings);
        AnalyzerNodeInfo.setNameBindings(node, nameBindings);

        // Decorators are executed in the scope outside the class.
        this.walkMultiple(node.decorators);

        this._addName(node.name.nameToken.value);
        this._createNewScope(nameBindings, () => {
            this.walkMultiple(node.arguments);
            this.walk(node.suite);
        });

        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        const nameBindings = new NameBindings(
            NameBindingType.Local, this._currentNameBindings);
        AnalyzerNodeInfo.setNameBindings(node, nameBindings);

        this._createNewScope(nameBindings, () => {
            // Populate the new scope with parameter names.
            node.parameters.forEach(param => {
                if (param.name) {
                    this._addName(param.name.nameToken.value);
                }
            });

            this.walkMultiple(node.parameters);

            this.walk(node.expression);
        });

        return false;
    }

    visitAssignment(node: AssignmentNode) {
        this._addPossibleTupleNamedTarget(node.leftExpression);
        return true;
    }

    visitDel(node: DelNode) {
        node.expressions.forEach(expr => {
            this._addPossibleTupleNamedTarget(expr);
        });
        return true;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        this._addPossibleTupleNamedTarget(node.valueExpression);

        return true;
    }

    visitFor(node: ForNode) {
        this._addPossibleTupleNamedTarget(node.targetExpression);
        return true;
    }

    visitGlobal(node: GlobalNode) {
        node.nameList.forEach(name => {
            if (!this._currentNameBindings.addName(name.nameToken.value, NameBindingType.Global)) {
                this._diagnosticSink.addErrorWithTextRange(
                    `'${ name.nameToken.value }' is assigned before global declaration`,
                    name);
            }

            // Add it to the global scope as well, in case it's not already added there.
            if (this._currentNameBindings.getBindingType() !== NameBindingType.Global) {
                let globalScope: NameBindings | undefined = this._currentNameBindings;
                while (globalScope && globalScope.getBindingType() !== NameBindingType.Global) {
                    globalScope = globalScope.getParentScope();
                }

                if (globalScope) {
                    globalScope.addName(name.nameToken.value, NameBindingType.Global);
                }
            }
        });
        return true;
    }

    visitNonlocal(node: NonlocalNode) {
        const moduleNameBindings = AnalyzerNodeInfo.getNameBindings(this._parseTree);
        if (this._currentNameBindings === moduleNameBindings) {
            this._diagnosticSink.addErrorWithTextRange(
                'Nonlocal declaration not allowed at module level',
                node);
        } else {
            node.nameList.forEach(name => {
                if (!this._currentNameBindings.addName(name.nameToken.value, NameBindingType.Nonlocal)) {
                    this._diagnosticSink.addErrorWithTextRange(
                        `'${ name.nameToken.value }' is assigned before nonlocal declaration`,
                        name);
                }
            });
        }
        return true;
    }

    private _addPossibleTupleNamedTarget(node: ExpressionNode) {
        if (node instanceof NameNode) {
            this._addName(node.nameToken.value);
        } else if (node instanceof TupleExpressionNode) {
            node.expressions.forEach(expr => {
                this._addPossibleTupleNamedTarget(expr);
            });
        } else if (node instanceof ListNode) {
            node.entries.forEach(expr => {
                this._addPossibleTupleNamedTarget(expr);
            });
        } else if (node instanceof TypeAnnotationExpressionNode) {
            this._addPossibleTupleNamedTarget(node.valueExpression);
        } else if (node instanceof UnpackExpressionNode) {
            this._addPossibleTupleNamedTarget(node.expression);
        }
    }

    private _addName(name: string) {
        // Has this name already been added to the current scope? If not,
        // add it with the appropriate binding type.
        const scopeType = this._currentNameBindings.lookUpName(name);
        if (scopeType === undefined) {
            this._currentNameBindings.addName(name, this._currentBindingType);
        }
    }

    private _createNewScope(nameBindings: NameBindings, walkInnerScopeCallback: () => void) {
        const prevNameBindings = this._currentNameBindings;
        this._currentNameBindings = nameBindings;

        const prevBindingScope = this._currentBindingType;
        this._currentBindingType = NameBindingType.Local;

        walkInnerScopeCallback();

        this._currentNameBindings = prevNameBindings;
        this._currentBindingType = prevBindingScope;
        return false;
    }
}
