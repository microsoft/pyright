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
    isVariableDeclaration,
    VariableDeclaration,
} from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import {
    ClassType,
    FunctionType,
    isFunction,
    isInstantiableClass,
    isOverloadedFunction,
    ModuleType,
    OverloadedFunctionType,
    Type,
    TypeCategory,
} from '../analyzer/types';
import { ModuleNode, ParseNodeType } from '../parser/parseNodes';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassIteratorFlags,
    ClassMemberLookupFlags,
    getClassIterator,
    getClassMemberIterator,
    isProperty,
} from './typeUtils';

const DefaultClassIteratorFlagsForFunctions =
    ClassMemberLookupFlags.SkipObjectBaseClass |
    ClassMemberLookupFlags.SkipInstanceVariables |
    ClassMemberLookupFlags.SkipOriginalClass |
    ClassMemberLookupFlags.DeclaredTypesOnly;

function isInheritedFromBuiltin(type: FunctionType | OverloadedFunctionType, classType?: ClassType): boolean {
    if (type.category === TypeCategory.OverloadedFunction) {
        if (type.overloads.length === 0) {
            return false;
        }
        type = type.overloads[0];
    }

    // Functions that are bound to a different type than where they
    // were declared are inherited.
    return (
        type.details.moduleName === 'builtins' &&
        !!classType &&
        !!type.boundToType &&
        !ClassType.isSameGenericClass(classType, type.boundToType)
    );
}

export function getFunctionDocStringInherited(
    type: FunctionType,
    resolvedDecl: Declaration | undefined,
    sourceMapper: SourceMapper,
    classType?: ClassType
) {
    let docString: string | undefined;

    // Don't allow docs to be inherited from the builtins to other classes;
    // they typically not helpful (and object's __init__ doc causes issues
    // with our current docstring traversal).
    if (!isInheritedFromBuiltin(type, classType) && resolvedDecl && isFunctionDeclaration(resolvedDecl)) {
        docString = _getFunctionDocString(type, resolvedDecl, sourceMapper);
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
                    docString = _getFunctionDocStringFromDeclaration(inheritedDecl, sourceMapper);
                    if (docString) {
                        break;
                    }
                }
            }
        }
    }

    return docString || type.details.docString;
}

export function getOverloadedFunctionDocStringsInherited(
    type: OverloadedFunctionType,
    resolvedDecls: Declaration[],
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator,
    classType?: ClassType
) {
    let docStrings: string[] | undefined;

    // Don't allow docs to be inherited from the builtins to other classes;
    // they typically not helpful (and object's __init__ doc causes issues
    // with our current docstring traversal).
    if (!isInheritedFromBuiltin(type, classType)) {
        for (const resolvedDecl of resolvedDecls) {
            docStrings = _getOverloadedFunctionDocStrings(type, resolvedDecl, sourceMapper);
            if (docStrings && docStrings.length > 0) {
                return docStrings;
            }
        }
    }

    // Search mro
    if (classType && type.overloads.length > 0) {
        const funcName = type.overloads[0].details.name;
        const memberIterator = getClassMemberIterator(classType, funcName, DefaultClassIteratorFlagsForFunctions);

        for (const classMember of memberIterator) {
            const inheritedDecl = classMember.symbol.getDeclarations().slice(-1)[0];
            const declType = evaluator.getTypeForDeclaration(inheritedDecl);
            if (declType) {
                docStrings = _getOverloadedFunctionDocStrings(declType, inheritedDecl, sourceMapper);
                if (docStrings && docStrings.length > 0) {
                    break;
                }
            }
        }
    }

    return docStrings ?? [];
}

export function getPropertyDocStringInherited(
    decl: FunctionDeclaration,
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator
) {
    const enclosingClass = ParseTreeUtils.getEnclosingClass(decl.node.name, /* stopAtFunction */ false);
    const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;
    if (classResults) {
        return _getPropertyDocStringInherited(decl, sourceMapper, evaluator, classResults.classType);
    }
    return undefined;
}

