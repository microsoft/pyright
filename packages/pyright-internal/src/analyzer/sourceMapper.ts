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
    isSpecialBuiltInClassDeclaration,
    isVariableDeclaration,
    ParameterDeclaration,
    SpecialBuiltInClassDeclaration,
    VariableDeclaration,
} from './declaration';
import { ImportResolver } from './importResolver';
import { SourceFile } from './sourceFile';
import { TypeEvaluator } from './typeEvaluatorTypes';
import { ClassType, isFunction, isInstantiableClass, isOverloadedFunction } from './types';
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
        private _mapCompiled: boolean,
        private _preferStubs: boolean
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
        } else if (isSpecialBuiltInClassDeclaration(stubDecl)) {
            return this._findSpecialBuiltInClassDeclarations(stubDecl);
        }

        return [];
    }

    findClassDeclarations(stubDecl: ClassDeclaration): ClassDeclaration[] {
        return this._findClassOrTypeAliasDeclarations(stubDecl)
            .filter((d) => isClassDeclaration(d))
            .map((d) => d as ClassDeclaration);
    }

    findClassDeclarationsByType(originatedPath: string, type: ClassType): ClassDeclaration[] {
        const result: ClassOrFunctionOrVariableDeclaration[] = [];
        this._addClassTypeDeclarations(originatedPath, type, result, new Set<string>());
        return result.filter((r) => isClassDeclaration(r)).map((r) => r as ClassDeclaration);
    }

    findFunctionDeclarations(stubDecl: FunctionDeclaration): FunctionDeclaration[] {
        return this._findFunctionOrTypeAliasDeclarations(stubDecl)
            .filter((d) => isFunctionDeclaration(d))
            .map((d) => d as FunctionDeclaration);
    }

    private _findSpecialBuiltInClassDeclarations(
        stubDecl: SpecialBuiltInClassDeclaration,
        recursiveDeclCache = new Set<string>()
    ) {
        if (stubDecl.node.valueExpression.nodeType === ParseNodeType.Name) {
            const className = stubDecl.node.valueExpression.value;
            const sourceFiles = this._getBoundSourceFilesFromStubFile(stubDecl.path);

            return sourceFiles.flatMap((sourceFile) =>
                this._findClassDeclarationsByName(sourceFile, className, recursiveDeclCache)
            );
        }

        return [];
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
    ): ClassOrFunctionOrVariableDeclaration[] {
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

        recursiveDeclCache.add(uniqueId);

        result = this._findMemberDeclarationsByName(
            sourceFile,
            className,
            variableName,
            (decl, cache, result) => {
                if (isVariableDeclaration(decl)) {
                    if (this._isStubThatShouldBeMappedToImplementation(decl.path)) {
                        for (const implDecl of this._findVariableDeclarations(decl, cache)) {
                            if (isVariableDeclaration(implDecl)) {
                                result.push(implDecl);
                            }
                        }
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
                    if (this._isStubThatShouldBeMappedToImplementation(decl.path)) {
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
    ): ClassOrFunctionOrVariableDeclaration[] {
        const result: ClassOrFunctionOrVariableDeclaration[] = [];

        const uniqueId = `@${sourceFile.getFilePath()}/v/${variableName}`;
        if (recursiveDeclCache.has(uniqueId)) {
            return result;
        }

        recursiveDeclCache.add(uniqueId);

        const moduleNode = sourceFile.getParseResults()?.parseTree;
        if (!moduleNode) {
            // Don't bother deleting from the cache; we'll never get any info from this
            // file if it has no tree.
            return result;
        }

        const decls = this._lookUpSymbolDeclarations(moduleNode, variableName);
        if (decls.length === 0) {
            this._addDeclarationsFollowingWildcardImports(moduleNode, variableName, result, recursiveDeclCache);
        } else {
            for (const decl of decls) {
                this._addVariableDeclarations(decl, result, recursiveDeclCache);
            }
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

        const moduleNode = sourceFile.getParseResults()?.parseTree;
        if (!moduleNode) {
            // Don't bother deleting from the cache; we'll never get any info from this
            // file if it has no tree.
            return result;
        }

        const decls = this._lookUpSymbolDeclarations(moduleNode, functionName);
        if (decls.length === 0) {
            this._addDeclarationsFollowingWildcardImports(moduleNode, functionName, result, recursiveDeclCache);
        } else {
            for (const decl of decls) {
                this._addClassOrFunctionDeclarations(decl, result, recursiveDeclCache);
            }
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
        if (decls.length === 0 && parentNode.nodeType === ParseNodeType.Module) {
            this._addDeclarationsFollowingWildcardImports(parentNode, className, result, recursiveDeclCache);
        } else {
            for (const decl of decls) {
                this._addClassOrFunctionDeclarations(decl, result, recursiveDeclCache);
            }
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
            if (this._isStubThatShouldBeMappedToImplementation(decl.path)) {
                result.push(...this._findVariableDeclarations(decl, recursiveDeclCache));
            } else {
                result.push(decl);
            }
        } else if (isAliasDeclaration(decl)) {
            const resolvedDecl = this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
            if (resolvedDecl) {
                if (isVariableDeclaration(resolvedDecl)) {
                    this._addVariableDeclarations(resolvedDecl, result, recursiveDeclCache);
                } else if (isClassDeclaration(resolvedDecl) || isFunctionDeclaration(resolvedDecl)) {
                    this._addClassOrFunctionDeclarations(resolvedDecl, result, recursiveDeclCache);
                }
            }
        }
    }

    private _addClassOrFunctionDeclarations(
        decl: Declaration,
        result: ClassOrFunctionOrVariableDeclaration[],
        recursiveDeclCache: Set<string>
    ) {
        if (isClassDeclaration(decl)) {
            if (this._isStubThatShouldBeMappedToImplementation(decl.path)) {
                result.push(...this._findClassOrTypeAliasDeclarations(decl, recursiveDeclCache));
            } else {
                result.push(decl);
            }
        } else if (isFunctionDeclaration(decl)) {
            if (this._isStubThatShouldBeMappedToImplementation(decl.path)) {
                result.push(...this._findFunctionOrTypeAliasDeclarations(decl, recursiveDeclCache));
            } else {
                result.push(decl);
            }
        } else if (isAliasDeclaration(decl)) {
            const resolvedDecl = this._evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
            if (resolvedDecl && !isAliasDeclaration(resolvedDecl)) {
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
            } else if (isInstantiableClass(type)) {
                this._addClassTypeDeclarations(decl.path, type, result, recursiveDeclCache);
            }
        }
    }

    private _addClassTypeDeclarations(
        originated: string,
        type: ClassType,
        result: ClassOrFunctionOrVariableDeclaration[],
        recursiveDeclCache: Set<string>
    ) {
        const filePath = type.details.filePath;
        const sourceFiles = this._getSourceFiles(filePath);

        const fullClassName = type.details.fullName.substring(
            type.details.moduleName.length + 1 /* +1 for trailing dot */
        );

        for (const sourceFile of sourceFiles) {
            result.push(...this._findClassDeclarationsByName(sourceFile, fullClassName, recursiveDeclCache));
        }
    }

    private _getSourceFiles(filePath: string) {
        const sourceFiles: SourceFile[] = [];

        if (this._isStubThatShouldBeMappedToImplementation(filePath)) {
            sourceFiles.push(...this._getBoundSourceFilesFromStubFile(filePath));
        } else {
            const sourceFile = this._boundSourceGetter(filePath);
            if (sourceFile) {
                sourceFiles.push(sourceFile);
            }
        }

        return sourceFiles;
    }

    private _addDeclarationsFollowingWildcardImports(
        moduleNode: ModuleNode,
        symbolName: string,
        result: ClassOrFunctionOrVariableDeclaration[],
        recursiveDeclCache: Set<string>
    ) {
        // Symbol exists in a stub doesn't exist in a python file. Use some heuristic
        // to find one from sources.
        const table = AnalyzerNodeInfo.getScope(moduleNode)?.symbolTable;
        if (!table) {
            return;
        }

        // Dig down imports with wildcard imports.
        for (const symbol of table.values()) {
            for (const decl of symbol.getDeclarations()) {
                if (
                    !isAliasDeclaration(decl) ||
                    !decl.path ||
                    decl.node.nodeType !== ParseNodeType.ImportFrom ||
                    !decl.node.isWildcardImport
                ) {
                    continue;
                }

                const uniqueId = `@${decl.path}/l/${symbolName}`;
                if (recursiveDeclCache.has(uniqueId)) {
                    continue;
                }

                // While traversing these tables, we may encounter the same decl
                // more than once (via different files' wildcard imports). To avoid this,
                // add an ID unique to this function to the recursiveDeclCache to deduplicate
                // them.
                //
                // The ID is not deleted to avoid needing a second Set to track all decls
                // seen in this function. This is safe because the ID here is unique to this
                // function.
                recursiveDeclCache.add(uniqueId);

                const sourceFiles = this._getSourceFiles(decl.path);
                for (const sourceFile of sourceFiles) {
                    const moduleNode = sourceFile.getParseResults()?.parseTree;
                    if (!moduleNode) {
                        continue;
                    }

                    const decls = this._lookUpSymbolDeclarations(moduleNode, symbolName);
                    if (decls.length === 0) {
                        this._addDeclarationsFollowingWildcardImports(
                            moduleNode,
                            symbolName,
                            result,
                            recursiveDeclCache
                        );
                    } else {
                        for (const decl of decls) {
                            const resolvedDecl = this._evaluator.resolveAliasDeclaration(
                                decl,
                                /* resolveLocalNames */ true
                            );
                            if (!resolvedDecl) {
                                continue;
                            }

                            if (isFunctionDeclaration(resolvedDecl) || isClassDeclaration(resolvedDecl)) {
                                this._addClassOrFunctionDeclarations(resolvedDecl, result, recursiveDeclCache);
                            } else if (isVariableDeclaration(resolvedDecl)) {
                                this._addVariableDeclarations(resolvedDecl, result, recursiveDeclCache);
                            }
                        }
                    }
                }
            }
        }
    }

    private _lookUpSymbolDeclarations(node: ParseNode | undefined, symbolName: string): Declaration[] {
        if (node === undefined) {
            return [];
        }

        const containingScope = AnalyzerNodeInfo.getScope(node);
        const symbol = containingScope?.lookUpSymbol(symbolName);
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

    private _isStubThatShouldBeMappedToImplementation(filePath: string): boolean {
        if (this._preferStubs) {
            return false;
        }

        const stub = isStubFile(filePath);
        if (!stub) {
            return false;
        }

        // If we get the same file as a source file, then we treat the file as a regular file even if it has "pyi" extension.
        return this._importResolver
            .getSourceFilesFromStub(filePath, this._execEnv, this._mapCompiled)
            .every((f) => f !== filePath);
    }
}

export function isStubFile(filePath: string): boolean {
    return getAnyExtensionFromPath(filePath, ['.pyi'], /* ignoreCase */ false) === '.pyi';
}
