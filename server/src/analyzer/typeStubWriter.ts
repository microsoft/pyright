/*
* typeStubWriter.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic to emit a type stub file for a corresponding parsed
* and analyzed python source file.
*/

import * as fs from 'fs';

import { ArgumentCategory, ArgumentNode, AssignmentNode, AugmentedAssignmentExpressionNode,
    ClassNode, DecoratorNode, ExpressionNode, ForNode, FunctionNode, IfNode,
    ImportFromNode, ImportNode, MemberAccessExpressionNode, ModuleNameNode, NameNode,
    ParameterCategory, ParameterNode, ParseNode, StatementListNode,
    StringListNode, StringNode, TryNode, TypeAnnotationExpressionNode, WhileNode,
    WithNode } from '../parser/parseNodes';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { ParseTreeUtils, PrintExpressionFlags } from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { SourceFile } from './sourceFile';
import { Symbol } from './symbol';
import { SymbolUtils } from './symbolUtils';
import { FunctionType, NoneType, ObjectType, UnknownType } from './types';
import { TypeUtils } from './typeUtils';

class TrackedImport {
    constructor(public importName: string) {}

    isAccessed = false;
}

class TrackedImportAs extends TrackedImport {
    constructor(importName: string, public alias: string | undefined,
            public symbol: Symbol) {

        super(importName);
    }
}

interface TrackedImportSymbol {
    symbol?: Symbol;
    name: string;
    alias?: string;
    isAccessed: boolean;
}

class TrackedImportFrom extends TrackedImport {
    constructor(importName: string, public isWildcardImport: boolean, public node?: ImportFromNode) {
        super(importName);
    }
    symbols: TrackedImportSymbol[] = [];

    addSymbol(symbol: Symbol | undefined, name: string,
            alias: string | undefined, isAccessed = false) {

        if (!this.symbols.find(s => s.name === name)) {
            this.symbols.push({
                symbol,
                name,
                alias,
                isAccessed
            });
        }
    }
}

class ImportSymbolWalker extends ParseTreeWalker {
    constructor(
        private _trackedImportAs: { [importName: string]: TrackedImportAs },
            private _trackedImportFrom: { [importName: string]: TrackedImportFrom },
            private _treatStringsAsSymbols: boolean) {

        super();
    }

    analyze(node: ExpressionNode) {
        this.walk(node);
    }

    visitName(node: NameNode) {
        this._markNameAccessed(node, node.nameToken.value);
        return true;
    }

    visitString(node: StringNode) {
        if (this._treatStringsAsSymbols) {
            const value = node.getValue();
            this._markNameAccessed(node, value);
        }

        return true;
    }

