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
import { getAnyExtensionFromPath } from '../common/pathUtils';
import { ClassNode, ModuleNode, ParseNode } from '../parser/parseNodes';
import { ClassDeclaration, Declaration, DeclarationType, FunctionDeclaration } from './declaration';
import { ImportResolver } from './importResolver';
import { SourceFile } from './sourceFile';
import { TypeEvaluator } from './typeEvaluator';

// Creates and binds a shadowed file within the program.
export type ShadowFileBinder = (stubFilePath: string, implFilePath: string) => SourceFile | undefined;

export class SourceMapper {
    constructor(
        private _importResolver: ImportResolver,
        private _execEnv: ExecutionEnvironment,
        private _evaluator: TypeEvaluator,
        private _fileBinder: ShadowFileBinder
    ) {}

    public findModules(stubFilePath: string): ModuleNode[] {
        const sourceFiles = this._getBoundSourceFiles(stubFilePath);
        return sourceFiles.map((sf) => sf.getParseResults()?.parseTree).filter(_isDefined);
    }

    public findDeclarations(stubDecl: Declaration): Declaration[] {
        if (stubDecl.type === DeclarationType.Class) {
            return this.findClassDeclarations(stubDecl);
        } else if (stubDecl.type === DeclarationType.Function) {
            return this.findFunctionDeclarations(stubDecl);
        }

        return [];
    }

    public findClassDeclarations(stubDecl: ClassDeclaration): ClassDeclaration[] {
        const className = this._getFullClassName(stubDecl.node);

        const sourceFiles = this._getBoundSourceFiles(stubDecl.path);
        return sourceFiles.flatMap((sourceFile) => this._findClassDeclarations(sourceFile, className));
    }

    public findFunctionDeclarations(stubDecl: FunctionDeclaration): FunctionDeclaration[] {
        const functionName = stubDecl.node.name.value;
        const sourceFiles = this._getBoundSourceFiles(stubDecl.path);

        if (stubDecl.isMethod) {
            const classNode = ParseTreeUtils.getEnclosingClass(stubDecl.node);
            if (classNode === undefined) {
                return [];
            }

            const className = this._getFullClassName(classNode);

            return sourceFiles.flatMap((sourceFile) =>
                this._findMethodDeclarations(sourceFile, className, functionName)
            );
        } else {
            return sourceFiles.flatMap((sourceFile) => this._findFunctionDeclarations(sourceFile, functionName));
        }
    }

    private _findMethodDeclarations(
        sourceFile: SourceFile,
        className: string,
        functionName: string
    ): FunctionDeclaration[] {
        const result: FunctionDeclaration[] = [];

        const classDecls = this._findClassDeclarations(sourceFile, className);

        for (const classDecl of classDecls) {
            const methodDecls = this._lookUpSymbolDeclarations(classDecl.node, functionName);
            for (const methodDecl of methodDecls) {
                if (methodDecl.type === DeclarationType.Function && methodDecl.isMethod) {
                    result.push(methodDecl);
                }
            }
        }

        return result;
    }

    private _findFunctionDeclarations(sourceFile: SourceFile, functionName: string): FunctionDeclaration[] {
        const result: FunctionDeclaration[] = [];

        const functionDecls = this._lookUpSymbolDeclarations(sourceFile.getParseResults()?.parseTree, functionName);

        for (const functionDecl of functionDecls) {
            if (functionDecl.type === DeclarationType.Function) {
                result.push(functionDecl);
            } else if (functionDecl.type === DeclarationType.Alias) {
                const resolvedDecl = this._evaluator.resolveAliasDeclaration(
                    functionDecl,
                    /* resolveLocalNames */ true
                );
                if (resolvedDecl) {
                    if (resolvedDecl.type === DeclarationType.Function) {
                        if (isStubFile(resolvedDecl.path)) {
                            result.push(...this.findFunctionDeclarations(resolvedDecl));
                        } else {
                            result.push(resolvedDecl);
                        }
                    }
                }
            }
        }

        return result;
    }

    private _findClassDeclarations(sourceFile: SourceFile, fullClassName: string): ClassDeclaration[] {
        let result: ClassDeclaration[] = [];

        // fullClassName is period delimited, for example: 'OuterClass.InnerClass'
        const parentNode = sourceFile.getParseResults()?.parseTree;
        if (parentNode) {
            let classNameParts = fullClassName.split('.');
            if (classNameParts.length > 0) {
                result = this._findClassDeclarationsUnderNode(sourceFile, classNameParts[0], parentNode);
                classNameParts = classNameParts.slice(1);
            }

            for (const classNamePart of classNameParts) {
                result = this._findClassDeclarationsUnderClass(sourceFile, classNamePart, result);
            }
        }

        return result;
    }

    private _findClassDeclarationsUnderClass(
        sourceFile: SourceFile,
        className: string,
        parentClassDecls: ClassDeclaration[]
    ): ClassDeclaration[] {
        return parentClassDecls.flatMap((parentDecl) =>
            this._findClassDeclarationsUnderNode(sourceFile, className, parentDecl.node)
        );
    }

    private _findClassDeclarationsUnderNode(
        sourceFile: SourceFile,
        className: string,
        parentNode: ParseNode
    ): ClassDeclaration[] {
        const result: ClassDeclaration[] = [];

        for (const decl of this._lookUpSymbolDeclarations(parentNode, className)) {
            if (decl.type === DeclarationType.Class) {
                result.push(decl);
            }
        }

        return result;
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

    private _getBoundSourceFiles(stubFilePath: string): SourceFile[] {
        const paths = this._importResolver.getSourceFilesFromStub(stubFilePath, this._execEnv);
        return paths.map((fp) => this._fileBinder(stubFilePath, fp)).filter(_isDefined);
    }
}

export function isStubFile(filePath: string): boolean {
    return getAnyExtensionFromPath(filePath, ['.pyi'], /* ignoreCase */ false) === '.pyi';
}

function _isDefined<T>(element: T | undefined): element is T {
    return element !== undefined;
}
