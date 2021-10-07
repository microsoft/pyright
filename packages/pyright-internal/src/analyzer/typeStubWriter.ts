/*
 * typeStubWriter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic to emit a type stub file for a corresponding parsed
 * and analyzed python source file.
 */

import {
    ArgumentCategory,
    AssignmentNode,
    AugmentedAssignmentNode,
    ClassNode,
    DecoratorNode,
    ExpressionNode,
    ForNode,
    FunctionNode,
    IfNode,
    ImportFromNode,
    ImportNode,
    ModuleNameNode,
    NameNode,
    ParameterCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    StatementListNode,
    StringNode,
    TryNode,
    TypeAnnotationNode,
    WhileNode,
    WithNode,
} from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { getScopeForNode } from './scopeUtils';
import { SourceFile } from './sourceFile';
import { Symbol } from './symbol';
import * as SymbolNameUtils from './symbolNameUtils';
import { TypeEvaluator } from './typeEvaluatorTypes';
import { isFunction, isNever, isUnknown, removeUnknownFromUnion } from './types';

class TrackedImport {
    constructor(public importName: string) {}

    isAccessed = false;
}

class TrackedImportAs extends TrackedImport {
    constructor(importName: string, public alias: string | undefined, public symbol: Symbol) {
        super(importName);
    }
}

interface TrackedImportSymbol {
    symbol?: Symbol | undefined;
    name: string;
    alias?: string | undefined;
    isAccessed: boolean;
}

class TrackedImportFrom extends TrackedImport {
    symbols: TrackedImportSymbol[] = [];

    constructor(importName: string, public isWildcardImport: boolean, public node?: ImportFromNode) {
        super(importName);
    }

    addSymbol(symbol: Symbol | undefined, name: string, alias: string | undefined, isAccessed = false) {
        if (!this.symbols.find((s) => s.name === name)) {
            this.symbols.push({
                symbol,
                name,
                alias,
                isAccessed,
            });
        }
    }
}

class ImportSymbolWalker extends ParseTreeWalker {
    constructor(private _accessedImportedSymbols: Map<string, boolean>, private _treatStringsAsSymbols: boolean) {
        super();
    }

    analyze(node: ExpressionNode) {
        this.walk(node);
    }

    override walk(node: ParseNode) {
        if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    override visitName(node: NameNode) {
        this._accessedImportedSymbols.set(node.value, true);
        return true;
    }

    override visitString(node: StringNode) {
        if (this._treatStringsAsSymbols) {
            this._accessedImportedSymbols.set(node.value, true);
        }

        return true;
    }
}

export class TypeStubWriter extends ParseTreeWalker {
    private _indentAmount = 0;
    private _includeAllImports = false;
    private _typeStubText = '';
    private _lineEnd = '\n';
    private _tab = '    ';
    private _classNestCount = 0;
    private _functionNestCount = 0;
    private _ifNestCount = 0;
    private _emittedSuite = false;
    private _emitDocString = true;
    private _trackedImportAs = new Map<string, TrackedImportAs>();
    private _trackedImportFrom = new Map<string, TrackedImportFrom>();
    private _accessedImportedSymbols = new Map<string, boolean>();

    constructor(private _stubPath: string, private _sourceFile: SourceFile, private _evaluator: TypeEvaluator) {
        super();

        // As a heuristic, we'll include all of the import statements
        // in "__init__.pyi" files even if they're not locally referenced
        // because these are often used as ways to re-export symbols.
        if (this._stubPath.endsWith('__init__.pyi')) {
            this._includeAllImports = true;
        }
    }

    write() {
        const parseResults = this._sourceFile.getParseResults()!;
        this._lineEnd = parseResults.tokenizerOutput.predominantEndOfLineSequence;
        this._tab = parseResults.tokenizerOutput.predominantTabSequence;

        this.walk(parseResults.parseTree);

        this._writeFile();
    }