    private _markNameAccessed(node: ParseNode, name: string) {
        const currentScope = AnalyzerNodeInfo.getScopeRecursive(node);
        if (currentScope) {
            const symbolInfo = currentScope.lookUpSymbolRecursive(name);
            if (symbolInfo) {
                Object.keys(this._trackedImportAs).forEach(implName => {
                    const impl = this._trackedImportAs[implName];
                    if (impl.symbol === symbolInfo.symbol) {
                        impl.isAccessed = true;
                    }
                });

                Object.keys(this._trackedImportFrom).forEach(implName => {
                    const impl = this._trackedImportFrom[implName];
                    impl.symbols.forEach(symbol => {
                        if (symbol.symbol === symbolInfo.symbol) {
                            symbol.isAccessed = true;
                        }
                    });
                });
            }
        }
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
    private _trackedImportAs: { [importName: string]: TrackedImportAs } = {};
    private _trackedImportFrom: { [importName: string]: TrackedImportFrom } = {};

    constructor(private _typingsPath: string, private _sourceFile: SourceFile) {
        super();

        // As a heuristic, we'll include all of the import statements
        // in "__init__.pyi" files even if they're not locally referenced
        // because these are often used as ways to re-export symbols.
        this._includeAllImports = this._typingsPath.endsWith('__init__.pyi');
    }

    write() {
        const parseResults = this._sourceFile.getParseResults()!;
        this._lineEnd = parseResults.predominantLineEndSequence;
        this._tab = parseResults.predominantTabSequence;

        this.walk(parseResults.parseTree);

        this._writeFile();
    }

    visitClass(node: ClassNode) {
        const className = node.name.nameToken.value;

        this._emittedSuite = true;
        this._emitDocString = true;
        this._emitDecorators(node.decorators);
        let line = `class ${ className }`;
        if (node.arguments.length > 0) {
            line += `(${ node.arguments.map(arg => {
                let argString = '';
                if (arg.name) {
                    argString = arg.name.nameToken.value + '=';
                }
                argString += this._printExpression(arg.valueExpression);
                return argString;
            }).join(', ') })`;
        }
        line += ':';
        this._emitLine(line);

        this._emitSuite(() => {
            this._classNestCount++;
            this.walkChildren(node);
            this._classNestCount--;
        });

        this._emitLine('');
        this._emitLine('');

        return false;
    }

    visitFunction(node: FunctionNode) {
        const functionName = node.name.nameToken.value;

        // Skip if we're already within a function.
        if (this._functionNestCount === 0) {
            this._emittedSuite = true;
            this._emitDocString = true;
            this._emitDecorators(node.decorators);
            let line = node.isAsync ? 'async ' : '';
            line += `def ${ functionName }`;
            line += `(${ node.parameters.map(param => this._printParameter(param)).join(', ') })`;

            if (node.returnTypeAnnotation) {
                line += ' -> ' + this._printExpression(node.returnTypeAnnotation, true);
            } else {
                const functionType = AnalyzerNodeInfo.getExpressionType(node);
                if (functionType instanceof FunctionType) {
                    let inferredReturnType = functionType.getInferredReturnType().getType();
                    inferredReturnType = TypeUtils.stripLiteralValue(inferredReturnType);

                    // If the inferred return type is NoReturn, don't include it because
                    // the inferrence is probably incorrect. This occurs often when a base
                    // class is implemented with a NoReturn, but subclasses provide an
                    // actual return value.
                    if (inferredReturnType instanceof ObjectType) {
                        const classType = inferredReturnType.getClassType();
                        if (classType.isBuiltIn() && classType.getClassName() === 'NoReturn') {
                            inferredReturnType = UnknownType.create();
                        }
                    }

                    // If the type is partially unknown, skip it.
                    if (!TypeUtils.containsUnknown(inferredReturnType)) {
                        // TODO - need to implement
                        // line += ' -> ' + inferredReturnType.asString();
                    }
                }
            }

            line += ':';
            this._emitLine(line);

            this._emitSuite(() => {
                // Don't emit any nested functions.
                this._functionNestCount++;
                this.walkChildren(node);
                this._functionNestCount--;
            });

            this._emitLine('');
        }

        return false;
    }

    visitWhile(node: WhileNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;
        return false;
    }

    visitFor(node: ForNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;
        return false;
    }

    visitTry(node: TryNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;
        return false;
    }

    visitWith(node: WithNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;
        return false;
    }

    visitIf(node: IfNode) {
        // Don't emit a doc string after the first statement.
        this._emitDocString = false;

        // Include if statements if they are located
        // at the global scope.
        if (this._functionNestCount === 0 && this._ifNestCount === 0) {
            this._ifNestCount++;
            this._emittedSuite = true;
            this._emitLine('if ' + this._printExpression(node.testExpression) + ':');
            this._emitSuite(() => {
                this.walkChildren(node.ifSuite);
            });

            if (node.elseSuite) {
                this._emitLine('else:');
                this._emitSuite(() => {
                    this.walkChildren(node.elseSuite!);
                });
            }
            this._ifNestCount--;
        }

        return false;
    }

    visitAssignment(node: AssignmentNode) {
        let line = '';

        if (node.leftExpression instanceof NameNode) {
            if (this._functionNestCount === 0) {
                line = this._printExpression(node.leftExpression);
            }

            if (node.leftExpression.nameToken.value === '__all__') {
                this._emitLine(this._printExpression(node, false, true));
            }
        } else if (node.leftExpression instanceof MemberAccessExpressionNode) {
            const baseExpression = node.leftExpression.leftExpression;
            if (baseExpression instanceof NameNode) {
                if (baseExpression.nameToken.value === 'self') {
                    const memberName = node.leftExpression.memberName.nameToken.value;
                    if (!SymbolUtils.isProtectedName(memberName) &&
                            !SymbolUtils.isPrivateName(memberName)) {

                        line = this._printExpression(node.leftExpression);
                    }
                }
            }
        }

        if (line) {
            const emitValue = this._functionNestCount === 0 && this._classNestCount === 0;
            this._emittedSuite = true;

            // Add the inferred type if it's known.
            if (!emitValue) {
                let type = AnalyzerNodeInfo.getExpressionType(node.leftExpression);
                if (type && !TypeUtils.containsUnknown(type)) {
                    type = TypeUtils.stripLiteralValue(type);
                    // TODO - need to implement
                    // line += ': ' + type.asString();
                }
            }

            line += ' = ';

            if (emitValue) {
                line += this._printExpression(node.rightExpression);
            } else {
                line += '...';
            }
            this._emitLine(line);
        }

        return false;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentExpressionNode) {
        if (this._classNestCount === 0 && this._functionNestCount === 0) {
            if (node.leftExpression instanceof NameNode) {
                if (node.leftExpression.nameToken.value === '__all__') {
                    this._emitLine(this._printExpression(node, false, true));
                }
            }
        }

        return false;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode) {
        if (this._functionNestCount === 0) {
            let line = '';
            if (node.valueExpression instanceof NameNode) {
                line = this._printExpression(node.valueExpression);
            } else if (node.valueExpression instanceof MemberAccessExpressionNode) {
                const baseExpression = node.valueExpression.leftExpression;
                if (baseExpression instanceof NameNode) {
                    if (baseExpression.nameToken.value === 'self') {
                        const memberName = node.valueExpression.memberName.nameToken.value;
                        if (!SymbolUtils.isProtectedName(memberName) &&
                                !SymbolUtils.isPrivateName(memberName)) {
                            line = this._printExpression(node.valueExpression);
                        }
                    }
                }
            }

            if (line) {
                line += ': ' + this._printExpression(node.typeAnnotation, true);
                this._emitLine(line);
            }
        }

        return false;
    }

    visitImport(node: ImportNode) {
        if (this._functionNestCount > 0 || this._classNestCount > 0) {
            return false;
        }

        const currentScope = AnalyzerNodeInfo.getScopeRecursive(node);
        if (currentScope) {
            // Record the input for later.
            node.list.forEach(imp => {
                const moduleName = this._printModuleName(imp.module);
                if (!this._trackedImportAs[moduleName]) {
                    const symbolName = imp.alias ? imp.alias.nameToken.value :
                        (imp.module.nameParts.length > 0 ?
                            imp.module.nameParts[0].nameToken.value : '');
                    const symbolInfo = currentScope.lookUpSymbolRecursive(symbolName);
                    if (symbolInfo) {
                        const trackedImportAs = new TrackedImportAs(moduleName,
                            imp.alias ? imp.alias.nameToken.value : undefined,
                            symbolInfo.symbol);
                        this._trackedImportAs[moduleName] = trackedImportAs;
                    }
                }
            });
        }

        return false;
    }

    visitImportFrom(node: ImportFromNode) {
        if (this._functionNestCount > 0 || this._classNestCount > 0) {
            return false;
        }

        const currentScope = AnalyzerNodeInfo.getScopeRecursive(node);
        if (currentScope) {
            // Record the input for later.
            const moduleName = this._printModuleName(node.module);
            let trackedImportFrom = this._trackedImportFrom[moduleName];
            if (!this._trackedImportFrom[moduleName]) {
                trackedImportFrom = new TrackedImportFrom(moduleName,
                    node.isWildcardImport, node);
                this._trackedImportFrom[moduleName] = trackedImportFrom;
            }

            node.imports.forEach(imp => {
                const symbolName = imp.alias ?
                    imp.alias.nameToken.value : imp.name.nameToken.value;
                const symbolInfo = currentScope.lookUpSymbolRecursive(symbolName);
                if (symbolInfo) {
                    trackedImportFrom.addSymbol(symbolInfo.symbol, imp.name.nameToken.value,
                        imp.alias ? imp.alias.nameToken.value : undefined, false);
                }
            });
        }

        return false;
    }

    visitStatementList(node: StatementListNode) {
        if (node.statements.length > 0 && node.statements[0] instanceof StringListNode) {
            // Is this the first statement in a suite? If it's a string
            // literal, assume it's a doc string and emit it.
            if (!this._emittedSuite && this._emitDocString) {
                this._emitLine(this._printExpression(node.statements[0]));
            }
        }

        // Don't emit a doc string after the first statement.
        this._emitDocString = false;

        this.walkChildren(node);
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
        decorators.forEach(decorator => {
            let line = '@' + this._printExpression(decorator.leftExpression);
            if (decorator.arguments) {
                line += `(${ decorator.arguments.map(
                    arg => this._printArgument(arg)).join(', ') })`;
            }
            this._emitLine(line);
        });
    }

    private _printHeaderDocString() {
        return '"""' + this._lineEnd +
            'This type stub file was generated by pyright.' + this._lineEnd +
            '"""' + this._lineEnd +
            this._lineEnd;
        // this._emitLine('');
        // this._emitLine('from typing import Any, Optional');
        // this._emitLine('from typing import Any, List, Dict, Optional, Tuple, Type, Union');
        // this._emitLine('from typing_extensions import Literal');
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
        line += node.nameParts.map(part => part.nameToken.value).join('.');
        return line;
    }

    private _addImplicitImportFrom(importName: string, symbols: string[]) {
        let trackedImportFrom = this._trackedImportFrom[importName];
        if (!this._trackedImportFrom[importName]) {
            trackedImportFrom = new TrackedImportFrom(importName, false);
            this._trackedImportFrom[importName] = trackedImportFrom;
        }

        symbols.forEach(symbol => {
            trackedImportFrom.addSymbol(undefined, symbol, undefined, true);
        });
    }

    private _printParameter(node: ParameterNode): string {
        let line = '';
        if (node.category === ParameterCategory.VarArgList) {
            line += '*';
        } else if (node.category === ParameterCategory.VarArgDictionary) {
            line += '**';
        }

        if (node.name) {
            line += node.name.nameToken.value;
        }

        let paramType = '';
        if (node.typeAnnotation) {
            paramType = this._printExpression(node.typeAnnotation, true);
        } else if (node.defaultValue) {
            // Try to infer the param type based on the default value.
            const typeOfDefault = AnalyzerNodeInfo.getExpressionType(node.defaultValue);
            if (typeOfDefault && !TypeUtils.containsUnknown(typeOfDefault)) {
                if (typeOfDefault instanceof NoneType) {
                    paramType = 'Optional[Any]';
                    this._addImplicitImportFrom('typing', ['Any', 'Optional']);
                } else if (typeOfDefault instanceof ObjectType) {
                    const classType = typeOfDefault.getClassType();
                    if (classType.isBuiltIn() && classType.getClassName() === 'bool') {
                        paramType = 'bool';
                    }
                }
            }
        }

        if (paramType) {
            line += ': ' + paramType;
        }

        if (node.defaultValue) {
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

    private _printArgument(node: ArgumentNode): string {
        let line = '';
        if (node.argumentCategory === ArgumentCategory.UnpackedList) {
            line += '*';
        } else if (node.argumentCategory === ArgumentCategory.UnpackedDictionary) {
            line += '**';
        }

        if (node.name) {
            line += node.name.nameToken.value + '=';
        }

        return line + this._printExpression(node.valueExpression);
    }

    private _printExpression(node: ExpressionNode, isType = false,
            treatStringsAsSymbols = false): string {

        const importSymbolWalker = new ImportSymbolWalker(
            this._trackedImportAs,
            this._trackedImportFrom,
            treatStringsAsSymbols);
        importSymbolWalker.analyze(node);

        return ParseTreeUtils.printExpression(node,
            isType ? PrintExpressionFlags.ForwardDeclarations : PrintExpressionFlags.None);
    }

    private _printTrackedImports() {
        let importStr = '';
        let lineEmitted = false;

        // Emit the "import" statements.
        Object.keys(this._trackedImportAs).forEach(impName => {
            const imp = this._trackedImportAs[impName];
            if (imp.isAccessed || this._includeAllImports) {
                importStr += `import ${ imp.importName }`;
                if (imp.alias) {
                    importStr += ` as ${ imp.alias }`;
                }
                importStr += this._lineEnd;
                lineEmitted = true;
            }
        });

        // Emit the "import from" statements.
        Object.keys(this._trackedImportFrom).forEach(impName => {
            const imp = this._trackedImportFrom[impName];

            if (imp.isWildcardImport) {
                importStr += `from ${ imp.importName } import *` + this._lineEnd;
                lineEmitted = true;
            }

            const sortedSymbols = imp.symbols.
                filter(s => s.isAccessed || this._includeAllImports).
                sort((a, b) => {
                    if (a.name < b.name) {
                        return -1;
                    } else if (a.name > b.name) {
                        return 1;
                    }
                    return 0;
                });

            if (sortedSymbols.length > 0) {
                importStr += `from ${ imp.importName } import `;

                importStr += sortedSymbols.map(symbol => {
                    let symStr = symbol.name;
                    if (symbol.alias) {
                        symStr += ' as ' + symbol.alias;
                    }
                    return symStr;
                }).join(', ');

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

        fs.writeFileSync(this._typingsPath, finalText, { encoding: 'utf8' });
    }
}
