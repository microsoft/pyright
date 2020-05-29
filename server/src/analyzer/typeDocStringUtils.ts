/*
 * typeDocStringUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that obtains the doc string for types by looking
 * at the declaration in the type stub, and if needed, in
 * the source file.
 */

import { ClassDeclaration, DeclarationBase, DeclarationType, FunctionDeclaration } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { ClassType, FunctionType, ModuleType, OverloadedFunctionType } from '../analyzer/types';
import { ModuleNode } from '../parser/parseNodes';

export function getOverloadedFunctionDocStrings(
    type: OverloadedFunctionType,
    resolvedDecl: DeclarationBase | undefined,
    sourceMapper: SourceMapper
) {
    const docStrings: string[] = [];
    if (type.overloads.some((o) => o.details.docString)) {
        type.overloads.forEach((overload) => {
            if (overload.details.docString) {
                docStrings.push(overload.details.docString);
            }
        });
    } else if (resolvedDecl && isStubFile(resolvedDecl.path) && resolvedDecl.type === DeclarationType.Function) {
        const implDecls = sourceMapper.findFunctionDeclarations(resolvedDecl as FunctionDeclaration);
        const docString = _getFunctionOrClassDeclDocString(implDecls);
        if (docString) {
            docStrings.push(docString);
        }
    }
    return docStrings;
}

export function getModuleDocString(
    type: ModuleType,
    resolvedDecl: DeclarationBase | undefined,
    sourceMapper: SourceMapper
) {
    let docString = type.docString;
    if (!docString) {
        if (resolvedDecl && isStubFile(resolvedDecl.path)) {
            const modules = sourceMapper.findModules(resolvedDecl.path);
            docString = _getModuleNodeDocString(modules);
        }
    }
    return docString;
}

export function getClassDocString(
    type: ClassType,
    resolvedDecl: DeclarationBase | undefined,
    sourceMapper: SourceMapper
) {
    let docString = type.details.docString;
    if (!docString) {
        if (resolvedDecl && isStubFile(resolvedDecl.path) && resolvedDecl.type === DeclarationType.Class) {
            const implDecls = sourceMapper.findClassDeclarations(resolvedDecl as ClassDeclaration);
            docString = _getFunctionOrClassDeclDocString(implDecls);
        }
    }
    return docString;
}

export function getFunctionDocStringFromType(type: FunctionType, sourceMapper: SourceMapper) {
    let docString = type.details.docString;
    if (!docString && type.details.declaration) {
        docString = getFunctionDocStringFromDeclaration(type.details.declaration, sourceMapper);
    }
    return docString;
}

export function getFunctionDocStringFromDeclaration(resolvedDecl: FunctionDeclaration, sourceMapper: SourceMapper) {
    let docString = _getFunctionOrClassDeclDocString([resolvedDecl]);
    if (!docString && isStubFile(resolvedDecl.path)) {
        const implDecls = sourceMapper.findFunctionDeclarations(resolvedDecl);
        docString = _getFunctionOrClassDeclDocString(implDecls);
    }
    return docString;
}

function _getFunctionOrClassDeclDocString(decls: FunctionDeclaration[] | ClassDeclaration[]): string | undefined {
    for (const decl of decls) {
        const docString = ParseTreeUtils.getDocString(decl.node?.suite?.statements);
        if (docString) {
            return docString;
        }
    }

    return undefined;
}

function _getModuleNodeDocString(modules: ModuleNode[]): string | undefined {
    for (const module of modules) {
        if (module.statements) {
            const docString = ParseTreeUtils.getDocString(module.statements);
            if (docString) {
                return docString;
            }
        }
    }

    return undefined;
}
