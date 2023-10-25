/*
 * protocols.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides type evaluation logic that is specific to protocol
 * (structural subtyping) classes.
 */

import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { Localizer } from '../localization/localize';
import { assignTypeToTypeVar } from './constraintSolver';
import { DeclarationType } from './declaration';
import { assignProperty } from './properties';
import { Symbol } from './symbol';
import { getLastTypedDeclaredForSymbol } from './symbolUtils';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    FunctionType,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isOverloadedFunction,
    isTypeSame,
    ModuleType,
    OverloadedFunctionType,
    ProtocolCompatibility,
    Type,
    UnknownType,
} from './types';
import {
    applySolvedTypeVars,
    AssignTypeFlags,
    ClassMember,
    ClassMemberLookupFlags,
    containsLiteralType,
    getTypeVarScopeId,
    lookUpClassMember,
    partiallySpecializeType,
    populateTypeVarContextForSelfType,
    removeParamSpecVariadicsFromSignature,
    requiresSpecialization,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';

interface ProtocolAssignmentStackEntry {
    srcType: ClassType;
    destType: ClassType;
}

const protocolAssignmentStack: ProtocolAssignmentStackEntry[] = [];

// Maximum number of different types that are cached with a protocol.
const maxProtocolCompatibilityCacheEntries = 32;

// If treatSourceAsInstantiable is true, we're comparing the class object against the
// protocol. If it's false, we're comparing the class instance against the protocol.
export function assignClassToProtocol(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType,
    diag: DiagnosticAddendum | undefined,
    destTypeVarContext: TypeVarContext | undefined,
    srcTypeVarContext: TypeVarContext | undefined,
    flags: AssignTypeFlags,
    treatSourceAsInstantiable: boolean,
    recursionCount: number
): boolean {
    const enforceInvariance = (flags & AssignTypeFlags.EnforceInvariance) !== 0;

    // Use a stack of pending protocol class evaluations to detect recursion.
    // This can happen when a protocol class refers to itself.
    if (
        protocolAssignmentStack.some((entry) => {
            return isTypeSame(entry.srcType, srcType) && isTypeSame(entry.destType, destType);
        })
    ) {
        return !enforceInvariance;
    }

    // See if we've already determined that this class is compatible with this protocol.
    if (!enforceInvariance) {
        const compatibility = getProtocolCompatibility(destType, srcType, flags, treatSourceAsInstantiable);

        if (compatibility !== undefined) {
            if (compatibility) {
                // If the caller has provided a destination type var context,
                // we can't use the cached value unless the dest has no type
                // parameters to solve.
                if (!destTypeVarContext || destType.details.typeParameters.length === 0) {
                    return true;
                }
            }

            // If it's known not to be compatible and the caller hasn't requested
            // any detailed diagnostic information, we can return false immediately.
            if (!compatibility && !diag) {
                return false;
            }
        }
    }

    protocolAssignmentStack.push({ srcType, destType });
    let isCompatible = true;

    try {
        isCompatible = assignClassToProtocolInternal(
            evaluator,
            destType,
            srcType,
            diag,
            destTypeVarContext,
            srcTypeVarContext,
            flags,
            treatSourceAsInstantiable,
            recursionCount
        );
    } catch (e) {
        // We'd normally use "finally" here, but the TS debugger does such
        // a poor job dealing with finally, we'll use a catch instead.
        protocolAssignmentStack.pop();
        throw e;
    }

    protocolAssignmentStack.pop();

    // Cache the results for next time.
    setProtocolCompatibility(destType, srcType, flags, treatSourceAsInstantiable, isCompatible);

    return isCompatible;
}

export function assignModuleToProtocol(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ModuleType,
    diag: DiagnosticAddendum | undefined,
    destTypeVarContext: TypeVarContext | undefined,
    flags: AssignTypeFlags,
    recursionCount: number
): boolean {
    return assignClassToProtocolInternal(
        evaluator,
        destType,
        srcType,
        diag,
        destTypeVarContext,
        /* srcTypeVarContext */ undefined,
        flags,
        /* treatSourceAsInstantiable */ false,
        recursionCount
    );
}

// Looks up the protocol compatibility in the cache. If it's not found,
// return undefined.
function getProtocolCompatibility(
    destType: ClassType,
    srcType: ClassType,
    flags: AssignTypeFlags,
    treatSourceAsInstantiable: boolean
): boolean | undefined {
    const entries = srcType.details.protocolCompatibility?.get(destType.details.fullName);
    if (entries === undefined) {
        return undefined;
    }

    const entry = entries.find((entry) => {
        return (
            isTypeSame(entry.destType, destType) &&
            isTypeSame(entry.srcType, srcType) &&
            entry.treatSourceAsInstantiable === treatSourceAsInstantiable &&
            entry.flags === flags
        );
    });

    return entry?.isCompatible;
}

function setProtocolCompatibility(
    destType: ClassType,
    srcType: ClassType,
    flags: AssignTypeFlags,
    treatSourceAsInstantiable: boolean,
    isCompatible: boolean
) {
    if (!srcType.details.protocolCompatibility) {
        srcType.details.protocolCompatibility = new Map<string, ProtocolCompatibility[]>();
    }

    let entries = srcType.details.protocolCompatibility.get(destType.details.fullName);
    if (!entries) {
        entries = [];
        srcType.details.protocolCompatibility.set(destType.details.fullName, entries);
    }

    entries.push({
        destType,
        srcType,
        treatSourceAsInstantiable,
        flags,
        isCompatible,
    });

    if (entries.length > maxProtocolCompatibilityCacheEntries) {
        entries.shift();
    }
}

function assignClassToProtocolInternal(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType | ModuleType,
    diag: DiagnosticAddendum | undefined,
    destTypeVarContext: TypeVarContext | undefined,
    srcTypeVarContext: TypeVarContext | undefined,
    flags: AssignTypeFlags,
    treatSourceAsInstantiable: boolean,
    recursionCount: number
): boolean {
    if ((flags & AssignTypeFlags.EnforceInvariance) !== 0) {
        return isTypeSame(destType, srcType);
    }

    const protocolTypeVarContext = createProtocolTypeVarContext(evaluator, destType, destTypeVarContext);
    const selfTypeVarContext = new TypeVarContext(getTypeVarScopeId(destType));
    const noLiteralSrcType = evaluator.stripLiteralValue(srcType) as ClassType;
    populateTypeVarContextForSelfType(selfTypeVarContext, destType, noLiteralSrcType);

    // If the source is a TypedDict, use the _TypedDict placeholder class
    // instead. We don't want to use the TypedDict members for protocol
    // comparison.
    if (isClass(srcType) && ClassType.isTypedDictClass(srcType)) {
        const typedDictClassType = evaluator.getTypedDictClassType();
        if (typedDictClassType && isInstantiableClass(typedDictClassType)) {
            srcType = typedDictClassType;
        }
    }

    let typesAreConsistent = true;
    const checkedSymbolSet = new Set<string>();
    let assignTypeFlags = flags & AssignTypeFlags.OverloadOverlapCheck;

    assignTypeFlags |= containsLiteralType(srcType, /* includeTypeArgs */ true)
        ? AssignTypeFlags.RetainLiteralsForTypeVar
        : AssignTypeFlags.Default;

    destType.details.mro.forEach((mroClass) => {
        if (!isInstantiableClass(mroClass) || !ClassType.isProtocolClass(mroClass)) {
            return;
        }

        // If we've already determined that the types are not consistent and the caller
        // hasn't requested detailed diagnostic output, we can shortcut the remainder.
        if (!typesAreConsistent && !diag) {
            return;
        }

        mroClass.details.fields.forEach((destSymbol, name) => {
            // If we've already determined that the types are not consistent and the caller
            // hasn't requested detailed diagnostic output, we can shortcut the remainder.
            if (!typesAreConsistent && !diag) {
                return;
            }

            if (!destSymbol.isClassMember() || destSymbol.isIgnoredForProtocolMatch() || checkedSymbolSet.has(name)) {
                return;
            }

            let isMemberFromMetaclass = false;
            let srcMemberInfo: ClassMember | undefined;
            let srcSymbol: Symbol | undefined;

            // Special-case the `__class_getitem__` for normal protocol comparison.
            // This is a convention agreed upon by typeshed maintainers.
            if (!treatSourceAsInstantiable && name === '__class_getitem__') {
                return;
            }

            // Special-case the `__slots__` entry for all protocol comparisons.
            // This is a convention agreed upon by typeshed maintainers.
            if (name === '__slots__') {
                return;
            }

            // Note that we've already checked this symbol. It doesn't need to
            // be checked again even if it is declared by a subclass.
            checkedSymbolSet.add(name);

            let destMemberType = evaluator.getDeclaredTypeOfSymbol(destSymbol)?.type;
            if (!destMemberType) {
                return;
            }

            let srcMemberType: Type;
            let isSrcReadOnly = false;

            if (isClass(srcType)) {
                // Look in the metaclass first if we're treating the source as an instantiable class.
                if (
                    treatSourceAsInstantiable &&
                    srcType.details.effectiveMetaclass &&
                    isInstantiableClass(srcType.details.effectiveMetaclass)
                ) {
                    srcMemberInfo = lookUpClassMember(srcType.details.effectiveMetaclass, name);
                    if (srcMemberInfo) {
                        isMemberFromMetaclass = true;
                    }
                }

                if (!srcMemberInfo) {
                    srcMemberInfo = lookUpClassMember(srcType, name);
                }

                if (!srcMemberInfo) {
                    diag?.addMessage(Localizer.DiagnosticAddendum.protocolMemberMissing().format({ name }));
                    typesAreConsistent = false;
                    return;
                }

                srcSymbol = srcMemberInfo.symbol;

                if (
                    destSymbol.isClassVar() &&
                    !srcMemberInfo.symbol.isClassVar() &&
                    !srcMemberInfo.symbol.isClassMember()
                ) {
                    diag?.addMessage(Localizer.DiagnosticAddendum.protocolMemberClassVar().format({ name }));
                    typesAreConsistent = false;
                }

                // Partially specialize the type of the symbol based on the MRO class.
                // We can skip this if it's the dest class because it is already
                // specialized.
                if (!ClassType.isSameGenericClass(mroClass, destType)) {
                    destMemberType = partiallySpecializeType(destMemberType, mroClass, srcType);
                }

                if (isInstantiableClass(srcMemberInfo.classType)) {
                    const symbolType = evaluator.getEffectiveTypeOfSymbol(srcMemberInfo.symbol);

                    // If this is a function, infer its return type prior to specializing it.
                    if (isFunction(symbolType)) {
                        evaluator.inferReturnTypeIfNecessary(symbolType);
                    }

                    srcMemberType = partiallySpecializeType(symbolType, srcMemberInfo.classType, noLiteralSrcType);
                } else {
                    srcMemberType = UnknownType.create();
                }

                // If the source is a method, bind it.
                if (isFunction(srcMemberType) || isOverloadedFunction(srcMemberType)) {
                    if (isMemberFromMetaclass || isInstantiableClass(srcMemberInfo.classType)) {
                        const boundSrcFunction = evaluator.bindFunctionToClassOrObject(
                            treatSourceAsInstantiable && !isMemberFromMetaclass
                                ? srcType
                                : ClassType.cloneAsInstance(srcType),
                            srcMemberType,
                            isMemberFromMetaclass ? undefined : (srcMemberInfo.classType as ClassType),
                            /* treatConstructorAsClassMember */ undefined,
                            isMemberFromMetaclass ? srcType : undefined,
                            diag?.createAddendum(),
                            recursionCount
                        );

                        if (boundSrcFunction) {
                            srcMemberType = removeParamSpecVariadicsFromSignature(boundSrcFunction);
                        } else {
                            typesAreConsistent = false;
                            return;
                        }
                    }
                }

                // Frozen dataclasses and named tuples should be treated as read-only.
                if (ClassType.isFrozenDataClass(srcType) || ClassType.isReadOnlyInstanceVariables(srcType)) {
                    isSrcReadOnly = true;
                }
            } else {
                srcSymbol = srcType.fields.get(name);

                if (!srcSymbol) {
                    diag?.addMessage(Localizer.DiagnosticAddendum.protocolMemberMissing().format({ name }));
                    typesAreConsistent = false;
                    return;
                }

                srcMemberType = evaluator.getEffectiveTypeOfSymbol(srcSymbol);
            }

            // Replace any "Self" TypeVar within the dest with the source type.
            destMemberType = applySolvedTypeVars(destMemberType, selfTypeVarContext);

            // If the dest is a method, bind it.
            if (isFunction(destMemberType) || isOverloadedFunction(destMemberType)) {
                let boundDeclaredType: FunctionType | OverloadedFunctionType | undefined;

                if (isClass(srcType)) {
                    assert(srcMemberInfo);

                    if (isMemberFromMetaclass || isInstantiableClass(srcMemberInfo.classType)) {
                        boundDeclaredType = evaluator.bindFunctionToClassOrObject(
                            ClassType.cloneAsInstance(srcType),
                            destMemberType,
                            isMemberFromMetaclass ? undefined : (srcMemberInfo.classType as ClassType),
                            /* treatConstructorAsClassMember */ undefined,
                            isMemberFromMetaclass ? srcType : undefined,
                            diag,
                            recursionCount
                        );
                    }
                } else {
                    boundDeclaredType = evaluator.bindFunctionToClassOrObject(
                        ClassType.cloneAsInstance(destType),
                        destMemberType,
                        destType,
                        /* treatConstructorAsClassMember */ undefined,
                        /* firstParamType */ undefined,
                        diag,
                        recursionCount
                    );
                }

                if (boundDeclaredType) {
                    destMemberType = removeParamSpecVariadicsFromSignature(boundDeclaredType);
                } else {
                    typesAreConsistent = false;
                    return;
                }
            }

            const subDiag = diag?.createAddendum();

            // Properties require special processing.
            if (isClassInstance(destMemberType) && ClassType.isPropertyClass(destMemberType)) {
                if (
                    isClassInstance(srcMemberType) &&
                    ClassType.isPropertyClass(srcMemberType) &&
                    !treatSourceAsInstantiable
                ) {
                    if (
                        !assignProperty(
                            evaluator,
                            ClassType.cloneAsInstantiable(destMemberType),
                            ClassType.cloneAsInstantiable(srcMemberType),
                            mroClass,
                            srcType,
                            subDiag?.createAddendum(),
                            protocolTypeVarContext,
                            selfTypeVarContext,
                            recursionCount
                        )
                    ) {
                        if (subDiag) {
                            subDiag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                        }
                        typesAreConsistent = false;
                    }
                } else {
                    // Extract the property type from the property class.
                    const getterType = evaluator.getGetterTypeFromProperty(
                        destMemberType,
                        /* inferTypeIfNeeded */ true
                    );

                    if (
                        !getterType ||
                        !evaluator.assignType(
                            getterType,
                            srcMemberType,
                            subDiag?.createAddendum(),
                            protocolTypeVarContext,
                            /* srcTypeVarContext */ undefined,
                            assignTypeFlags,
                            recursionCount
                        )
                    ) {
                        if (subDiag) {
                            subDiag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                        }
                        typesAreConsistent = false;
                    }

                    if (isSrcReadOnly) {
                        // The source attribute is read-only. Make sure the setter
                        // is not defined in the dest property.
                        if (
                            lookUpClassMember(destMemberType, '__set__', ClassMemberLookupFlags.SkipInstanceVariables)
                        ) {
                            if (subDiag) {
                                subDiag.addMessage(
                                    Localizer.DiagnosticAddendum.memberIsWritableInProtocol().format({ name })
                                );
                            }
                            typesAreConsistent = false;
                        }
                    }
                }
            } else {
                // Class and instance variables that are mutable need to enforce invariance.
                const primaryDecl = destSymbol.getDeclarations()[0];
                const isInvariant = primaryDecl?.type === DeclarationType.Variable && !primaryDecl.isFinal;

                // Temporarily add the TypeVar scope ID for this method to handle method-scoped TypeVars.
                const protocolTypeVarContextClone = protocolTypeVarContext.clone();
                protocolTypeVarContextClone.addSolveForScope(getTypeVarScopeId(destMemberType));

                if (
                    !evaluator.assignType(
                        destMemberType,
                        srcMemberType,
                        subDiag?.createAddendum(),
                        protocolTypeVarContextClone,
                        /* srcTypeVarContext */ undefined,
                        isInvariant ? assignTypeFlags | AssignTypeFlags.EnforceInvariance : assignTypeFlags,
                        recursionCount
                    )
                ) {
                    if (subDiag) {
                        if (isInvariant) {
                            subDiag.addMessage(Localizer.DiagnosticAddendum.memberIsInvariant().format({ name }));
                        }
                        subDiag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                    }
                    typesAreConsistent = false;
                } else {
                    protocolTypeVarContext.copyFromClone(protocolTypeVarContextClone);
                }
            }

            const isDestFinal = destSymbol
                .getTypedDeclarations()
                .some((decl) => decl.type === DeclarationType.Variable && !!decl.isFinal);
            const isSrcFinal = srcSymbol
                .getTypedDeclarations()
                .some((decl) => decl.type === DeclarationType.Variable && !!decl.isFinal);

            if (isDestFinal !== isSrcFinal) {
                if (isDestFinal) {
                    if (subDiag) {
                        subDiag.addMessage(Localizer.DiagnosticAddendum.memberIsFinalInProtocol().format({ name }));
                    }
                } else {
                    if (subDiag) {
                        subDiag.addMessage(Localizer.DiagnosticAddendum.memberIsNotFinalInProtocol().format({ name }));
                    }
                }
                typesAreConsistent = false;
            }

            const destPrimaryDecl = getLastTypedDeclaredForSymbol(destSymbol);
            const srcPrimaryDecl = getLastTypedDeclaredForSymbol(srcSymbol);

            if (
                destPrimaryDecl?.type === DeclarationType.Variable &&
                srcPrimaryDecl?.type === DeclarationType.Variable
            ) {
                const isDestReadOnly = !!destPrimaryDecl.isConstant;
                let isSrcReadOnly = !!srcPrimaryDecl.isConstant;
                if (srcMemberInfo && isClass(srcMemberInfo.classType)) {
                    if (
                        ClassType.isReadOnlyInstanceVariables(srcMemberInfo.classType) ||
                        ClassType.isFrozenDataClass(srcMemberInfo.classType)
                    ) {
                        isSrcReadOnly = true;
                    }
                }

                if (!isDestReadOnly && isSrcReadOnly) {
                    if (subDiag) {
                        subDiag.addMessage(Localizer.DiagnosticAddendum.memberIsWritableInProtocol().format({ name }));
                    }
                    typesAreConsistent = false;
                }
            }
        });
    });

    // If the dest protocol has type parameters, make sure the source type arguments match.
    if (typesAreConsistent && destType.details.typeParameters.length > 0) {
        // Create a specialized version of the protocol defined by the dest and
        // make sure the resulting type args can be assigned.
        const genericProtocolType = ClassType.cloneForSpecialization(
            destType,
            undefined,
            /* isTypeArgumentExplicit */ false
        );
        const specializedProtocolType = applySolvedTypeVars(genericProtocolType, protocolTypeVarContext) as ClassType;

        if (destType.typeArguments) {
            if (
                !evaluator.assignTypeArguments(
                    destType,
                    specializedProtocolType,
                    diag,
                    destTypeVarContext,
                    srcTypeVarContext,
                    flags,
                    recursionCount
                )
            ) {
                typesAreConsistent = false;
            }
        } else if (destTypeVarContext && !destTypeVarContext.isLocked()) {
            for (const typeParam of destType.details.typeParameters) {
                const typeArgEntry = protocolTypeVarContext.getPrimarySignature().getTypeVar(typeParam);

                if (typeArgEntry) {
                    destTypeVarContext.setTypeVarType(
                        typeParam,
                        typeArgEntry?.narrowBound,
                        typeArgEntry?.narrowBoundNoLiterals,
                        typeArgEntry?.wideBound
                    );
                }
            }
        }
    }

    return typesAreConsistent;
}

// Given a (possibly-specialized) destType and an optional typeVarContext, creates
// a new typeVarContext that combines the constraints from both the destType and
// the destTypeVarContext.
function createProtocolTypeVarContext(
    evaluator: TypeEvaluator,
    destType: ClassType,
    destTypeVarContext: TypeVarContext | undefined
): TypeVarContext {
    const protocolTypeVarContext = new TypeVarContext(getTypeVarScopeId(destType));

    destType.details.typeParameters.forEach((typeParam, index) => {
        const entry = destTypeVarContext?.getPrimarySignature().getTypeVar(typeParam);

        if (entry) {
            protocolTypeVarContext.setTypeVarType(
                typeParam,
                entry.narrowBound,
                entry.narrowBoundNoLiterals,
                entry.wideBound
            );
        } else if (destType.typeArguments && index < destType.typeArguments.length) {
            let typeArg = destType.typeArguments[index];
            let flags = AssignTypeFlags.PopulatingExpectedType;
            let hasUnsolvedTypeVars = requiresSpecialization(typeArg);

            // If the type argument has unsolved TypeVars, see if they have
            // solved values in the destTypeVarContext.
            if (hasUnsolvedTypeVars && destTypeVarContext) {
                typeArg = applySolvedTypeVars(typeArg, destTypeVarContext, { useNarrowBoundOnly: true });
                flags = AssignTypeFlags.Default;
                hasUnsolvedTypeVars = requiresSpecialization(typeArg);
            }

            if (!hasUnsolvedTypeVars) {
                assignTypeToTypeVar(evaluator, typeParam, typeArg, /* diag */ undefined, protocolTypeVarContext, flags);
            }
        }
    });

    return protocolTypeVarContext;
}
