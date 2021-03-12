/*
 * typeDocStringUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that obtains the doc string for types by looking
 * at the declaration in the type stub, and if needed, in
 * the source file.
 */

import {
    ClassDeclaration,
    Declaration,
    DeclarationBase,
    DeclarationType,
    FunctionDeclaration,
    isClassDeclaration,
    isFunctionDeclaration,
} from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import {
    ClassType,
    FunctionType,
    isClass,
    isFunction,
    isOverloadedFunction,
    ModuleType,
    OverloadedFunctionType,
    Type,
} from '../analyzer/types';
import { ModuleNode, ParseNodeType } from '../parser/parseNodes';
import { TypeEvaluator } from './typeEvaluator';
import {
    ClassIteratorFlags,
    ClassMemberLookupFlags,
    getClassIterator,
    getClassMemberIterator,
    isProperty,
} from './typeUtils';

export function getPropertyDocStringInherited(
    resolvedDecl: Declaration | undefined,
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator,
    classType: ClassType
) {
    if (!resolvedDecl || !isFunctionDeclaration(resolvedDecl)) {
        return;
    }

    const declaredType = evaluator.getTypeForDeclaration(resolvedDecl);
    if (!declaredType || !isProperty(declaredType)) {
        return;
    }

    const fieldName = resolvedDecl.node.nodeType === ParseNodeType.Function ? resolvedDecl.node.name.value : undefined;
    if (!fieldName) {
        return;
    }

    const classItr = getClassIterator(classType, ClassIteratorFlags.Default);
    // Walk the inheritance list starting with the current class searching for docStrings
    for (const [mroClass] of classItr) {
        if (!isClass(mroClass)) {
            continue;
        }

        const symbol = mroClass.details.fields.get(fieldName);
        // Get both the setter and getter declarations
        const decls = symbol?.getDeclarations();
        if (decls) {
            for (const decl of decls) {
                if (isFunctionDeclaration(decl)) {
                    const declaredType = evaluator.getTypeForDeclaration(decl);
                    if (declaredType && isProperty(declaredType)) {
                        const docString = getFunctionDocStringFromDeclaration(decl, sourceMapper);
                        if (docString) {
                            return docString;
                        }
                    }
                }
            }
        }
    }

    return;
}

const DefaultClassIteratorFlagsForFunctions =
    ClassMemberLookupFlags.SkipInstanceVariables |
    ClassMemberLookupFlags.SkipOriginalClass |
    ClassMemberLookupFlags.DeclaredTypesOnly;

export function getFunctionDocStringInherited(
    type: FunctionType,
    resolvedDecl: Declaration | undefined,
    sourceMapper: SourceMapper,
    classType?: ClassType
) {
    let docString: string | undefined;

    if (resolvedDecl && isFunctionDeclaration(resolvedDecl)) {
        docString = getFunctionDocString(type, resolvedDecl, sourceMapper);
    }

    // Search mro
    if (!docString && classType) {
        const funcName = type.details.name;
        const memberIterator = getClassMemberIterator(classType, funcName, DefaultClassIteratorFlagsForFunctions);

        for (const classMember of memberIterator) {
            const decls = classMember.symbol.getDeclarations();
            if (decls.length > 0) {
                const inheritedDecl = classMember.symbol.getDeclarations().slice(-1)[0];
                if (isFunctionDeclaration(inheritedDecl)) {
                    docString = getFunctionDocStringFromDeclaration(inheritedDecl, sourceMapper);
                    if (docString) {
                        break;
                    }
                }
            }
        }
    }

    return docString;
}

export function getOverloadedFunctionDocStringsInherited(
    type: OverloadedFunctionType,
    resolvedDecl: Declaration | undefined,
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator,
    classType?: ClassType
) {
    let docStrings = getOverloadedFunctionDocStrings(type, resolvedDecl, sourceMapper);
    if (docStrings && docStrings.length > 0) {
        return docStrings;
    }

    // Search mro
    if (classType && type.overloads.length > 0) {
        const funcName = type.overloads[0].details.name;
        const memberIterator = getClassMemberIterator(classType, funcName, DefaultClassIteratorFlagsForFunctions);

        for (const classMember of memberIterator) {
            const inheritedDecl = classMember.symbol.getDeclarations().slice(-1)[0];
            const declType = evaluator.getTypeForDeclaration(inheritedDecl);
            if (declType) {
                docStrings = getOverloadedFunctionDocStrings(declType, inheritedDecl, sourceMapper);
                if (docStrings && docStrings.length > 0) {
                    break;
                }
            }
        }
    }

    return docStrings ?? [];
}

function getOverloadedFunctionDocStrings(
    type: Type,
    resolvedDecl: Declaration | undefined,
    sourceMapper: SourceMapper
) {
    if (!isOverloadedFunction(type)) {
        return undefined;
    }

    const docStrings: string[] = [];
    if (type.overloads.some((o) => o.details.docString)) {
        type.overloads.forEach((overload) => {
            if (overload.details.docString) {
                docStrings.push(overload.details.docString);
            }
        });
    } else if (resolvedDecl && isStubFile(resolvedDecl.path) && isFunctionDeclaration(resolvedDecl)) {
        const implDecls = sourceMapper.findFunctionDeclarations(resolvedDecl);
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
    classType: ClassType,
    resolvedDecl: Declaration | undefined,
    sourceMapper: SourceMapper
) {
    let docString = classType.details.docString;
    if (!docString && resolvedDecl && isClassDeclaration(resolvedDecl)) {
        docString = _getFunctionOrClassDeclDocString([resolvedDecl]);
        if (
            !docString &&
            resolvedDecl &&
            isStubFile(resolvedDecl.path) &&
            resolvedDecl.type === DeclarationType.Class
        ) {
            const implDecls = sourceMapper.findClassDeclarations(resolvedDecl);
            docString = _getFunctionOrClassDeclDocString(implDecls);
        }
    }

    if (!docString && resolvedDecl) {
        const implDecls = sourceMapper.findClassDeclarationsByType(resolvedDecl.path, classType);
        if (implDecls) {
            const classDecls = implDecls.filter((d) => isClassDeclaration(d)).map((d) => d);
            docString = _getFunctionOrClassDeclDocString(classDecls);
        }
    }

    return docString;
}

function getFunctionDocString(type: Type, resolvedDecl: FunctionDeclaration | undefined, sourceMapper: SourceMapper) {
    if (!isFunction(type)) {
        return undefined;
    }

    let docString = type.details.docString;
    if (!docString && resolvedDecl) {
        docString = getFunctionDocStringFromDeclaration(resolvedDecl, sourceMapper);
    }

    if (!docString && type.details.declaration) {
        docString = getFunctionDocStringFromDeclaration(type.details.declaration, sourceMapper);
    }

    return docString;
}

function getFunctionDocStringFromDeclaration(resolvedDecl: FunctionDeclaration, sourceMapper: SourceMapper) {
    let docString = _getFunctionOrClassDeclDocString([resolvedDecl]);
    if (!docString && isStubFile(resolvedDecl.path)) {
        const implDecls = sourceMapper.findFunctionDeclarations(resolvedDecl);
        docString = _getFunctionOrClassDeclDocString(implDecls);
    }

    return docString;
}

function _getFunctionOrClassDeclDocString(decls: FunctionDeclaration[] | ClassDeclaration[]): string | undefined {
    for (const decl of decls) {
        const docString = ParseTreeUtils.getDocString(decl.node?.suite?.statements ?? []);
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
