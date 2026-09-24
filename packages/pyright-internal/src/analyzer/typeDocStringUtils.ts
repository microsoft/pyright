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
import { ClassIteratorFlags, getClassIterator, isMaybeDescriptorInstance, MemberAccessFlags } from './typeUtils';

export const DefaultClassIteratorFlagsForFunctions =
    MemberAccessFlags.SkipObjectBaseClass |
    MemberAccessFlags.SkipInstanceMembers |
    MemberAccessFlags.SkipOriginalClass |
    MemberAccessFlags.DeclaredTypesOnly;

export function isInheritedFromBuiltin(type: FunctionType | OverloadedType, classType?: ClassType): boolean {
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

// ===========================================================================
// Unified spec-ordered docstring resolution (component core).
//
// These implement the docstring-resolution-order spec and are the single source
// of ordering for every callable docstring surface (functions, methods, overloads,
// constructors). They operate on the FULL member symbol plus the call-matched
// overload(s) so that Rule A (matched overload -> implementation -> other overloads)
// applies uniformly, and they walk the MRO (derived-first, excluding builtin bases
// but always considering the class itself) for inheritance. Stub->source fallback
// is centralized in _functionDocInfo via _getFunctionDocStringFromDeclarationInfo.
// ===========================================================================

// Rule A within one class's member: matched overload -> implementation -> other
// overloads (declaration order). Returns the first candidate that has a docstring.
function _selectMemberDocInfo(
    memberType: Type,
    matchedOverloads: FunctionType[] | undefined,
    sourceMapper: SourceMapper
): FunctionDocStringInfo | undefined {
    if (isFunction(memberType)) {
        return _functionDocInfo(memberType, sourceMapper);
    }

    if (!isOverloaded(memberType)) {
        return undefined;
    }

    const overloads = OverloadedType.getOverloads(memberType);
    const impl = OverloadedType.getImplementation(memberType);

    // Tier 1: the call-matched overload(s). First read the matched overload's OWN docstring
    // directly; this is robust to declaration-cleared specializations (e.g. a ParamSpec/Callable
    // transform via applyParamSpecValue clones the overload with shared.docString copied but its
    // declaration dropped, so identity/declaration matching against the re-fetched symbol would
    // miss it). Then fall back to the corresponding original overload from the full symbol.
    if (matchedOverloads && matchedOverloads.length > 0) {
        // matchedOverloads is a hint forwarded from the caller (e.g. resolveConstructorDocInfo
        // forwards the same hint to both __init__ and __new__). Only trust a matched overload that
        // actually belongs to this member; otherwise another member's matched overload could
        // short-circuit Rule B here. Name is preserved across binding/specialization, so filtering
        // by name is a safe scope check.
        const memberName = overloads.length > 0 ? overloads[0].shared.name : undefined;
        for (const matched of matchedOverloads) {
            if (memberName !== undefined && matched.shared.name !== memberName) {
                continue;
            }
            const info = _functionDocInfo(matched, sourceMapper);
            if (info) {
                return info;
            }
        }
        for (const overload of overloads) {
            if (_isMatchedOverload(overload, matchedOverloads)) {
                const info = _functionDocInfo(overload, sourceMapper);
                if (info) {
                    return info;
                }
            }
        }
    }

    // Tier 2: the implementation.
    if (impl && isFunction(impl)) {
        const info = _functionDocInfo(impl, sourceMapper);
        if (info) {
            return info;
        }
    }

    // Tier 3: the remaining overloads, in declaration order.
    for (const overload of overloads) {
        const info = _functionDocInfo(overload, sourceMapper);
        if (info) {
            return info;
        }
    }

    return undefined;
}

function _isMatchedOverload(overload: FunctionType, matchedOverloads: FunctionType[]): boolean {
    // Match by object identity first, then by shared declaration. The latter keeps the
    // matched-overload tier robust to binding/specialization (e.g. a generic `Box[int]()`
    // whose matched overload is a specialized clone); `shared.declaration` is preserved
    // across those transforms. If it ever were not, this falls through to the impl/other tiers.
    return matchedOverloads.some(
        (m) => m === overload || (!!m.shared.declaration && m.shared.declaration === overload.shared.declaration)
    );
}

function _functionDocInfo(type: FunctionType, sourceMapper: SourceMapper): FunctionDocStringInfo | undefined {
    if (type.shared.docString) {
        // Leave forceLiteral undefined so downstream formatting can apply its built-in-module
        // literal heuristic (matching the legacy getFunctionDocStringInheritedInfo behavior).
        return {
            docString: type.shared.docString,
            sourceDecl:
                type.shared.declaration && isFunctionDeclaration(type.shared.declaration)
                    ? type.shared.declaration
                    : undefined,
        };
    }

    if (type.shared.declaration) {
        return _getFunctionDocStringFromDeclarationInfo(type.shared.declaration, sourceMapper);
    }

    return undefined;
}

// Resolve ONLY the passed function's own docstring (with stub->source fallback), without borrowing
// from sibling overloads, the implementation, the class, or the MRO. Used where each overload must
// show its own docstring (e.g. signature-help enumeration) rather than a symbol-level resolved one.
export function getFunctionOwnDocString(type: FunctionType, sourceMapper: SourceMapper): string | undefined {
    return _functionDocInfo(type, sourceMapper)?.docString;
}

// Resolve a function/method docstring per spec. For a class member, resolve the class's OWN
// member first (the full, unnarrowed overload set) via Rule A, then walk base classes
// (excluding builtin bases) for inheritance. For a free function, resolve the passed type.
// The builtin-inheritance guard and the trailing type.shared.docString fallback mirror the
// legacy getFunctionDocStringInheritedInfo behavior so builtin docs don't leak into user classes.
export function resolveMethodDocInfo(
    type: FunctionType | OverloadedType,
    classType: ClassType | undefined,
    matchedOverloads: FunctionType[] | undefined,
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator
): FunctionDocStringInfo | undefined {
    const memberName = _memberNameOfType(type);

    // Step 1: the member's own docstring (Rule A over the full overload set on its class), unless
    // the member is inherited from a builtin (its generic doc should not surface on a user class).
    if (!isInheritedFromBuiltin(type, classType)) {
        let ownType: Type = type;
        if (classType && memberName) {
            const symbol = ClassType.getSymbolTable(classType).get(memberName);
            if (symbol) {
                ownType = evaluator.getEffectiveTypeOfSymbol(symbol);
            }
        } else if (!classType && memberName) {
            // Free/module-level function: re-fetch the full (unnarrowed) overloaded symbol so
            // sibling overloads are visible when the passed type was narrowed to the matched
            // overload. Only adopt the re-fetched type when it is overloaded; otherwise keep the
            // passed type so a decorator / functools.wraps-synthesized function (whose docstring
            // is not on the raw declared symbol) is not discarded.
            const primary = isOverloaded(type) ? OverloadedType.getOverloads(type)[0] : type;
            const declNode = primary?.shared.declaration?.node;
            if (declNode) {
                const symbolWithScope = evaluator.lookUpSymbolRecursive(
                    declNode,
                    memberName,
                    /* honorCodeFlow */ false
                );
                if (symbolWithScope) {
                    const refetched = evaluator.getEffectiveTypeOfSymbol(symbolWithScope.symbol);
                    if (isOverloaded(refetched)) {
                        ownType = refetched;
                    }
                }
            }
        }

        const own = _selectMemberDocInfo(ownType, matchedOverloads, sourceMapper);
        if (own?.docString) {
            return own;
        }
    }

    // Step 2: inheritance — walk base classes (exclude builtin bases; the original class was
    // handled in step 1), applying Rule A per class.
    if (classType && memberName) {
        for (const [mroClass] of getClassIterator(classType, ClassIteratorFlags.Default)) {
            if (!isInstantiableClass(mroClass)) {
                continue;
            }
            if (ClassType.isSameGenericClass(mroClass, classType)) {
                continue;
            }
            if (ClassType.isBuiltIn(mroClass)) {
                continue;
            }

            const symbol = ClassType.getSymbolTable(mroClass).get(memberName);
            if (!symbol) {
                continue;
            }

            const info = _selectMemberDocInfo(evaluator.getEffectiveTypeOfSymbol(symbol), undefined, sourceMapper);
            if (info?.docString) {
                return info;
            }
        }
    }

    // Step 3: the passed type's own docstring (last resort, mirrors legacy behavior).
    if (isFunction(type) && type.shared.docString) {
        return {
            docString: type.shared.docString,
            sourceDecl:
                type.shared.declaration && isFunctionDeclaration(type.shared.declaration)
                    ? type.shared.declaration
                    : undefined,
        };
    }

    return undefined;
}

function _memberNameOfType(type: FunctionType | OverloadedType): string | undefined {
    if (isOverloaded(type)) {
        const overloads = OverloadedType.getOverloads(type);
        return overloads.length > 0 ? overloads[0].shared.name : undefined;
    }
    return type.shared.name;
}

// Resolve a constructor-method docstring per spec (Phase 1). Walk the MRO and, for each
// class, resolve its own `__init__` then `__new__` via Rule A. Returns undefined so the
// caller can fall back to the class docstring (Phase 2).
export function resolveConstructorDocInfo(
    classType: ClassType,
    matchedOverloads: FunctionType[] | undefined,
    sourceMapper: SourceMapper,
    evaluator: TypeEvaluator
): FunctionDocStringInfo | undefined {
    for (const [mroClass] of getClassIterator(classType, ClassIteratorFlags.Default)) {
        if (!isInstantiableClass(mroClass)) {
            continue;
        }
        if (!ClassType.isSameGenericClass(mroClass, classType) && ClassType.isBuiltIn(mroClass)) {
            continue;
        }

        const symbolTable = ClassType.getSymbolTable(mroClass);

        const initSymbol = symbolTable.get('__init__');
        const initInfo = initSymbol
            ? _selectMemberDocInfo(evaluator.getEffectiveTypeOfSymbol(initSymbol), matchedOverloads, sourceMapper)
            : undefined;
        if (initInfo?.docString) {
            return initInfo;
        }

        const newSymbol = symbolTable.get('__new__');
        const newInfo = newSymbol
            ? _selectMemberDocInfo(evaluator.getEffectiveTypeOfSymbol(newSymbol), matchedOverloads, sourceMapper)
            : undefined;
        if (newInfo?.docString) {
            return newInfo;
        }
    }

    return undefined;
}

export interface FunctionDocStringInfo {
    docString: string;
    forceLiteral?: boolean;
    sourceDecl?: FunctionDeclaration;
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

    // Fall back to inheriting a docstring from a base class (approximating
    // Python's `inspect.getdoc`, but excluding builtin bases). Walk the MRO and
    // use the nearest base's docstring. Skip builtin classes (e.g. `object`) so
    // their generic docstrings don't leak, mirroring the method behavior in
    // getFunctionDocStringInherited. Only inherit when the class truly has no
    // docstring of its own. An explicit empty docstring (`""`) is recorded on
    // `classType.shared.docString` and must block inheritance, matching Python
    // `inspect.getdoc`. Note the empty string is discarded by the resolution
    // above (helpers use truthy checks), so we consult the class's own docstring
    // directly rather than the resolved local.
    //
    // Known limitation: unlike the class's own docstring (which resolves through
    // `sourceMapper` to recover `.py` docs behind a `.pyi` stub), this inherited
    // branch reads `mroClass.shared.docString` directly. So an inherited docstring
    // surfaces only when the base doesn't ship a doc-less stub. This keeps the
    // Pyright diff surgical; the async path mirrors the same decision.
    if (docString === undefined && classType.shared.docString === undefined) {
        for (const [mroClass] of getClassIterator(classType, ClassIteratorFlags.Default)) {
            if (!isInstantiableClass(mroClass)) {
                continue;
            }
            if (ClassType.isSameGenericClass(mroClass, classType)) {
                continue;
            }
            if (ClassType.isBuiltIn(mroClass)) {
                continue;
            }
            if (mroClass.shared.docString) {
                docString = mroClass.shared.docString;
                break;
            }
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

function _getFunctionDocStringFromDeclaration(resolvedDecl: FunctionDeclaration, sourceMapper: SourceMapper) {
    return _getFunctionDocStringFromDeclarationInfo(resolvedDecl, sourceMapper)?.docString;
}

export function getFunctionDocStringFromDeclarationInfo(
    resolvedDecl: FunctionDeclaration,
    sourceMapper: SourceMapper
): FunctionDocStringInfo | undefined {
    return _getFunctionDocStringFromDeclarationInfo(resolvedDecl, sourceMapper);
}

function _getFunctionDocStringFromDeclarationInfo(
    resolvedDecl: FunctionDeclaration,
    sourceMapper: SourceMapper
): FunctionDocStringInfo | undefined {
    const docInfo = _getFunctionOrClassDeclsDocStringInfo([resolvedDecl]);
    if (docInfo) {
        return docInfo;
    }

    if (!isStubFile(resolvedDecl.uri)) {
        return undefined;
    }

    const implDocInfo = _getFunctionOrClassDeclsDocStringInfo(sourceMapper.findFunctionDeclarations(resolvedDecl));
    return implDocInfo
        ? { docString: implDocInfo.docString, sourceDecl: implDocInfo.sourceDecl, forceLiteral: false }
        : undefined;
}

function _getFunctionOrClassDeclsDocString(decls: FunctionDeclaration[] | ClassDeclaration[]): string | undefined {
    if (decls.length === 0) {
        return undefined;
    }

    return isFunctionDeclaration(decls[0])
        ? _getFunctionOrClassDeclsDocStringInfo(decls as FunctionDeclaration[])?.docString
        : _getFunctionOrClassDeclsDocStringInfo(decls as ClassDeclaration[])?.docString;
}

function _getFunctionOrClassDeclsDocStringInfo(
    decls: FunctionDeclaration[]
): { docString: string; sourceDecl: FunctionDeclaration } | undefined;
function _getFunctionOrClassDeclsDocStringInfo(
    decls: ClassDeclaration[]
): { docString: string; sourceDecl: ClassDeclaration } | undefined;
function _getFunctionOrClassDeclsDocStringInfo(
    decls: readonly (FunctionDeclaration | ClassDeclaration)[]
): { docString: string; sourceDecl: FunctionDeclaration | ClassDeclaration } | undefined {
    for (const decl of decls) {
        const docString = getFunctionOrClassDeclDocString(decl);
        if (docString) {
            return { docString, sourceDecl: decl };
        }
    }

    return undefined;
}

function _isAnyClassDeclaration(decl: Declaration): decl is ClassDeclaration | SpecialBuiltInClassDeclaration {
    return isClassDeclaration(decl) || isSpecialBuiltInClassDeclaration(decl);
}
