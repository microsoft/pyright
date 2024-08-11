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
    FunctionDeclaration,
    isClassDeclaration,
    isFunctionDeclaration,
    isSpecialBuiltInClassDeclaration,
    isVariableDeclaration,
    SpecialBuiltInClassDeclaration,
    VariableDeclaration,
} from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import {
    ClassType,
    FunctionType,
    isFunction,
    isInstantiableClass,
    isOverloaded,
    ModuleType,
    OverloadedType,
    Type,
    TypeCategory,
} from '../analyzer/types';
import { addIfNotNull, appendArray } from '../common/collectionUtils';
import { Uri } from '../common/uri/uri';
import { ModuleNode, ParseNodeType } from '../parser/parseNodes';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassIteratorFlags,
    getClassIterator,
    getClassMemberIterator,
    isMaybeDescriptorInstance,
    MemberAccessFlags,
} from './typeUtils';

const DefaultClassIteratorFlagsForFunctions =
    MemberAccessFlags.SkipObjectBaseClass |
    MemberAccessFlags.SkipInstanceMembers |
    MemberAccessFlags.SkipOriginalClass |
    MemberAccessFlags.DeclaredTypesOnly;

function isInheritedFromBuiltin(type: FunctionType | OverloadedType, classType?: ClassType): boolean {
    if (type.category === TypeCategory.Overloaded) {
        const overloads = OverloadedType.getOverloads(type);
        if (overloads.length === 0) {
            return false;
        }
        type = overloads[0];
    }

    // Functions that are bound to a different type than where they
    // were declared are inherited.
    return (
        !!type.shared.methodClass &&
        ClassType.isBuiltIn(type.shared.methodClass) &&
        !!type.priv.boundToType &&
        !ClassType.isBuiltIn(type.priv.boundToType)
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
        const funcName = type.shared.name;
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

    return docString || type.shared.docString;
}

export function getOverloadedDocStringsInherited(
    type: OverloadedType,
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
            docStrings = _getOverloadedDocStrings(type, resolvedDecl, sourceMapper);
            if (docStrings && docStrings.length > 0) {
                return docStrings;
            }
        }
    }

    // Search mro
    const overloads = OverloadedType.getOverloads(type);
    if (classType && overloads.length > 0) {
        const funcName = overloads[0].shared.name;
        const memberIterator = getClassMemberIterator(classType, funcName, DefaultClassIteratorFlagsForFunctions);

        for (const classMember of memberIterator) {
            const inheritedDecl = classMember.symbol.getDeclarations().slice(-1)[0];
            const declType = evaluator.getTypeForDeclaration(inheritedDecl)?.type;
            if (declType) {
                docStrings = _getOverloadedDocStrings(declType, inheritedDecl, sourceMapper);
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
    const enclosingClass = ParseTreeUtils.getEnclosingClass(decl.node.d.name, /* stopAtFunction */ false);
    const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;
    if (classResults) {
        return _getPropertyDocStringInherited(decl, sourceMapper, evaluator, classResults.classType);
    }
    return undefined;
}

export function getVariableInStubFileDocStrings(decl: VariableDeclaration, sourceMapper: SourceMapper) {
    const docStrings: string[] = [];
    if (!isStubFile(decl.uri)) {
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

export function isBuiltInModule(uri: Uri | undefined) {
    if (uri) {
        return uri.getPath().includes('typeshed-fallback/stdlib');
    }
    return false;
}

export function getModuleDocStringFromModuleNodes(modules: ModuleNode[]): string | undefined {
    for (const module of modules) {
        if (module.d.statements) {
            const docString = ParseTreeUtils.getDocString(module.d.statements);
            if (docString) {
                return docString;
            }
        }
    }

    return undefined;
}

export function getModuleDocStringFromUris(uris: Uri[], sourceMapper: SourceMapper) {
    const modules: ModuleNode[] = [];
    for (const uri of uris) {
        if (isStubFile(uri)) {
            addIfNotNull(modules, sourceMapper.getModuleNode(uri));
        }

        appendArray(modules, sourceMapper.findModules(uri));
    }

    return getModuleDocStringFromModuleNodes(modules);
}

export function getModuleDocString(
    type: ModuleType,
    resolvedDecl: DeclarationBase | undefined,
    sourceMapper: SourceMapper
) {
    let docString = type.priv.docString;
    if (!docString) {
        const uri = resolvedDecl?.uri ?? type.priv.fileUri;
        docString = getModuleDocStringFromUris([uri], sourceMapper);
    }

    return docString;
}

export function getClassDocString(
    classType: ClassType,
    resolvedDecl: Declaration | undefined,
    sourceMapper: SourceMapper
) {
    let docString = classType.shared.docString;
    if (!docString && resolvedDecl && _isAnyClassDeclaration(resolvedDecl)) {
        docString = isClassDeclaration(resolvedDecl) ? _getFunctionOrClassDeclsDocString([resolvedDecl]) : undefined;
        if (!docString && resolvedDecl && isStubFile(resolvedDecl.uri)) {
            for (const implDecl of sourceMapper.findDeclarations(resolvedDecl)) {
                if (isVariableDeclaration(implDecl) && !!implDecl.docString) {
                    docString = implDecl.docString;
                    break;
                }

                if (isClassDeclaration(implDecl) || isFunctionDeclaration(implDecl)) {
                    docString = getFunctionOrClassDeclDocString(implDecl);
                    break;
                }
            }
        }
    }

    if (!docString && resolvedDecl) {
        const implDecls = sourceMapper.findClassDeclarationsByType(resolvedDecl.uri, classType);
        if (implDecls) {
            const classDecls = implDecls.filter((d) => isClassDeclaration(d)).map((d) => d);
            docString = _getFunctionOrClassDeclsDocString(classDecls);
        }
    }

    return docString;
}

export function getFunctionOrClassDeclDocString(decl: FunctionDeclaration | ClassDeclaration): string | undefined {
    return ParseTreeUtils.getDocString(decl.node?.d.suite?.d.statements ?? []);
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

function _getOverloadedDocStrings(type: Type, resolvedDecl: Declaration | undefined, sourceMapper: SourceMapper) {
    if (!isOverloaded(type)) {
        return undefined;
    }

    const docStrings: string[] = [];
    const overloads = OverloadedType.getOverloads(type);
    const impl = OverloadedType.getImplementation(type);

    if (overloads.some((o) => o.shared.docString)) {
        overloads.forEach((overload) => {
            if (overload.shared.docString) {
                docStrings.push(overload.shared.docString);
            }
        });
    }

    if (impl && isFunction(impl) && impl.shared.docString) {
        docStrings.push(impl.shared.docString);
    }

    if (
        docStrings.length === 0 &&
        resolvedDecl &&
        isStubFile(resolvedDecl.uri) &&
        isFunctionDeclaration(resolvedDecl)
    ) {
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

    const declaredType = evaluator.getTypeForDeclaration(decl)?.type;
    if (!declaredType || !isMaybeDescriptorInstance(declaredType)) {
        return;
    }

    const fieldName = decl.node.nodeType === ParseNodeType.Function ? decl.node.d.name.d.value : undefined;
    if (!fieldName) {
        return;
    }

    const classItr = getClassIterator(classType, ClassIteratorFlags.Default);
    // Walk the inheritance list starting with the current class searching for docStrings
    for (const [mroClass] of classItr) {
        if (!isInstantiableClass(mroClass)) {
            continue;
        }

        const symbol = ClassType.getSymbolTable(mroClass).get(fieldName);
        // Get both the setter and getter declarations
        const decls = symbol?.getDeclarations();
        if (decls) {
            for (const decl of decls) {
                if (isFunctionDeclaration(decl)) {
                    const declaredType = evaluator.getTypeForDeclaration(decl)?.type;
                    if (declaredType && isMaybeDescriptorInstance(declaredType)) {
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

    let docString = type.shared.docString;
    if (!docString && resolvedDecl) {
        docString = _getFunctionDocStringFromDeclaration(resolvedDecl, sourceMapper);
    }

    if (!docString && type.shared.declaration) {
        docString = _getFunctionDocStringFromDeclaration(type.shared.declaration, sourceMapper);
    }

    return docString;
}

function _getFunctionDocStringFromDeclaration(resolvedDecl: FunctionDeclaration, sourceMapper: SourceMapper) {
    let docString = _getFunctionOrClassDeclsDocString([resolvedDecl]);
    if (!docString && isStubFile(resolvedDecl.uri)) {
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

function _isAnyClassDeclaration(decl: Declaration): decl is ClassDeclaration | SpecialBuiltInClassDeclaration {
    return isClassDeclaration(decl) || isSpecialBuiltInClassDeclaration(decl);
}
