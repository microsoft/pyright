/*
 * typeStubWriter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic to emit a type stub file for a corresponding parsed
 * and analyzed python source file.
 */

import { Uri } from '../common/uri/uri';
import {
    ArgCategory,
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
    MemberAccessNode,
    ModuleNameNode,
    NameNode,
    ParamCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    StatementListNode,
    StringNode,
    TryNode,
    TypeAliasNode,
    TypeAnnotationNode,
    TypeParamKind,
    TypeParameterListNode,
    TypeParameterNode,
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
import {
    ClassType,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isUnknown,
    removeUnknownFromUnion,
} from './types';

class TrackedImport {
    isAccessed = false;

    constructor(public importName: string) {}
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
    constructor(private _accessedImportedSymbols: Set<string>, private _treatStringsAsSymbols: boolean) {
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
        this._accessedImportedSymbols.add(node.d.value);
        return true;
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        const baseExpression = this._getRecursiveModuleAccessExpression(node.d.leftExpr);

        if (baseExpression) {
            this._accessedImportedSymbols.add(`${baseExpression}.${node.d.member.d.value}`);
        }

        return true;
    }

    override visitString(node: StringNode) {
        if (this._treatStringsAsSymbols) {
            this._accessedImportedSymbols.add(node.d.value);
        }

        return true;
    }

    private _getRecursiveModuleAccessExpression(node: ExpressionNode): string | undefined {
        if (node.nodeType === ParseNodeType.Name) {
            return node.d.value;
        }

        if (node.nodeType === ParseNodeType.MemberAccess) {
            const baseExpression = this._getRecursiveModuleAccessExpression(node.d.leftExpr);
            if (!baseExpression) {
                return undefined;
            }

            return `${baseExpression}.${node.d.member.d.value}`;
        }

        return undefined;
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
    private _accessedImportedSymbols = new Set<string>();

    constructor(private _stubPath: Uri, private _sourceFile: SourceFile, private _evaluator: TypeEvaluator) {
        super();

        // As a heuristic, we'll include all of the import statements
        // in "__init__.pyi" files even if they're not locally referenced
        // because these are often used as ways to re-export symbols.
        if (this._stubPath.fileName === '__init__.pyi') {
            this._includeAllImports = true;
        }
    }

    write() {
        const parseResults = this._sourceFile.getParseResults()!;
        this._lineEnd = parseResults.tokenizerOutput.predominantEndOfLineSequence;
        this._tab = parseResults.tokenizerOutput.predominantTabSequence;

        this.walk(parseResults.parserOutput.parseTree);

        this._writeFile();
    }

    override walk(node: ParseNode) {
        if (!AnalyzerNodeInfo.isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    override visitClass(node: ClassNode) {
        const className = node.d.name.d.value;

        this._emittedSuite = true;
        this._emitDocString = true;
        this._emitDecorators(node.d.decorators);
        let line = `class ${className}`;

        if (node.d.typeParams) {
            line += this._printTypeParams(node.d.typeParams);
        }

        // Remove "object" from the list, since it's implied
        const args = node.d.arguments.filter(
            (arg) =>
                arg.d.name !== undefined ||
                arg.d.argCategory !== ArgCategory.Simple ||
                arg.d.valueExpr.nodeType !== ParseNodeType.Name ||
                arg.d.valueExpr.d.value !== 'object'
        );

        if (args.length > 0) {
            line += `(${args
                .map((arg) => {
                    let argString = '';
                    if (arg.d.name) {
                        argString = arg.d.name.d.value + '=';
                    }
                    argString += this._printExpression(arg.d.valueExpr);
                    return argString;
                })
                .join(', ')})`;
        }
        line += ':';
        this._emitLine(line);

        this._emitSuite(() => {
            this._classNestCount++;
            this.walk(node.d.suite);
            this._classNestCount--;
        });

        this._emitLine('');
        this._emitLine('');

        return false;
    }

    override visitFunction(node: FunctionNode) {
        const functionName = node.d.name.d.value;

        // Skip if we're already within a function or if the name is private/protected.
        if (this._functionNestCount === 0 && !SymbolNameUtils.isPrivateOrProtectedName(functionName)) {
            this._emittedSuite = true;
            this._emitDocString = true;
            this._emitDecorators(node.d.decorators);
            let line = node.d.isAsync ? 'async ' : '';
            line += `def ${functionName}`;

            if (node.d.typeParams) {
                line += this._printTypeParams(node.d.typeParams);
            }

            line += `(${node.d.params.map((param, index) => this._printParam(param, node, index)).join(', ')})`;

            let returnAnnotation: string | undefined;
            if (node.d.returnAnnotation) {
                returnAnnotation = this._printExpression(node.d.returnAnnotation, /* treatStringsAsSymbols */ true);
            } else if (node.d.funcAnnotationComment) {
                returnAnnotation = this._printExpression(
                    node.d.funcAnnotationComment.d.returnAnnotation,
                    /* treatStringsAsSymbols */ true
                );
            } else {
                // Handle a few common cases where we always know the answer.
                if (node.d.name.d.value === '__init__') {
                    returnAnnotation = 'None';
                } else if (node.d.name.d.value === '__str__') {
                    returnAnnotation = 'str';
                } else if (['__int__', '__hash__'].some((name) => name === node.d.name.d.value)) {
                    returnAnnotation = 'int';
                } else if (
                    ['__eq__', '__ne__', '__gt__', '__lt__', '__ge__', '__le__'].some(
                        (name) => name === node.d.name.d.value
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
                    let returnType = this._evaluator.getInferredReturnType(functionType.functionType);
                    returnType = removeUnknownFromUnion(returnType);
                    if (!isNever(returnType) && !isUnknown(returnType)) {
                        line += ` # -> ${this._evaluator.printType(returnType, { enforcePythonSyntax: true })}:`;
                    }
                }
            }

            this._emitLine(line);

            this._emitSuite(() => {
                // Don't emit any nested functions.
                this._functionNestCount++;
                this.walk(node.d.suite);
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

        // Only walk a single branch of the try/catch to for imports.
        this.walk(node.d.trySuite);
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
            this._emitLine('if ' + this._printExpression(node.d.testExpr) + ':');
            this._emitSuite(() => {
                this.walkMultiple(node.d.ifSuite.d.statements);
            });

            const elseSuite = node.d.elseSuite;
            if (elseSuite) {
                this._emitLine('else:');
                this._emitSuite(() => {
                    if (elseSuite.nodeType === ParseNodeType.If) {
                        this.walkMultiple([elseSuite.d.testExpr, elseSuite.d.ifSuite, elseSuite.d.elseSuite]);
                    } else {
                        this.walkMultiple(elseSuite.d.statements);
                    }
                });
            }
            this._ifNestCount--;
        }

        return false;
    }

    override visitTypeAlias(node: TypeAliasNode): boolean {
        let line = '';
        line = this._printExpression(node.d.name);

        if (node.d.typeParams) {
            line += this._printTypeParams(node.d.typeParams);
        }

        line += ' = ';
        line += this._printExpression(node.d.expr);
        this._emitLine(line);

        return false;
    }

    override visitAssignment(node: AssignmentNode) {
        let isTypeAlias = false;
        let line = '';

        if (node.d.leftExpr.nodeType === ParseNodeType.Name) {
            // Handle "__all__" as a special case.
            if (node.d.leftExpr.d.value === '__all__') {
                if (this._functionNestCount === 0 && this._ifNestCount === 0) {
                    this._emittedSuite = true;

                    line = this._printExpression(node.d.leftExpr);
                    line += ' = ';
                    line += this._printExpression(node.d.rightExpr);
                    this._emitLine(line);
                }

                return false;
            }

            if (this._functionNestCount === 0) {
                line = this._printExpression(node.d.leftExpr);
                if (node.d.annotationComment) {
                    line += ': ' + this._printExpression(node.d.annotationComment, /* treatStringsAsSymbols */ true);
                }

                const valueType = this._evaluator.getType(node.d.leftExpr);
                if (valueType?.props?.typeAliasInfo) {
                    isTypeAlias = true;
                } else if (node.d.rightExpr.nodeType === ParseNodeType.Call) {
                    // Special-case TypeVar, TypeVarTuple, ParamSpec and NewType calls. Treat
                    // them like type aliases.
                    const callBaseType = this._evaluator.getType(node.d.rightExpr.d.leftExpr);
                    if (
                        callBaseType &&
                        isInstantiableClass(callBaseType) &&
                        ClassType.isBuiltIn(callBaseType, ['TypeVar', 'TypeVarTuple', 'ParamSpec', 'NewType'])
                    ) {
                        isTypeAlias = true;
                    }
                }
            }
        } else if (node.d.leftExpr.nodeType === ParseNodeType.TypeAnnotation) {
            const valueExpr = node.d.leftExpr.d.valueExpr;

            const declaredType = this._evaluator.getTypeOfAnnotation(node.d.leftExpr.d.annotation, {
                varTypeAnnotation: true,
                allowClassVar: true,
            });

            // Is this an explicit TypeAlias declaration?
            if (isClassInstance(declaredType) && ClassType.isBuiltIn(declaredType, 'TypeAlias')) {
                isTypeAlias = true;
            }

            if (valueExpr.nodeType === ParseNodeType.Name) {
                if (this._functionNestCount === 0) {
                    line = `${this._printExpression(valueExpr)}: ${this._printExpression(
                        node.d.leftExpr.d.annotation,
                        /* treatStringsAsSymbols */ true
                    )}`;
                }
            }
        }

        if (line) {
            this._emittedSuite = true;

            line += ' = ';

            if (isTypeAlias) {
                line += this._printExpression(node.d.rightExpr);
            } else {
                line += '...';
            }
            this._emitLine(line);
        }

        return false;
    }

    override visitAugmentedAssignment(node: AugmentedAssignmentNode) {
        if (node.d.leftExpr.nodeType === ParseNodeType.Name) {
            // Handle "__all__ +=" as a special case.
            if (node.d.leftExpr.d.value === '__all__' && node.d.operator === OperatorType.AddEqual) {
                if (this._functionNestCount === 0 && this._ifNestCount === 0) {
                    let line = this._printExpression(node.d.leftExpr);
                    line += ' += ';
                    line += this._printExpression(node.d.rightExpr);
                    this._emitLine(line);
                }
            }
        }

        return false;
    }

    override visitTypeAnnotation(node: TypeAnnotationNode) {
        if (this._functionNestCount === 0) {
            let line = '';
            if (node.d.valueExpr.nodeType === ParseNodeType.Name) {
                line = this._printExpression(node.d.valueExpr);
            } else if (node.d.valueExpr.nodeType === ParseNodeType.MemberAccess) {
                const baseExpression = node.d.valueExpr.d.leftExpr;
                if (baseExpression.nodeType === ParseNodeType.Name) {
                    if (baseExpression.d.value === 'self') {
                        const memberName = node.d.valueExpr.d.member.d.value;
                        if (!SymbolNameUtils.isPrivateOrProtectedName(memberName)) {
                            line = this._printExpression(node.d.valueExpr);
                        }
                    }
                }
            }

            if (line) {
                line += ': ' + this._printExpression(node.d.annotation, /* treatStringsAsSymbols */ true);
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
            node.d.list.forEach((imp) => {
                const moduleName = this._printModuleName(imp.d.module);
                if (!this._trackedImportAs.has(moduleName)) {
                    const symbolName = imp.d.alias
                        ? imp.d.alias.d.value
                        : imp.d.module.d.nameParts.length > 0
                        ? imp.d.module.d.nameParts[0].d.value
                        : '';
                    const symbolInfo = currentScope.lookUpSymbolRecursive(symbolName);
                    if (symbolInfo) {
                        const trackedImportAs = new TrackedImportAs(
                            moduleName,
                            imp.d.alias ? imp.d.alias.d.value : undefined,
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
            const moduleName = this._printModuleName(node.d.module);
            let trackedImportFrom = this._trackedImportFrom.get(moduleName);
            if (!trackedImportFrom) {
                trackedImportFrom = new TrackedImportFrom(moduleName, node.d.isWildcardImport, node);
                this._trackedImportFrom.set(moduleName, trackedImportFrom);
            }

            node.d.imports.forEach((imp) => {
                const symbolName = imp.d.alias ? imp.d.alias.d.value : imp.d.name.d.value;
                const symbolInfo = currentScope.lookUpSymbolRecursive(symbolName);
                if (symbolInfo) {
                    trackedImportFrom!.addSymbol(
                        symbolInfo.symbol,
                        imp.d.name.d.value,
                        imp.d.alias ? imp.d.alias.d.value : undefined,
                        false
                    );
                }
            });
        }

        return false;
    }

    override visitStatementList(node: StatementListNode) {
        if (node.d.statements.length > 0 && node.d.statements[0].nodeType === ParseNodeType.StringList) {
            // Is this the first statement in a suite? If it's a string
            // literal, assume it's a doc string and emit it.
            if (!this._emittedSuite && this._emitDocString) {
                this._emitLine(this._printExpression(node.d.statements[0]));
            }
        }

        // Don't emit a doc string after the first statement.
        this._emitDocString = false;

        this.walkMultiple(node.d.statements);
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
            this._emitLine('@' + this._printExpression(decorator.d.expr));
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

    private _printTypeParams(node: TypeParameterListNode): string {
        return `[${node.d.params.map((typeParam) => this._printTypeParam(typeParam)).join(',')}]`;
    }

    private _printTypeParam(node: TypeParameterNode): string {
        let line = '';

        if (node.d.typeParamKind === TypeParamKind.TypeVarTuple) {
            line += '*';
        } else if (node.d.typeParamKind === TypeParamKind.ParamSpec) {
            line += '**';
        }

        line += node.d.name.d.value;

        if (node.d.boundExpr) {
            line += ': ';
            line += this._printExpression(node.d.boundExpr);
        }

        if (node.d.defaultExpr) {
            line += ' = ';
            line += this._printExpression(node.d.defaultExpr);
        }

        return line;
    }

    private _printModuleName(node: ModuleNameNode): string {
        let line = '';
        for (let i = 0; i < node.d.leadingDots; i++) {
            line += '.';
        }
        line += node.d.nameParts.map((part) => part.d.value).join('.');
        return line;
    }

    private _printParam(paramNode: ParameterNode, functionNode: FunctionNode, paramIndex: number): string {
        let line = '';
        if (paramNode.d.category === ParamCategory.ArgsList) {
            line += '*';
        } else if (paramNode.d.category === ParamCategory.KwargsDict) {
            line += '**';
        }

        if (paramNode.d.name) {
            line += paramNode.d.name.d.value;
        } else if (paramNode.d.category === ParamCategory.Simple) {
            line += '/';
        }

        const paramTypeAnnotation = ParseTreeUtils.getTypeAnnotationForParam(functionNode, paramIndex);
        let paramType = '';
        if (paramTypeAnnotation) {
            paramType = this._printExpression(paramTypeAnnotation, /* treatStringsAsSymbols */ true);
        }

        if (paramType) {
            line += ': ' + paramType;
        }

        if (paramNode.d.defaultValue) {
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

        let expressionFlags = isType
            ? ParseTreeUtils.PrintExpressionFlags.ForwardDeclarations
            : ParseTreeUtils.PrintExpressionFlags.None;
        expressionFlags |= ParseTreeUtils.PrintExpressionFlags.DoNotLimitStringLength;

        return ParseTreeUtils.printExpression(node, expressionFlags);
    }

    private _printTrackedImports() {
        let importStr = '';
        let lineEmitted = false;

        // Emit the "import" statements.
        this._trackedImportAs.forEach((imp) => {
            if (this._accessedImportedSymbols.has(imp.alias || imp.importName)) {
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
                if (this._accessedImportedSymbols.has(s.alias || s.name)) {
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

            // Don't emit a "from __future__" import. Just ignore these
            // because they have no meaning in stubs, and they must appear
            // at the top of a file.
            if (sortedSymbols.length > 0 && imp.importName !== '__future__') {
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
