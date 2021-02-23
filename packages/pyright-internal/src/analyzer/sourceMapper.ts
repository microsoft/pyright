/*
 * sourceMapper.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that maps a (.pyi) stub to its (.py) implementation source file.
 */

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ExecutionEnvironment } from '../common/configOptions';
import { isDefined } from '../common/core';
import { getAnyExtensionFromPath } from '../common/pathUtils';
import { ClassNode, ModuleNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import {
    ClassDeclaration,
    Declaration,
    FunctionDeclaration,
    isAliasDeclaration,
    isClassDeclaration,
    isFunctionDeclaration,
    isParameterDeclaration,
    isVariableDeclaration,
    ParameterDeclaration,
    VariableDeclaration,
} from './declaration';
import { ImportResolver } from './importResolver';
import { SourceFile } from './sourceFile';
import { TypeEvaluator } from './typeEvaluator';
import { isClass, isFunction, isOverloadedFunction } from './types';
import { lookUpClassMember } from './typeUtils';

type ClassOrFunctionOrVariableDeclaration = ClassDeclaration | FunctionDeclaration | VariableDeclaration;

// Creates and binds a shadowed file within the program.
export type ShadowFileBinder = (stubFilePath: string, implFilePath: string) => SourceFile | undefined;
export type BoundSourceGetter = (filePath: string) => SourceFile | undefined;

export class SourceMapper {
    constructor(
        private _importResolver: ImportResolver,
        private _execEnv: ExecutionEnvironment,
        private _evaluator: TypeEvaluator,
        private _fileBinder: ShadowFileBinder,
        private _boundSourceGetter: BoundSourceGetter,
        private _mapCompiled: boolean
    ) {}

    findModules(stubFilePath: string): ModuleNode[] {
        const sourceFiles = this._getBoundSourceFilesFromStubFile(stubFilePath);
        return sourceFiles.map((sf) => sf.getParseResults()?.parseTree).filter(isDefined);
    }

    findDeclarations(stubDecl: Declaration): Declaration[] {
        if (isClassDeclaration(stubDecl)) {
            return this._findClassOrTypeAliasDeclarations(stubDecl);
        } else if (isFunctionDeclaration(stubDecl)) {
            return this._findFunctionOrTypeAliasDeclarations(stubDecl);
        } else if (isVariableDeclaration(stubDecl)) {
            return this._findVariableDeclarations(stubDecl);
        } else if (isParameterDeclaration(stubDecl)) {
            return this._findParameterDeclarations(stubDecl);
        }

        return [];
    }

    findClassDeclarations(stubDecl: ClassDeclaration): ClassDeclaration[] {
        return this._findClassOrTypeAliasDeclarations(stubDecl)
            .filter((d) => isClassDeclaration(d))
            .map((d) => d as ClassDeclaration);
    }

    findFunctionDeclarations(stubDecl: FunctionDeclaration): FunctionDeclaration[] {
        return this._findFunctionOrTypeAliasDeclarations(stubDecl)
            .filter((d) => isFunctionDeclaration(d))
            .map((d) => d as FunctionDeclaration);
    }

    private _findClassOrTypeAliasDeclarations(stubDecl: ClassDeclaration, recursiveDeclCache = new Set<string>()) {
        const className = this._getFullClassName(stubDecl.node);
        const sourceFiles = this._getBoundSourceFilesFromStubFile(stubDecl.path);

        return sourceFiles.flatMap((sourceFile) =>
            this._findClassDeclarationsByName(sourceFile, className, recursiveDeclCache)
        );
    }

    private _findFunctionOrTypeAliasDeclarations(
        stubDecl: FunctionDeclaration,
        recursiveDeclCache = new Set<string>()
    ): ClassOrFunctionOrVariableDeclaration[] {
        const functionName = stubDecl.node.name.value;
        const sourceFiles = this._getBoundSourceFilesFromStubFile(stubDecl.path);

        if (stubDecl.isMethod) {
            const classNode = ParseTreeUtils.getEnclosingClass(stubDecl.node);
            if (classNode === undefined) {
                return [];
            }

            const className = this._getFullClassName(classNode);
            return sourceFiles.flatMap((sourceFile) =>
                this._findMethodDeclarationsByName(sourceFile, className, functionName, recursiveDeclCache)
            );
        } else {
            return sourceFiles.flatMap((sourceFile) =>
                this._findFunctionDeclarationsByName(sourceFile, functionName, recursiveDeclCache)
            );
        }
    }

    private _findVariableDeclarations(
        stubDecl: VariableDeclaration,
        recursiveDeclCache = new Set<string>()
    ): VariableDeclaration[] {
        if (stubDecl.node.nodeType !== ParseNodeType.Name) {
            return [];
        }

        const variableName = stubDecl.node.value;
        const sourceFiles = this._getBoundSourceFilesFromStubFile(stubDecl.path);
        const classNode = ParseTreeUtils.getEnclosingClass(stubDecl.node);

        if (classNode) {
            const className = this._getFullClassName(classNode);

            return sourceFiles.flatMap((sourceFile) =>
                this._findFieldDeclarationsByName(sourceFile, className, variableName, recursiveDeclCache)
            );
        } else {
            return sourceFiles.flatMap((sourceFile) =>
                this._findVariableDeclarationsByName(sourceFile, variableName, recursiveDeclCache)
            );
        }
    }

    private _findParameterDeclarations(stubDecl: ParameterDeclaration): ParameterDeclaration[] {
        const result: ParameterDeclaration[] = [];

        if (!stubDecl.node.name) {
            return result;
        }

        const functionNode = ParseTreeUtils.getEnclosingFunction(stubDecl.node);
        if (!functionNode) {
            return result;
        }

        const functionStubDecls = this._evaluator.getDeclarationsForNameNode(functionNode.name);
        if (!functionStubDecls) {
            return result;
        }

        const recursiveDeclCache = new Set<string>();
        for (const functionStubDecl of functionStubDecls) {
            for (const functionDecl of this._findFunctionOrTypeAliasDeclarations(
                functionStubDecl as FunctionDeclaration,
                recursiveDeclCache
            )) {
                result.push(
                    ...this._lookUpSymbolDeclarations(functionDecl.node, stubDecl.node.name.value)
                        .filter((d) => isParameterDeclaration(d))
                        .map((d) => d as ParameterDeclaration)
                );
            }
        }

        return result;
    }

    private _findMemberDeclarationsByName<T extends Declaration>(
        sourceFile: SourceFile,
        className: string,
        memberName: string,
        declAdder: (d: Declaration, c: Set<string>, r: T[]) => void,
        recursiveDeclCache: Set<string>
    ): T[] {
        const result: T[] = [];
        const classDecls = this._findClassDeclarationsByName(sourceFile, className, recursiveDeclCache);

        for (const classDecl of classDecls.filter((d) => isClassDeclaration(d)).map((d) => d as ClassDeclaration)) {
            const classResults = this._evaluator.getTypeOfClass(classDecl.node);
            if (!classResults) {
                continue;
            }

            const member = lookUpClassMember(classResults.classType, memberName);
            if (member) {
                for (const decl of member.symbol.getDeclarations()) {
                    declAdder(decl, recursiveDeclCache, result);
                }
            }
        }

        return result;
    }

    private _findFieldDeclarationsByName(
        sourceFile: SourceFile,
        className: string,
        variableName: string,
        recursiveDeclCache: Set<string>
    ): VariableDeclaration[] {
        let result: VariableDeclaration[] = [];

        const uniqueId = `@${sourceFile.getFilePath()}/c/${className}/v/${variableName}`;
        if (recursiveDeclCache.has(uniqueId)) {
            return result;
        }

        result = this._findMemberDeclarationsByName(
            sourceFile,
            className,
            variableName,
            (decl, cache, result) => {
                if (isVariableDeclaration(decl)) {
                    if (isStubFile(decl.path)) {
                        result.push(...this._findVariableDeclarations(decl, cache));
                    } else {
                        result.push(decl);
                    }
                }
            },
            recursiveDeclCache
        );

        recursiveDeclCache.delete(uniqueId);
        return result;
    }

    private _findMethodDeclarationsByName(
        sourceFile: SourceFile,
        className: string,
        functionName: string,
        recursiveDeclCache: Set<string>
    ): ClassOrFunctionOrVariableDeclaration[] {
        let result: ClassOrFunctionOrVariableDeclaration[] = [];

        const uniqueId = `@${sourceFile.getFilePath()}/c/${className}/f/${functionName}`;
        if (recursiveDeclCache.has(uniqueId)) {
            return result;
        }

        recursiveDeclCache.add(uniqueId);

        result = this._findMemberDeclarationsByName(
            sourceFile,
            className,
            functionName,
            (decl, cache, result) => {
                if (isFunctionDeclaration(decl)) {
                    if (isStubFile(decl.path)) {
                        result.push(...this._findFunctionOrTypeAliasDeclarations(decl, cache));
                    } else {
                        result.push(decl);
                    }
                }
            },
            recursiveDeclCache
        );

        recursiveDeclCache.delete(uniqueId);
        return result;
    }

    private _findVariableDeclarationsByName(
        sourceFile: SourceFile,
        variableName: string,
        recursiveDeclCache: Set<string>
    ): VariableDeclaration[] {
        const result: VariableDeclaration[] = [];

        const uniqueId = `@${sourceFile.getFilePath()}/v/${variableName}`;
        if (recursiveDeclCache.has(uniqueId)) {
            return result;
        }

        recursiveDeclCache.add(uniqueId);

        const decls = this._lookUpSymbolDeclarations(sourceFile.getParseResults()?.parseTree, variableName);
        for (const decl of decls) {
            this._addVariableDeclarations(decl, result, recursiveDeclCache);
        }

        recursiveDeclCache.delete(uniqueId);
        return result;
    }

    private _findFunctionDeclarationsByName(
        sourceFile: SourceFile,
        functionName: string,
        recursiveDeclCache: Set<string>
    ): ClassOrFunctionOrVariableDeclaration[] {
        const result: ClassOrFunctionOrVariableDeclaration[] = [];

        const uniqueId = `@${sourceFile.getFilePath()}/f/${functionName}`;
        if (recursiveDeclCache.has(uniqueId)) {
            return result;
        }

        recursiveDeclCache.add(uniqueId);

        const decls = this._lookUpSymbolDeclarations(sourceFile.getParseResults()?.parseTree, functionName);
        for (const decl of decls) {
            this._addClassOrFunctionDeclarations(decl, result, recursiveDeclCache);
        }

        recursiveDeclCache.delete(uniqueId);
        return result;
    }

    private _findClassDeclarationsByName(
        sourceFile: SourceFile,
        fullClassName: string,
        recursiveDeclCache: Set<string>
    ): ClassOrFunctionOrVariableDeclaration[] {
        let classDecls: ClassOrFunctionOrVariableDeclaration[] = [];

        // fullClassName is period delimited, for example: 'OuterClass.InnerClass'
        const parentNode = sourceFile.getParseResults()?.parseTree;
        if (parentNode) {
            let classNameParts = fullClassName.split('.');
            if (classNameParts.length > 0) {
                classDecls = this._findClassDeclarations(sourceFile, classNameParts[0], parentNode, recursiveDeclCache);
                classNameParts = classNameParts.slice(1);
            }

            for (const classNamePart of classNameParts) {
                classDecls = classDecls.flatMap((parentDecl) =>
                    this._findClassDeclarations(sourceFile, classNamePart, parentDecl.node, recursiveDeclCache)
                );
            }
        }

        return classDecls;
    }

    private _findClassDeclarations(
        sourceFile: SourceFile,
        className: string,
        parentNode: ParseNode,
        recursiveDeclCache: Set<string>
    ): ClassOrFunctionOrVariableDeclaration[] {
        const result: ClassOrFunctionOrVariableDeclaration[] = [];

        const uniqueId = `@${sourceFile.getFilePath()}[${parentNode.start}]${className}`;
        if (recursiveDeclCache.has(uniqueId)) {
            return result;
        }

        recursiveDeclCache.add(uniqueId);

        const decls = this._lookUpSymbolDeclarations(parentNode, className);
        for (const decl of decls) {
            this._addClassOrFunctionDeclarations(decl, result, recursiveDeclCache);
        }

        recursiveDeclCache.delete(uniqueId);
        return result;
    }

    private _addVariableDeclarations(
        decl: Declaration,
        result: ClassOrFunctionOrVariableDeclaration[],
        recursiveDeclCache: Set<string>
    ) {
        if (isVariableDeclaration(decl)) {
            if (isStubFile(decl.path)) {
                result.push(...this._findVariableDeclarations(decl, recursiveDeclCache));
            } else {
                result.push(decl);
            }
        } else if (isAliasDeclaration(decl)) {
            const resolvedDecl = this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
            if (resolvedDecl) {
                this._addVariableDeclarations(resolvedDecl, result, recursiveDeclCache);
            }
        }
    }

    private _addClassOrFunctionDeclarations(
        decl: Declaration,
        result: ClassOrFunctionOrVariableDeclaration[],
        recursiveDeclCache: Set<string>
    ) {
        if (isClassDeclaration(decl)) {
            if (isStubFile(decl.path)) {
                result.push(...this._findClassOrTypeAliasDeclarations(decl, recursiveDeclCache));
            } else {
                result.push(decl);
            }
        } else if (isFunctionDeclaration(decl)) {
            if (isStubFile(decl.path)) {
                result.push(...this._findFunctionOrTypeAliasDeclarations(decl, recursiveDeclCache));
            } else {
                result.push(decl);
            }
        } else if (isAliasDeclaration(decl)) {
            const resolvedDecl = this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
            if (resolvedDecl) {
                this._addClassOrFunctionDeclarations(resolvedDecl, result, recursiveDeclCache);
            }
        } else if (isVariableDeclaration(decl)) {
            // Always add decl. This handles a case where function is dynamically generated such as pandas.read_csv or type alias.
            this._addVariableDeclarations(decl, result, recursiveDeclCache);

            // And try to add the real decl if we can. Sometimes, we can't since import resolver can't follow up the type alias or assignment.
            // Import resolver can't resolve an import that only exists in the lib but not in the stub in certain circumstance.
            const nodeToBind = decl.typeAliasName ?? decl.node;
            const type = this._evaluator.getType(nodeToBind);
            if (!type) {
                return;
            }

            if (isFunction(type) && type.details.declaration) {
                this._addClassOrFunctionDeclarations(type.details.declaration, result, recursiveDeclCache);
            } else if (isOverloadedFunction(type)) {
                for (const overloadDecl of type.overloads.map((o) => o.details.declaration).filter(isDefined)) {
                    this._addClassOrFunctionDeclarations(overloadDecl, result, recursiveDeclCache);
                }
            } else if (type && isClass(type)) {
                const importResult = this._importResolver.resolveImport(decl.path, this._execEnv, {
                    leadingDots: 0,
                    nameParts: type.details.moduleName.split('.'),
                    importedSymbols: [],
                });

                if (importResult.isImportFound && importResult.resolvedPaths.length > 0) {
                    const sourceFile = this._boundSourceGetter(
                        importResult.resolvedPaths[importResult.resolvedPaths.length - 1]
                    );
                    if (sourceFile) {
                        const fullClassName = type.details.fullName.substring(
                            type.details.moduleName.length + 1 /* +1 for trailing dot */
                        );
                        result.push(
                            ...this._findClassDeclarationsByName(sourceFile, fullClassName, recursiveDeclCache)
                        );
                    }
                }
            }
        }
    }

    private _lookUpSymbolDeclarations(node: ParseNode | undefined, symbolName: string): Declaration[] {
        if (node === undefined) {
            return [];
        }

        const moduleScope = AnalyzerNodeInfo.getScope(node);
        const symbol = moduleScope?.lookUpSymbol(symbolName);
        const decls = symbol?.getDeclarations();

        return decls ?? [];
    }

    private _getFullClassName(node: ClassNode) {
        const fullName: string[] = [];

        let current: ClassNode | undefined = node;
        while (current !== undefined) {
            fullName.push(current.name.value);
            current = ParseTreeUtils.getEnclosingClass(current);
        }

        return fullName.reverse().join('.');
    }

    private _getBoundSourceFilesFromStubFile(stubFilePath: string): SourceFile[] {
        const paths = this._importResolver.getSourceFilesFromStub(stubFilePath, this._execEnv, this._mapCompiled);
        return paths.map((fp) => this._fileBinder(stubFilePath, fp)).filter(isDefined);
    }
}

export function isStubFile(filePath: string): boolean {
    return getAnyExtensionFromPath(filePath, ['.pyi'], /* ignoreCase */ false) === '.pyi';
}