    override walk(node: ParseNode) {
        if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    override visitClass(node: ClassNode) {
        const className = node.name.value;

        this._emittedSuite = true;
        this._emitDocString = true;
        this._emitDecorators(node.decorators);
        let line = `class ${className}`;

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
        this._emitLine(line);

        this._emitSuite(() => {
            this._classNestCount++;
            this.walk(node.suite);
            this._classNestCount--;
        });

        this._emitLine('');
        this._emitLine('');

        return false;
    }

    override visitFunction(node: FunctionNode) {
        const functionName = node.name.value;

        // Skip if we're already within a function or if the name is private/protected.
        if (this._functionNestCount === 0 && !SymbolNameUtils.isPrivateOrProtectedName(functionName)) {
            this._emittedSuite = true;
            this._emitDocString = true;
            this._emitDecorators(node.decorators);
            let line = node.isAsync ? 'async ' : '';
            line += `def ${functionName}`;
            line += `(${node.parameters.map((param, index) => this._printParameter(param, node, index)).join(', ')})`;

            let returnAnnotation: string | undefined;
            if (node.returnTypeAnnotation) {
                returnAnnotation = this._printExpression(node.returnTypeAnnotation, /* treatStringsAsSymbols */ true);
            } else if (node.functionAnnotationComment) {
                returnAnnotation = this._printExpression(
                    node.functionAnnotationComment.returnTypeAnnotation,
                    /* treatStringsAsSymbols */ true
                );
            } else {
                // Handle a few common cases where we always know the answer.
                if (node.name.value === '__init__') {
                    returnAnnotation = 'None';
                } else if (node.name.value === '__str__') {
                    returnAnnotation = 'str';
                } else if (['__int__', '__hash__'].some((name) => name === node.name.value)) {
                    returnAnnotation = 'int';
                } else if (
                    ['__eq__', '__ne__', '__gt__', '__lt__', '__ge__', '__le__'].some(
                        (name) => name === node.name.value
                    )
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

            this._emitLine(line);

            this._emitSuite(() => {
                // Don't emit any nested functions.
                this._functionNestCount++;
                this.walk(node.suite);
                this._functionNestCount--;
            });

            this._emitLine('');
        }

        return false;
    }

    override visitWhile(node: WhileNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;
        return false;
    }

    override visitFor(node: ForNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;
        return false;
    }

    override visitTry(node: TryNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;
        return false;
    }

    override visitWith(node: WithNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;
        return false;
    }

    override visitIf(node: IfNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;

        // Include if statements if they are located
        // at the global scope.
        if (this._functionNestCount === 0 && this._ifNestCount === 0) {
            this._ifNestCount++;
            this._emittedSuite = true;
            this._emitLine('if ' + this._printExpression(node.testExpression) + ':');
            this._emitSuite(() => {
                this.walkMultiple(node.ifSuite.statements);
            });

            const elseSuite = node.elseSuite;
            if (elseSuite) {
                this._emitLine('else:');
                this._emitSuite(() => {
                    if (elseSuite.nodeType === ParseNodeType.If) {
                        this.walkMultiple([elseSuite.testExpression, elseSuite.ifSuite, elseSuite.elseSuite]);
                    } else {
                        this.walkMultiple(elseSuite.statements);
                    }
                });
            }
            this._ifNestCount--;
        }

        return false;
    }

    override visitAssignment(node: AssignmentNode) {
        let isTypeAlias = false;
        let line = '';

        if (node.leftExpression.nodeType === ParseNodeType.Name) {
            // Handle "__all__" as a special case.
            if (node.leftExpression.value === '__all__') {
                if (this._functionNestCount === 0 && this._ifNestCount === 0) {
                    this._emittedSuite = true;

                    line = this._printExpression(node.leftExpression);
                    line += ' = ';
                    line += this._printExpression(node.rightExpression);
                    this._emitLine(line);
                }

                return false;
            }

            if (this._functionNestCount === 0) {
                line = this._printExpression(node.leftExpression);
                if (node.typeAnnotationComment) {
                    line += ': ' + this._printExpression(node.typeAnnotationComment, /* treatStringsAsSymbols */ true);
                }

                const valueType = this._evaluator.getType(node.leftExpression);
                if (valueType?.typeAliasInfo) {
                    isTypeAlias = true;
                }
            }
        } else if (node.leftExpression.nodeType === ParseNodeType.TypeAnnotation) {
            const valueExpr = node.leftExpression.valueExpression;

            if (valueExpr.nodeType === ParseNodeType.Name) {
                if (this._functionNestCount === 0) {
                    line = `${this._printExpression(valueExpr)}: ${this._printExpression(
                        node.leftExpression.typeAnnotation,
                        /* treatStringsAsSymbols */ true
                    )}`;
                }
            }
        }

        if (line) {
            this._emittedSuite = true;

            line += ' = ';

            if (isTypeAlias) {
                line += this._printExpression(node.rightExpression);
            } else {
                line += '...';
            }
            this._emitLine(line);
        }

        return false;
    }

    override visitAugmentedAssignment(node: AugmentedAssignmentNode) {
        if (node.leftExpression.nodeType === ParseNodeType.Name) {
            // Handle "__all__ +=" as a special case.
            if (node.leftExpression.value === '__all__' && node.operator === OperatorType.AddEqual) {
                if (this._functionNestCount === 0 && this._ifNestCount === 0) {
                    let line = this._printExpression(node.leftExpression);
                    line += ' += ';
                    line += this._printExpression(node.rightExpression);
                    this._emitLine(line);
                }
            }
        }

        return false;
    }

    override visitTypeAnnotation(node: TypeAnnotationNode) {
        if (this._functionNestCount === 0) {
            let line = '';
            if (node.valueExpression.nodeType === ParseNodeType.Name) {
                line = this._printExpression(node.valueExpression);
            } else if (node.valueExpression.nodeType === ParseNodeType.MemberAccess) {
                const baseExpression = node.valueExpression.leftExpression;
                if (baseExpression.nodeType === ParseNodeType.Name) {
                    if (baseExpression.value === 'self') {
                        const memberName = node.valueExpression.memberName.value;
                        if (!SymbolNameUtils.isPrivateOrProtectedName(memberName)) {
                            line = this._printExpression(node.valueExpression);
                        }
                    }
                }
            }

            if (line) {
                line += ': ' + this._printExpression(node.typeAnnotation, /* treatStringsAsSymbols */ true);
                this._emitLine(line);
            }
        }

        return false;
    }

    override visitImport(node: ImportNode) {
        if (this._functionNestCount > 0 || this._classNestCount > 0) {
            return false;
        }

        const currentScope = getScopeForNode(node);
        if (currentScope) {
            // Record the input for later.
            node.list.forEach((imp) => {
                const moduleName = this._printModuleName(imp.module);
                if (!this._trackedImportAs.has(moduleName)) {
                    const symbolName = imp.alias
                        ? imp.alias.value
                        : imp.module.nameParts.length > 0
                        ? imp.module.nameParts[0].value
                        : '';
                    const symbolInfo = currentScope.lookUpSymbolRecursive(symbolName);
                    if (symbolInfo) {
                        const trackedImportAs = new TrackedImportAs(
                            moduleName,
                            imp.alias ? imp.alias.value : undefined,
                            symbolInfo.symbol
                        );
                        this._trackedImportAs.set(moduleName, trackedImportAs);
                    }
                }
            });
        }

        return false;
    }

    override visitImportFrom(node: ImportFromNode) {
        if (this._functionNestCount > 0 || this._classNestCount > 0) {
            return false;
        }

        const currentScope = getScopeForNode(node);
        if (currentScope) {
            // Record the input for later.
            const moduleName = this._printModuleName(node.module);
            let trackedImportFrom = this._trackedImportFrom.get(moduleName);
            if (!trackedImportFrom) {
                trackedImportFrom = new TrackedImportFrom(moduleName, node.isWildcardImport, node);
                this._trackedImportFrom.set(moduleName, trackedImportFrom);
            }

            node.imports.forEach((imp) => {
                const symbolName = imp.alias ? imp.alias.value : imp.name.value;
                const symbolInfo = currentScope.lookUpSymbolRecursive(symbolName);
                if (symbolInfo) {
                    trackedImportFrom!.addSymbol(
                        symbolInfo.symbol,
                        imp.name.value,
                        imp.alias ? imp.alias.value : undefined,
                        false
                    );
                }
            });
        }

        return false;
    }

    override visitStatementList(node: StatementListNode) {
        if (node.statements.length > 0 && node.statements[0].nodeType === ParseNodeType.StringList) {
            // Is this the first statement in a suite? If it's a string
            // literal, assume it's a doc string and emit it.
            if (!this._emittedSuite && this._emitDocString) {
                this._emitLine(this._printExpression(node.statements[0]));
            }
        }

        // Don't emit a doc string after the first statement.
        this._emitDocString = false;

        this.walkMultiple(node.statements);
        return false;
    }

    private _emitSuite(callback: () => void) {
        this._increaseIndent(() => {
            const prevEmittedSuite = this._emittedSuite;
            this._emittedSuite = false;

            callback();

            if (!this._emittedSuite) {
                this._emitLine('...');
            }

            this._emittedSuite = prevEmittedSuite;
        });
    }

    private _increaseIndent(callback: () => void) {
        this._indentAmount++;
        callback();
        this._indentAmount--;
    }

    private _emitDecorators(decorators: DecoratorNode[]) {
        decorators.forEach((decorator) => {
            this._emitLine('@' + this._printExpression(decorator.expression));
        });
    }

    private _printHeaderDocString() {
        return (
            '"""' +
            this._lineEnd +
            'This type stub file was generated by pyright.' +
            this._lineEnd +
            '"""' +
            this._lineEnd +
            this._lineEnd
        );
    }

    private _emitLine(line: string) {
        for (let i = 0; i < this._indentAmount; i++) {
            this._typeStubText += this._tab;
        }

        this._typeStubText += line + this._lineEnd;
    }

    private _printModuleName(node: ModuleNameNode): string {
        let line = '';
        for (let i = 0; i < node.leadingDots; i++) {
            line += '.';
        }
        line += node.nameParts.map((part) => part.value).join('.');
        return line;
    }

    private _printParameter(paramNode: ParameterNode, functionNode: FunctionNode, paramIndex: number): string {
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
                line += ' = ...';
            } else {
                line += '=...';
            }
        }

        return line;
    }

    private _printExpression(node: ExpressionNode, isType = false, treatStringsAsSymbols = false): string {
        const importSymbolWalker = new ImportSymbolWalker(this._accessedImportedSymbols, treatStringsAsSymbols);
        importSymbolWalker.analyze(node);

        return ParseTreeUtils.printExpression(
            node,
            isType ? ParseTreeUtils.PrintExpressionFlags.ForwardDeclarations : ParseTreeUtils.PrintExpressionFlags.None
        );
    }

    private _printTrackedImports() {
        let importStr = '';
        let lineEmitted = false;

        // Emit the "import" statements.
        this._trackedImportAs.forEach((imp) => {
            if (this._accessedImportedSymbols.get(imp.alias || imp.importName)) {
                imp.isAccessed = true;
            }

            if (imp.isAccessed || this._includeAllImports) {
                importStr += `import ${imp.importName}`;
                if (imp.alias) {
                    importStr += ` as ${imp.alias}`;
                }
                importStr += this._lineEnd;
                lineEmitted = true;
            }
        });

        // Emit the "import from" statements.
        this._trackedImportFrom.forEach((imp) => {
            imp.symbols.forEach((s) => {
                if (this._accessedImportedSymbols.get(s.alias || s.name)) {
                    s.isAccessed = true;
                }
            });

            if (imp.isWildcardImport) {
                importStr += `from ${imp.importName} import *` + this._lineEnd;
                lineEmitted = true;
            }

            const sortedSymbols = imp.symbols
                .filter((s) => s.isAccessed || this._includeAllImports)
                .sort((a, b) => {
                    if (a.name < b.name) {
                        return -1;
                    } else if (a.name > b.name) {
                        return 1;
                    }
                    return 0;
                });

            if (sortedSymbols.length > 0) {
                importStr += `from ${imp.importName} import `;

                importStr += sortedSymbols
                    .map((symbol) => {
                        let symStr = symbol.name;
                        if (symbol.alias) {
                            symStr += ' as ' + symbol.alias;
                        }
                        return symStr;
                    })
                    .join(', ');

                importStr += this._lineEnd;
                lineEmitted = true;
            }
        });

        if (lineEmitted) {
            importStr += this._lineEnd;
        }

        return importStr;
    }

    private _writeFile() {
        let finalText = this._printHeaderDocString();
        finalText += this._printTrackedImports();
        finalText += this._typeStubText;

        this._sourceFile.fileSystem.writeFileSync(this._stubPath, finalText, 'utf8');
    }
}
