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
import { AssignmentNode, ClassNode, ExpressionNode, ForNode,
    FunctionNode, GlobalNode, ImportAsNode, ImportFromAsNode, ImportFromNode,
    LambdaNode, ListNode, ModuleNameNode, ModuleNode, NameNode, NonlocalNode,
    ParseNode, StarExpressionNode, TupleExpressionNode, TypeAnnotationExpressionNode,
    WithNode } from '../parser/parseNodes';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ParseTreeWalker } from './parseTreeWalker';

export class PostParseWalker extends ParseTreeWalker {
    private _parseTree: ModuleNode;
    private _diagnosticSink: TextRangeDiagnosticSink;
    private _isStubFile: boolean;
    private _moduleNames: ModuleNameNode[] = [];
    private _currentNameBindings: NameBindings;
    private _currentBindingType: NameBindingType;

    constructor(diagSink: TextRangeDiagnosticSink, parseTree: ModuleNode, isStubFile: boolean) {
        super();

        this._diagnosticSink = diagSink;
        this._parseTree = parseTree;
        this._isStubFile = isStubFile;

        let moduleNameBindings = new NameBindings(NameBindingType.Global);
        AnalyzerNodeInfo.setNameBindings(parseTree, moduleNameBindings);
        this._currentNameBindings = moduleNameBindings;
        this._currentBindingType = NameBindingType.Global;
    }

    analyze() {
        this.walk(this._parseTree);
    }

    getImportedModules(): ModuleNameNode[] {
        return this._moduleNames;
    }

    visitNode(node: ParseNode): boolean {
        let children = this.getChildren(node);

        // Add the parent link to each of the child nodes.
        children.forEach(child => {
            child.parent = node;
        });

        return super.visitNode(node);
    }

    visitModuleName(node: ModuleNameNode) {
        this._moduleNames.push(node);
        return true;
    }

    visitImportAs(node: ImportAsNode): boolean {
        if (node.alias) {
            this._addName(node.alias.nameToken.value);
        } else if (node.module.nameParts.length > 0) {
            this._addName(node.module.nameParts[0].nameToken.value);
        }
        return true;
    }

    visitImportFrom(node: ImportFromNode): boolean {
        if (node.imports.length === 0) {
            this._currentNameBindings.addWildcard();
        }
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
            this.walk(item.expression);
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
        let nameBindings = new NameBindings(NameBindingType.Local);
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
                this.walk(node.returnTypeAnnotation.expression);
            }

            this.walk(node.suite);
        });

        return false;
    }

    visitClass(node: ClassNode) {
        let nameBindings = new NameBindings(NameBindingType.Local);
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
        let nameBindings = new NameBindings(NameBindingType.Local);
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

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        if (this._isStubFile) {
            this._addPossibleTupleNamedTarget(node.valueExpression);
        }

        // Don't walk the type annotation node in this pass.
        this.walk(node.valueExpression);

        return false;
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
        });
        return true;
    }

    visitNonlocal(node: NonlocalNode) {
        let moduleNameBindings = AnalyzerNodeInfo.getNameBindings(this._parseTree);
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
        if (node instanceof TupleExpressionNode) {
            node.expressions.forEach(expr => {
                this._addPossibleTupleNamedTarget(expr);
            });
        } else if (node instanceof ListNode) {
            node.entries.forEach(expr => {
                this._addPossibleTupleNamedTarget(expr);
            });
        } else if (node instanceof TypeAnnotationExpressionNode) {
            this._addPossibleTupleNamedTarget(node.valueExpression);
        } else if (node instanceof StarExpressionNode) {
            if (node.expression instanceof NameNode) {
                let name = node.expression.nameToken;
                this._addName(name.value);
            }
        } else if (node instanceof NameNode) {
            let name = node.nameToken;
            this._addName(name.value);
        }
    }

    private _addName(name: string) {
        let scopeType = this._currentNameBindings.lookUpName(name);
        if (scopeType === undefined) {
            this._currentNameBindings.addName(name, this._currentBindingType);
        }
    }

    private _createNewScope(nameBindings: NameBindings, walkInnerScopeCallback: () => void) {
        let prevNameBindings = this._currentNameBindings;
        this._currentNameBindings = nameBindings;

        let prevBindingScope = this._currentBindingType;
        this._currentBindingType = NameBindingType.Local;

        walkInnerScopeCallback();

        this._currentNameBindings = prevNameBindings;
        this._currentBindingType = prevBindingScope;
        return false;
    }
}