export function getVariableInStubFileDocStrings(decl: VariableDeclaration, sourceMapper: SourceMapper) {
    const docStrings: string[] = [];
    if (!isStubFile(decl.path)) {
        return docStrings;
    }

    for (const implDecl of sourceMapper.findDeclarations(decl)) {
        if (isVariableDeclaration(implDecl) && !!implDecl.docString) {
            docStrings.push(implDecl.docString);
        } else if (isClassDeclaration(implDecl) || isFunctionDeclaration(implDecl)) {
            // It is possible that the variable on the stub is not actually a variable on the corresponding py file.
            // in that case, get the doc string from original symbol if possible.
            const docString = getFunctionOrClassDeclDocString(implDecl);
            if (docString) {
                docStrings.push(docString);
            }
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
        docString = _getFunctionOrClassDeclsDocString([resolvedDecl]);
        if (
            !docString &&
            resolvedDecl &&
            isStubFile(resolvedDecl.path) &&
            resolvedDecl.type === DeclarationType.Class
        ) {
            const implDecls = sourceMapper.findClassDeclarations(resolvedDecl);
            docString = _getFunctionOrClassDeclsDocString(implDecls);
        }
    }

    if (!docString && resolvedDecl) {
        const implDecls = sourceMapper.findClassDeclarationsByType(resolvedDecl.path, classType);
        if (implDecls) {
            const classDecls = implDecls.filter((d) => isClassDeclaration(d)).map((d) => d);
            docString = _getFunctionOrClassDeclsDocString(classDecls);
        }
    }

    return docString;
}

export function getFunctionOrClassDeclDocString(decl: FunctionDeclaration | ClassDeclaration): string | undefined {
    return ParseTreeUtils.getDocString(decl.node?.suite?.statements ?? []);
}

export function getVariableDocString(
    decl: VariableDeclaration | undefined,
    sourceMapper: SourceMapper
): string | undefined {
    if (!decl) {
        return undefined;
    }

    if (decl.docString !== undefined) {
        return decl.docString;
    } else {
        return getVariableInStubFileDocStrings(decl, sourceMapper).find((doc) => doc);
    }
}

function _getOverloadedFunctionDocStrings(
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
        const docString = _getFunctionOrClassDeclsDocString(implDecls);
        if (docString) {
            docStrings.push(docString);
        }
    }

    return docStrings;
}

function _getPropertyDocStringInherited(
    decl: Declaration | undefined,
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator,
    classType: ClassType
) {
    if (!decl || !isFunctionDeclaration(decl)) {
        return;
    }

    const declaredType = evaluator.getTypeForDeclaration(decl);
    if (!declaredType || !isProperty(declaredType)) {
        return;
    }

    const fieldName = decl.node.nodeType === ParseNodeType.Function ? decl.node.name.value : undefined;
    if (!fieldName) {
        return;
    }

    const classItr = getClassIterator(classType, ClassIteratorFlags.Default);
    // Walk the inheritance list starting with the current class searching for docStrings
    for (const [mroClass] of classItr) {
        if (!isInstantiableClass(mroClass)) {
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
                        const docString = _getFunctionDocStringFromDeclaration(decl, sourceMapper);
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

function _getFunctionDocString(type: Type, resolvedDecl: FunctionDeclaration | undefined, sourceMapper: SourceMapper) {
    if (!isFunction(type)) {
        return undefined;
    }

    let docString = type.details.docString;
    if (!docString && resolvedDecl) {
        docString = _getFunctionDocStringFromDeclaration(resolvedDecl, sourceMapper);
    }

    if (!docString && type.details.declaration) {
        docString = _getFunctionDocStringFromDeclaration(type.details.declaration, sourceMapper);
    }

    return docString;
}

function _getFunctionDocStringFromDeclaration(resolvedDecl: FunctionDeclaration, sourceMapper: SourceMapper) {
    let docString = _getFunctionOrClassDeclsDocString([resolvedDecl]);
    if (!docString && isStubFile(resolvedDecl.path)) {
        const implDecls = sourceMapper.findFunctionDeclarations(resolvedDecl);
        docString = _getFunctionOrClassDeclsDocString(implDecls);
    }

    return docString;
}

function _getFunctionOrClassDeclsDocString(decls: FunctionDeclaration[] | ClassDeclaration[]): string | undefined {
    for (const decl of decls) {
        const docString = getFunctionOrClassDeclDocString(decl);
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
