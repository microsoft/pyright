/*
 * sourceMapper.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that maps a ".pyi" stub to its ".py" source file.
 */

import { CancellationToken } from 'vscode-jsonrpc';

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { appendArray } from '../common/collectionUtils';
import { ExecutionEnvironment } from '../common/configOptions';
import { isDefined } from '../common/core';
import { assert, assertNever } from '../common/debug';
import { Uri } from '../common/uri/uri';
import { ClassNode, ModuleNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import {
    AliasDeclaration,
    ClassDeclaration,
    Declaration,
    FunctionDeclaration,
    isAliasDeclaration,
    isClassDeclaration,
    isFunctionDeclaration,
    isParamDeclaration,
    isSpecialBuiltInClassDeclaration,
    isVariableDeclaration,
    ParamDeclaration,
    SpecialBuiltInClassDeclaration,
    VariableDeclaration,
} from './declaration';
import { ImportResolver } from './importResolver';
import { SourceFile } from './sourceFile';
import { SourceFileInfo } from './sourceFileInfo';
import { isUserCode } from './sourceFileInfoUtils';
import { buildImportTree } from './sourceMapperUtils';
import { TypeEvaluator } from './typeEvaluatorTypes';
import { lookUpClassMember } from './typeUtils';
import { ClassType, isFunction, isInstantiableClass, isOverloaded, OverloadedType } from './types';

type ClassOrFunctionOrVariableDeclaration =
    | ClassDeclaration
    | SpecialBuiltInClassDeclaration
    | FunctionDeclaration
    | VariableDeclaration;

// Creates and binds a shadowed file within the program.
export type ShadowFileBinder = (stubFileUri: Uri, implFileUri: Uri) => SourceFile | undefined;
export type BoundSourceGetter = (fileUri: Uri) => SourceFileInfo | undefined;

export class SourceMapper {
    constructor(
        private _importResolver: ImportResolver,
        private _execEnv: ExecutionEnvironment,
        private _evaluator: TypeEvaluator,
        private _fileBinder: ShadowFileBinder,
        private _boundSourceGetter: BoundSourceGetter,
        private _mapCompiled: boolean,
        private _preferStubs: boolean,
        private _fromFile: SourceFileInfo | undefined,
        private _cancelToken: CancellationToken
    ) {}

    findModules(stubFileUri: Uri): ModuleNode[] {
        const sourceFiles = this._isStubThatShouldBeMappedToImplementation(stubFileUri)
            ? this._getBoundSourceFilesFromStubFile(stubFileUri)
            : [this._boundSourceGetter(stubFileUri)?.sourceFile];

        return sourceFiles
            .filter(isDefined)
            .map((sf) => sf.getParserOutput()?.parseTree)
            .filter(isDefined);
    }

    getModuleNode(fileUri: Uri): ModuleNode | undefined {
        return this._boundSourceGetter(fileUri)?.sourceFile.getParserOutput()?.parseTree;
    }

    findDeclarations(stubDecl: Declaration): Declaration[] {
        if (isClassDeclaration(stubDecl)) {
            return this._findClassOrTypeAliasDeclarations(stubDecl);
        } else if (isFunctionDeclaration(stubDecl)) {
            return this._findFunctionOrTypeAliasDeclarations(stubDecl);
        } else if (isVariableDeclaration(stubDecl)) {
            return this._findVariableDeclarations(stubDecl);
        } else if (isParamDeclaration(stubDecl)) {
            return this._findParamDeclarations(stubDecl);
        } else if (isSpecialBuiltInClassDeclaration(stubDecl)) {
            return this._findSpecialBuiltInClassDeclarations(stubDecl);
        }

        return [];
    }

    findDeclarationsByType(originatedPath: Uri, type: ClassType, useTypeAlias = false): Declaration[] {
        const result: ClassOrFunctionOrVariableDeclaration[] = [];
        this._addClassTypeDeclarations(originatedPath, type, result, new Set<string>(), useTypeAlias);
        return result;
    }

    findClassDeclarationsByType(originatedPath: Uri, type: ClassType): ClassDeclaration[] {
        const result = this.findDeclarationsByType(originatedPath, type);
        return result.filter((r) => isClassDeclaration(r)).map((r) => r);
    }

    findFunctionDeclarations(stubDecl: FunctionDeclaration): FunctionDeclaration[] {
        return this._findFunctionOrTypeAliasDeclarations(stubDecl)
            .filter((d) => isFunctionDeclaration(d))
            .map((d) => d);
    }

    isUserCode(uri: Uri): boolean {
        return isUserCode(this._boundSourceGetter(uri));
    }

    getNextFileName(uri: Uri) {
        const withoutExtension = uri.stripExtension();
        let suffix = 1;
        let result = withoutExtension.addExtension(`_${suffix}.py`);
        while (this.isUserCode(result) && suffix < 1000) {
            suffix += 1;
            result = withoutExtension.addExtension(`_${suffix}.py`);
        }
        return result;
    }

    private _findSpecialBuiltInClassDeclarations(
        stubDecl: SpecialBuiltInClassDeclaration,
        recursiveDeclCache = new Set<string>()
    ) {
        if (stubDecl.node.d.valueExpr.nodeType === ParseNodeType.Name) {
            const className = stubDecl.node.d.valueExpr.d.value;
            const sourceFiles = this._getBoundSourceFilesFromStubFile(stubDecl.uri);

            return sourceFiles.flatMap((sourceFile) =>
                this._findClassDeclarationsByName(sourceFile, className, recursiveDeclCache)
            );
        }

        return [];
    }

    private _findClassOrTypeAliasDeclarations(stubDecl: ClassDeclaration, recursiveDeclCache = new Set<string>()) {
        const className = this._getFullClassName(stubDecl.node);
        const sourceFiles = this._getBoundSourceFilesFromStubFile(stubDecl.uri);

        return sourceFiles.flatMap((sourceFile) =>
            this._findClassDeclarationsByName(sourceFile, className, recursiveDeclCache)
        );
    }

    private _findFunctionOrTypeAliasDeclarations(
        stubDecl: FunctionDeclaration,
        recursiveDeclCache = new Set<string>()
    ): ClassOrFunctionOrVariableDeclaration[] {
        const functionName = stubDecl.node.d.name.d.value;
        const sourceFiles = this._getBoundSourceFilesFromStubFile(stubDecl.uri);

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

        const variableName = stubDecl.node.d.value;
        const sourceFiles = this._getBoundSourceFilesFromStubFile(stubDecl.uri);
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

    private _findParamDeclarations(stubDecl: ParamDeclaration): ParamDeclaration[] {
        const result: ParamDeclaration[] = [];

        if (!stubDecl.node.d.name) {
            return result;
        }

        const functionNode = ParseTreeUtils.getEnclosingFunction(stubDecl.node);
        if (!functionNode) {
            return result;
        }

        const functionStubDecls = this._evaluator.getDeclInfoForNameNode(functionNode.d.name)?.decls;
        if (!functionStubDecls) {
            return result;
        }

        const recursiveDeclCache = new Set<string>();
        for (const functionStubDecl of functionStubDecls) {
            if (isFunctionDeclaration(functionStubDecl)) {
                for (const functionDecl of this._findFunctionOrTypeAliasDeclarations(
                    functionStubDecl,
                    recursiveDeclCache
                )) {
                    appendArray(
                        result,
                        this._lookUpSymbolDeclarations(functionDecl.node, stubDecl.node.d.name.d.value)
                            .filter((d) => isParamDeclaration(d))
                            .map((d) => d)
                    );
                }
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

        for (const classDecl of classDecls.filter((d) => isClassDeclaration(d)).map((d) => d)) {
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

        const uniqueId = `@${sourceFile.getUri()}/c/${className}/v/${variableName}`;
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
                    if (this._isStubThatShouldBeMappedToImplementation(decl.uri)) {
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

        const uniqueId = `@${sourceFile.getUri()}/c/${className}/f/${functionName}`;
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
                    if (this._isStubThatShouldBeMappedToImplementation(decl.uri)) {
                        appendArray(result, this._findFunctionOrTypeAliasDeclarations(decl, cache));
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

        const uniqueId = `@${sourceFile.getUri()}/v/${variableName}`;
        if (recursiveDeclCache.has(uniqueId)) {
            return result;
        }

        recursiveDeclCache.add(uniqueId);

        const moduleNode = sourceFile.getParserOutput()?.parseTree;
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

        const uniqueId = `@${sourceFile.getUri()}/f/${functionName}`;
        if (recursiveDeclCache.has(uniqueId)) {
            return result;
        }

        recursiveDeclCache.add(uniqueId);

        const moduleNode = sourceFile.getParserOutput()?.parseTree;
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
        const parentNode = sourceFile.getParserOutput()?.parseTree;
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

        const uniqueId = `@${sourceFile.getUri()}[${parentNode.start}]${className}`;
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
            if (this._isStubThatShouldBeMappedToImplementation(decl.uri)) {
                appendArray(result, this._findVariableDeclarations(decl, recursiveDeclCache));
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
            if (this._isStubThatShouldBeMappedToImplementation(decl.uri)) {
                appendArray(result, this._findClassOrTypeAliasDeclarations(decl, recursiveDeclCache));
            } else {
                result.push(decl);
            }
        } else if (isSpecialBuiltInClassDeclaration(decl)) {
            result.push(decl);
        } else if (isFunctionDeclaration(decl)) {
            if (this._isStubThatShouldBeMappedToImplementation(decl.uri)) {
                appendArray(result, this._findFunctionOrTypeAliasDeclarations(decl, recursiveDeclCache));
            } else {
                result.push(decl);
            }
        } else if (isAliasDeclaration(decl)) {
            const adjustedDecl = this._handleSpecialBuiltInModule(decl);
            const resolvedDecl = this._evaluator.resolveAliasDeclaration(adjustedDecl, /* resolveLocalNames */ true);
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

            if (isFunction(type) && type.shared.declaration) {
                this._addClassOrFunctionDeclarations(type.shared.declaration, result, recursiveDeclCache);
            } else if (isOverloaded(type)) {
                const overloads = OverloadedType.getOverloads(type);
                for (const overloadDecl of overloads.map((o) => o.shared.declaration).filter(isDefined)) {
                    this._addClassOrFunctionDeclarations(overloadDecl, result, recursiveDeclCache);
                }
            } else if (isInstantiableClass(type)) {
                this._addClassTypeDeclarations(decl.uri, type, result, recursiveDeclCache);
            }
        }
    }

    private _handleSpecialBuiltInModule(decl: AliasDeclaration) {
        // Some stdlib modules import builtin modules that don't actually exist as a file.
        // For example, io.py has an import statement such as from _io import (..., ByteIO)
        // but _io doesn't actually exist on disk so, decl.path will be empty.
        // That means for symbols that belong to _io such as ByteIO, our regular method
        // won't work. to make it work, this method does 2 things, first, it fakes path
        // to _io in stdlib path which doesn't actually exist and call getSourceFiles to
        // generate or extract builtin module info from runtime, the same way we do for builtin.pyi,
        // and second, clone the given decl and set path to the generated pyi for the
        // builtin module (ex, _io) to make resolveAliasDeclaration to work.
        // once the path is set, our regular code path will work as expected.
        if (!decl.uri.isEmpty() || !decl.node) {
            // If module actually exists, nothing we need to do.
            return decl;
        }

        // See if it is one of those special cases.
        if (decl.moduleName !== 'io' && decl.moduleName !== 'collections') {
            return decl;
        }

        const stdLibPath = this._importResolver.getTypeshedStdLibPath(this._execEnv);
        if (!stdLibPath) {
            return decl;
        }

        const fileInfo = ParseTreeUtils.getFileInfoFromNode(decl.node);
        if (!fileInfo) {
            return decl;
        }

        // ImportResolver might be able to generate or extract builtin module's info
        // from runtime if we provide right synthesized stub path.
        const fakeStubPath = stdLibPath.combinePaths(
            getModuleName()
                .d.nameParts.map((n) => n.d.value)
                .join('.') + '.pyi'
        );

        const sources = this._getSourceFiles(fakeStubPath, fileInfo.fileUri);
        if (sources.length === 0) {
            return decl;
        }

        const synthesizedDecl = { ...decl };
        synthesizedDecl.uri = sources[0].getUri();

        return synthesizedDecl;

        function getModuleName() {
            switch (decl.node.nodeType) {
                case ParseNodeType.ImportAs:
                    return decl.node.d.module;
                case ParseNodeType.ImportFromAs:
                    assert(decl.node.parent?.nodeType === ParseNodeType.ImportFrom);
                    return decl.node.parent.d.module;
                case ParseNodeType.ImportFrom:
                    return decl.node.d.module;
                default:
                    return assertNever(decl.node);
            }
        }
    }

    private _addClassTypeDeclarations(
        originated: Uri,
        type: ClassType,
        result: ClassOrFunctionOrVariableDeclaration[],
        recursiveDeclCache: Set<string>,
        useTypeAlias = false
    ) {
        const fileUri =
            useTypeAlias && type.props?.typeAliasInfo ? type.props.typeAliasInfo.shared.fileUri : type.shared.fileUri;
        const sourceFiles = this._getSourceFiles(fileUri, /* stubToShadow */ undefined, originated);

        const fullName =
            useTypeAlias && type.props?.typeAliasInfo ? type.props.typeAliasInfo.shared.fullName : type.shared.fullName;
        const moduleName =
            useTypeAlias && type.props?.typeAliasInfo
                ? type.props.typeAliasInfo.shared.moduleName
                : type.shared.moduleName;
        const fullClassName = fullName.substring(moduleName.length + 1 /* +1 for trailing dot */);

        for (const sourceFile of sourceFiles) {
            appendArray(result, this._findClassDeclarationsByName(sourceFile, fullClassName, recursiveDeclCache));
        }
    }

    private _getSourceFiles(fileUri: Uri, stubToShadow?: Uri, originated?: Uri) {
        const sourceFiles: SourceFile[] = [];

        if (this._isStubThatShouldBeMappedToImplementation(fileUri)) {
            appendArray(sourceFiles, this._getBoundSourceFilesFromStubFile(fileUri, stubToShadow, originated));
        } else {
            const sourceFileInfo = this._boundSourceGetter(fileUri);
            if (sourceFileInfo) {
                sourceFiles.push(sourceFileInfo.sourceFile);
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
                    decl.uri.isEmpty() ||
                    decl.node.nodeType !== ParseNodeType.ImportFrom ||
                    !decl.node.d.isWildcardImport
                ) {
                    continue;
                }

                const uniqueId = `@${decl.uri.key}/l/${symbolName}`;
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

                const sourceFiles = this._getSourceFiles(decl.uri);
                for (const sourceFile of sourceFiles) {
                    const moduleNode = sourceFile.getParserOutput()?.parseTree;
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
            fullName.push(current.d.name.d.value);
            current = ParseTreeUtils.getEnclosingClass(current);
        }

        return fullName.reverse().join('.');
    }

    private _getBoundSourceFilesFromStubFile(stubFileUri: Uri, stubToShadow?: Uri, originated?: Uri): SourceFile[] {
        const paths = this._getSourcePathsFromStub(stubFileUri, originated ?? this._fromFile?.uri);
        return paths.map((fp) => this._fileBinder(stubToShadow ?? stubFileUri, fp)).filter(isDefined);
    }

    private _getSourcePathsFromStub(stubFileUri: Uri, fromFile: Uri | undefined): Uri[] {
        // Attempt our stubFileUri to see if we can resolve it as a source file path
        let results = this._importResolver.getSourceFilesFromStub(stubFileUri, this._execEnv, this._mapCompiled);
        if (results.length > 0) {
            return results;
        }

        // If that didn't work, try looking through the graph up to our fromFile.
        // One of them should be able to resolve to an actual file.
        const stubFileImportTree = this._getStubFileImportTree(stubFileUri, fromFile);

        // Go through the items in this tree until we find at least one path.
        for (let i = 0; i < stubFileImportTree.length; i++) {
            results = this._importResolver.getSourceFilesFromStub(
                stubFileImportTree[i],
                this._execEnv,
                this._mapCompiled
            );
            if (results.length > 0) {
                return results;
            }
        }

        return [];
    }

    private _getStubFileImportTree(stubFileUri: Uri, fromFile: Uri | undefined): Uri[] {
        if (!fromFile || !this._isStubThatShouldBeMappedToImplementation(stubFileUri)) {
            // No path to search, just return the starting point.
            return [stubFileUri];
        } else {
            // Otherwise recurse through the importedBy list up to our 'fromFile'.
            return buildImportTree(
                fromFile,
                stubFileUri,
                (p) => {
                    const boundSourceInfo = this._boundSourceGetter(p);
                    return boundSourceInfo ? boundSourceInfo.importedBy.map((info) => info.uri) : [];
                },
                this._cancelToken
            ).filter((p) => this._isStubThatShouldBeMappedToImplementation(p));
        }
    }

    private _isStubThatShouldBeMappedToImplementation(fileUri: Uri): boolean {
        if (this._preferStubs) {
            return false;
        }

        const stub = isStubFile(fileUri);
        if (!stub) {
            return false;
        }

        // If we get the same file as a source file, then we treat the file as a regular file even if it has "pyi" extension.
        return this._importResolver
            .getSourceFilesFromStub(fileUri, this._execEnv, this._mapCompiled)
            .every((f) => f !== fileUri);
    }
}

export function isStubFile(uri: Uri): boolean {
    return uri.lastExtension === '.pyi';
}
