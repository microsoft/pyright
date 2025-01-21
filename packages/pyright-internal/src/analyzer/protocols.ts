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
import { defaultMaxDiagnosticDepth, DiagnosticAddendum } from '../common/diagnostic';
import { LocAddendum } from '../localization/localize';
import { ConstraintSolution } from './constraintSolution';
import { assignTypeVar } from './constraintSolver';
import { ConstraintTracker } from './constraintTracker';
import { DeclarationType } from './declaration';
import { assignProperty } from './properties';
import { Symbol } from './symbol';
import { getLastTypedDeclarationForSymbol, isEffectivelyClassVar } from './symbolUtils';
import { AssignTypeFlags, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    FunctionType,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isOverloaded,
    isTypeSame,
    ModuleType,
    OverloadedType,
    Type,
    TypeBase,
    TypeVarType,
    UnknownType,
    Variance,
} from './types';
import {
    addSolutionForSelfType,
    applySolvedTypeVars,
    ClassMember,
    containsLiteralType,
    lookUpClassMember,
    makeFunctionTypeVarsBound,
    MemberAccessFlags,
    partiallySpecializeType,
    requiresSpecialization,
    requiresTypeArgs,
    selfSpecializeClass,
    synthesizeTypeVarForSelfCls,
} from './typeUtils';

interface ProtocolAssignmentStackEntry {
    srcType: ClassType;
    destType: ClassType;
}

interface ProtocolCompatibility {
    // Specialized source type or undefined if this entry applies
    // to all specializations
    srcType: ClassType | undefined;

    // Specialized dest type
    destType: ClassType;

    flags: AssignTypeFlags;
    preConstraints: ConstraintTracker | undefined;
    postConstraints: ConstraintTracker | undefined;
    isCompatible: boolean;
}

const protocolAssignmentStack: ProtocolAssignmentStackEntry[] = [];

// Maximum number of different types that are cached with a protocol.
const maxProtocolCompatibilityCacheEntries = 64;

export function assignClassToProtocol(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount: number
): boolean {
    // We assume that destType is an instantiable class that is a protocol. The
    // srcType can be an instantiable class or a class instance.
    assert(isInstantiableClass(destType) && ClassType.isProtocolClass(destType));

    // A literal source type should never affect protocol matching, so strip
    // the literal type if it's present. This helps conserve on cache entries.
    if (srcType.priv.literalValue !== undefined) {
        srcType = evaluator.stripLiteralValue(srcType) as ClassType;
    }

    const enforceInvariance = (flags & AssignTypeFlags.Invariant) !== 0;

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
    const compat = getProtocolCompatibility(destType, srcType, flags, constraints);

    if (compat !== undefined) {
        if (compat.isCompatible) {
            if (compat.postConstraints) {
                constraints?.copyFromClone(compat.postConstraints);
            }
            return true;
        }

        // If it's known not to be compatible and the caller hasn't requested
        // any detailed diagnostic information or we've already exceeded the
        // depth of diagnostic information that will be displayed, we can
        // return false immediately.
        if (!diag || diag.getNestLevel() > defaultMaxDiagnosticDepth) {
            return false;
        }
    }

    protocolAssignmentStack.push({ srcType, destType });
    let isCompatible = true;
    const clonedConstraints = constraints?.clone();

    try {
        isCompatible = assignToProtocolInternal(evaluator, destType, srcType, diag, constraints, flags, recursionCount);
    } catch (e) {
        // We'd normally use "finally" here, but the TS debugger does such
        // a poor job dealing with finally, we'll use a catch instead.
        protocolAssignmentStack.pop();
        throw e;
    }

    protocolAssignmentStack.pop();

    // Cache the results for next time.
    if (!compat) {
        setProtocolCompatibility(
            evaluator,
            destType,
            srcType,
            flags,
            clonedConstraints,
            constraints?.clone(),
            isCompatible,
            recursionCount
        );
    }

    return isCompatible;
}

export function assignModuleToProtocol(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ModuleType,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount: number
): boolean {
    return assignToProtocolInternal(evaluator, destType, srcType, diag, constraints, flags, recursionCount);
}

// Determines whether the specified class is a protocol class that has
// only methods, no other symbol types like variables.
export function isMethodOnlyProtocol(classType: ClassType): boolean {
    if (!ClassType.isProtocolClass(classType)) {
        return false;
    }

    // First check for data members in any protocol base classes.
    for (const baseClass of classType.shared.baseClasses) {
        if (isClass(baseClass) && ClassType.isProtocolClass(baseClass) && !isMethodOnlyProtocol(baseClass)) {
            return false;
        }
    }

    for (const [, symbol] of ClassType.getSymbolTable(classType)) {
        if (symbol.isIgnoredForProtocolMatch()) {
            continue;
        }

        if (symbol.getDeclarations().some((decl) => decl.type !== DeclarationType.Function)) {
            return false;
        }
    }

    return true;
}

// Determines whether the classType has "unsafe overlap" with a runtime checkable protocol.
// This can occur because the runtime doesn't do full type comparisons. It simply looks at
// the presence of specific attributes.
export function isProtocolUnsafeOverlap(evaluator: TypeEvaluator, protocol: ClassType, classType: ClassType): boolean {
    // If the classType is compatible with the protocol, then it doesn't overlap unsafely.
    if (evaluator.assignType(protocol, classType)) {
        return false;
    }

    let isUnsafeOverlap = true;

    protocol.shared.mro.forEach((mroClass) => {
        if (!isUnsafeOverlap || !isInstantiableClass(mroClass) || !ClassType.isProtocolClass(mroClass)) {
            return;
        }

        ClassType.getSymbolTable(mroClass).forEach((destSymbol, name) => {
            if (!isUnsafeOverlap || !destSymbol.isClassMember() || destSymbol.isIgnoredForProtocolMatch()) {
                return;
            }

            // Does the classType have a member with the same name?
            const srcMemberInfo = lookUpClassMember(classType, name);
            if (!srcMemberInfo) {
                isUnsafeOverlap = false;
            }
        });
    });

    return isUnsafeOverlap;
}

// Looks up the protocol compatibility in the cache. If it's not found,
// return undefined.
function getProtocolCompatibility(
    destType: ClassType,
    srcType: ClassType,
    flags: AssignTypeFlags,
    constraints: ConstraintTracker | undefined
): ProtocolCompatibility | undefined {
    const map = srcType.shared.protocolCompatibility as Map<string, ProtocolCompatibility[]> | undefined;
    const entries = map?.get(destType.shared.fullName);
    if (entries === undefined) {
        return undefined;
    }

    for (const entry of entries) {
        if (entry.flags !== flags) {
            continue;
        }

        if (entry.srcType === undefined) {
            if (ClassType.isSameGenericClass(entry.destType, destType)) {
                return entry;
            }

            continue;
        }

        if (
            isTypeSame(entry.destType, destType, { honorIsTypeArgExplicit: true, honorTypeForm: true }) &&
            isTypeSame(entry.srcType, srcType, { honorIsTypeArgExplicit: true, honorTypeForm: true }) &&
            isConstraintTrackerSame(constraints, entry.preConstraints)
        ) {
            return entry;
        }
    }

    return undefined;
}

function setProtocolCompatibility(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType,
    flags: AssignTypeFlags,
    preConstraints: ConstraintTracker | undefined,
    postConstraints: ConstraintTracker | undefined,
    isCompatible: boolean,
    recursionCount: number
) {
    let map = srcType.shared.protocolCompatibility as Map<string, ProtocolCompatibility[]> | undefined;
    if (!map) {
        map = new Map<string, ProtocolCompatibility[]>();
        srcType.shared.protocolCompatibility = map;
    }

    let entries = map.get(destType.shared.fullName);
    if (!entries) {
        entries = [];
        map.set(destType.shared.fullName, entries);
    }

    // See if the srcType is always incompatible regardless of how it
    // and the destType are specialized.
    let isAlwaysIncompatible = false;

    if (
        !isCompatible &&
        !entries.some((entry) => entry.flags === flags && ClassType.isSameGenericClass(entry.destType, destType))
    ) {
        const genericDestType = requiresTypeArgs(destType)
            ? selfSpecializeClass(destType, { overrideTypeArgs: true })
            : destType;
        const genericSrcType = requiresTypeArgs(srcType)
            ? selfSpecializeClass(srcType, { overrideTypeArgs: true })
            : srcType;

        if (
            !assignToProtocolInternal(
                evaluator,
                genericDestType,
                genericSrcType,
                /* diag */ undefined,
                /* constraints */ undefined,
                flags,
                recursionCount
            )
        ) {
            isAlwaysIncompatible = true;
        }
    }

    const newEntry: ProtocolCompatibility = {
        destType,
        srcType: isAlwaysIncompatible ? undefined : srcType,
        flags,
        preConstraints,
        postConstraints,
        isCompatible,
    };

    entries.push(newEntry);

    // Make sure the cache doesn't grow too large.
    if (entries.length > maxProtocolCompatibilityCacheEntries) {
        entries.shift();
    }
}

function isConstraintTrackerSame(context1: ConstraintTracker | undefined, context2: ConstraintTracker | undefined) {
    if (!context1 || !context2) {
        return context1 === context2;
    }

    return context1.isSame(context2);
}

function assignToProtocolInternal(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType | ModuleType,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount: number
): boolean {
    if ((flags & AssignTypeFlags.Invariant) !== 0) {
        return isTypeSame(destType, srcType);
    }

    evaluator.inferVarianceForClass(destType);

    const sourceIsClassObject = isClass(srcType) && TypeBase.isInstantiable(srcType);
    const protocolConstraints = createProtocolConstraints(evaluator, destType, constraints);
    const selfSolution = new ConstraintSolution();

    let selfType: ClassType | TypeVarType | undefined;
    if (isClass(srcType)) {
        // If the srcType is conditioned on "self", use "Self" as the selfType.
        // Otherwise use the class type for selfType.
        const synthCond = srcType.props?.condition?.find((c) => TypeVarType.isSelf(c.typeVar));
        if (synthCond) {
            selfType = synthesizeTypeVarForSelfCls(
                TypeBase.cloneForCondition(srcType, undefined),
                /* isClsType */ false
            );

            if (TypeVarType.isBound(synthCond.typeVar)) {
                selfType = TypeVarType.cloneAsBound(selfType);
            }
        } else {
            selfType = srcType;
        }

        addSolutionForSelfType(selfSolution, destType, selfType);
    }

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
    let assignTypeFlags = flags & (AssignTypeFlags.OverloadOverlap | AssignTypeFlags.PartialOverloadOverlap);

    assignTypeFlags |= containsLiteralType(srcType, /* includeTypeArgs */ true)
        ? AssignTypeFlags.RetainLiteralsForTypeVar
        : AssignTypeFlags.Default;

    destType.shared.mro.forEach((mroClass) => {
        if (!isInstantiableClass(mroClass) || !ClassType.isProtocolClass(mroClass)) {
            return;
        }

        // If we've already determined that the types are not consistent and the caller
        // hasn't requested detailed diagnostic output, we can shortcut the remainder.
        if (!typesAreConsistent && !diag) {
            return;
        }

        ClassType.getSymbolTable(mroClass).forEach((destSymbol, name) => {
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
            if (!sourceIsClassObject && name === '__class_getitem__') {
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
            let isDestReadOnly = false;

            if (isClass(srcType)) {
                // Look in the metaclass first if we're treating the source as an instantiable class.
                if (
                    sourceIsClassObject &&
                    srcType.shared.effectiveMetaclass &&
                    isInstantiableClass(srcType.shared.effectiveMetaclass)
                ) {
                    srcMemberInfo = lookUpClassMember(srcType.shared.effectiveMetaclass, name);
                    if (srcMemberInfo) {
                        isMemberFromMetaclass = true;
                    }
                }

                if (!srcMemberInfo) {
                    srcMemberInfo = lookUpClassMember(srcType, name);
                }

                if (!srcMemberInfo) {
                    diag?.addMessage(LocAddendum.protocolMemberMissing().format({ name }));
                    typesAreConsistent = false;
                    return;
                }

                srcSymbol = srcMemberInfo.symbol;

                // Partially specialize the type of the symbol based on the MRO class.
                // We can skip this if it's the dest class because it is already
                // specialized.
                if (!ClassType.isSameGenericClass(mroClass, destType)) {
                    destMemberType = partiallySpecializeType(
                        destMemberType,
                        mroClass,
                        evaluator.getTypeClassType(),
                        selfType
                    );
                }

                if (isInstantiableClass(srcMemberInfo.classType)) {
                    const symbolType = evaluator.getEffectiveTypeOfSymbol(srcMemberInfo.symbol);

                    // If this is a function, infer its return type prior to specializing it.
                    if (isFunction(symbolType)) {
                        evaluator.inferReturnTypeIfNecessary(symbolType);
                    }

                    srcMemberType = partiallySpecializeType(
                        symbolType,
                        srcMemberInfo.classType,
                        evaluator.getTypeClassType(),
                        selfType
                    );
                } else {
                    srcMemberType = UnknownType.create();
                }

                // If the source is a method, bind it.
                if (isFunction(srcMemberType) || isOverloaded(srcMemberType)) {
                    if (isMemberFromMetaclass || isInstantiableClass(srcMemberInfo.classType)) {
                        let isInstanceMember = !srcMemberInfo.symbol.isClassMember();

                        // Special-case dataclasses whose entries act like instance members.
                        if (ClassType.isDataClass(srcType)) {
                            const dataClassFields = ClassType.getDataClassEntries(srcType);
                            if (dataClassFields.some((entry) => entry.name === name)) {
                                isInstanceMember = true;
                            }
                        }

                        if (isMemberFromMetaclass) {
                            isInstanceMember = false;
                        }

                        // If this is a callable stored in an instance member, skip binding.
                        if (!isInstanceMember) {
                            const boundSrcFunction = evaluator.bindFunctionToClassOrObject(
                                sourceIsClassObject && !isMemberFromMetaclass
                                    ? srcType
                                    : ClassType.cloneAsInstance(srcType),
                                srcMemberType,
                                isMemberFromMetaclass ? undefined : (srcMemberInfo.classType as ClassType),
                                /* treatConstructorAsClassMethod */ undefined,
                                isMemberFromMetaclass ? srcType : selfType,
                                diag?.createAddendum(),
                                recursionCount
                            );

                            if (boundSrcFunction) {
                                srcMemberType = boundSrcFunction;
                            } else {
                                typesAreConsistent = false;
                                return;
                            }
                        }
                    }
                }

                if (srcMemberInfo.isReadOnly) {
                    isSrcReadOnly = true;
                }
            } else {
                srcSymbol = srcType.priv.fields.get(name);

                if (!srcSymbol) {
                    diag?.addMessage(LocAddendum.protocolMemberMissing().format({ name }));
                    typesAreConsistent = false;
                    return;
                }

                srcMemberType = evaluator.getEffectiveTypeOfSymbol(srcSymbol);
            }

            // Replace any "Self" TypeVar within the dest with the source type.
            destMemberType = applySolvedTypeVars(destMemberType, selfSolution);

            // If the dest is a method, bind it.
            if (!destSymbol.isInstanceMember() && (isFunction(destMemberType) || isOverloaded(destMemberType))) {
                let boundDeclaredType: FunctionType | OverloadedType | undefined;

                // Functions are considered read-only.
                isDestReadOnly = true;

                if (isClass(srcType)) {
                    assert(srcMemberInfo);

                    if (isMemberFromMetaclass || isInstantiableClass(srcMemberInfo.classType)) {
                        boundDeclaredType = evaluator.bindFunctionToClassOrObject(
                            ClassType.cloneAsInstance(srcType),
                            destMemberType,
                            isMemberFromMetaclass ? undefined : (srcMemberInfo.classType as ClassType),
                            /* treatConstructorAsClassMethod */ undefined,
                            isMemberFromMetaclass ? srcType : selfType,
                            diag,
                            recursionCount
                        );
                    }
                } else {
                    boundDeclaredType = evaluator.bindFunctionToClassOrObject(
                        ClassType.cloneAsInstance(destType),
                        destMemberType,
                        destType,
                        /* treatConstructorAsClassMethod */ undefined,
                        /* firstParamType */ undefined,
                        diag,
                        recursionCount
                    );
                }

                if (boundDeclaredType) {
                    boundDeclaredType = makeFunctionTypeVarsBound(boundDeclaredType);
                    destMemberType = boundDeclaredType;
                } else {
                    typesAreConsistent = false;
                    return;
                }
            }

            const subDiag = diag?.createAddendum();

            const isDestFinal = destSymbol
                .getTypedDeclarations()
                .some((decl) => decl.type === DeclarationType.Variable && !!decl.isFinal);
            const isSrcFinal = srcSymbol
                .getTypedDeclarations()
                .some((decl) => decl.type === DeclarationType.Variable && !!decl.isFinal);

            if (isSrcFinal) {
                isSrcReadOnly = true;
            }

            if (isDestFinal) {
                isDestReadOnly = true;
            }

            // Properties require special processing.
            if (isClassInstance(destMemberType) && ClassType.isPropertyClass(destMemberType)) {
                if (
                    isClassInstance(srcMemberType) &&
                    ClassType.isPropertyClass(srcMemberType) &&
                    !sourceIsClassObject
                ) {
                    if (
                        !assignProperty(
                            evaluator,
                            ClassType.cloneAsInstantiable(destMemberType),
                            ClassType.cloneAsInstantiable(srcMemberType),
                            mroClass,
                            srcType,
                            subDiag?.createAddendum(),
                            protocolConstraints,
                            selfSolution,
                            recursionCount
                        )
                    ) {
                        if (subDiag) {
                            subDiag.addMessage(LocAddendum.memberTypeMismatch().format({ name }));
                        }
                        typesAreConsistent = false;
                    }
                } else {
                    // Extract the property type from the property class.
                    let getterType = evaluator.getGetterTypeFromProperty(destMemberType);

                    if (getterType) {
                        getterType = partiallySpecializeType(getterType, mroClass, evaluator.getTypeClassType());
                    }

                    if (
                        !getterType ||
                        !evaluator.assignType(
                            getterType,
                            srcMemberType,
                            subDiag?.createAddendum(),
                            protocolConstraints,
                            assignTypeFlags,
                            recursionCount
                        )
                    ) {
                        if (subDiag) {
                            subDiag.addMessage(LocAddendum.memberTypeMismatch().format({ name }));
                        }
                        typesAreConsistent = false;
                    }

                    if (
                        !lookUpClassMember(destMemberType, '__set__', MemberAccessFlags.SkipInstanceMembers) &&
                        !lookUpClassMember(destMemberType, '__delete__', MemberAccessFlags.SkipInstanceMembers)
                    ) {
                        isDestReadOnly = true;
                    }

                    if (isSrcReadOnly) {
                        // The source attribute is read-only. Make sure the setter
                        // is not defined in the dest property.
                        if (!isDestReadOnly) {
                            if (subDiag) {
                                subDiag.addMessage(LocAddendum.memberIsWritableInProtocol().format({ name }));
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
                const protocolConstraintsClone = protocolConstraints.clone();

                if (
                    !evaluator.assignType(
                        destMemberType,
                        srcMemberType,
                        subDiag?.createAddendum(),
                        protocolConstraintsClone,
                        isInvariant ? assignTypeFlags | AssignTypeFlags.Invariant : assignTypeFlags,
                        recursionCount
                    )
                ) {
                    if (subDiag) {
                        if (isInvariant) {
                            subDiag.addMessage(LocAddendum.memberIsInvariant().format({ name }));
                        }
                        subDiag.addMessage(LocAddendum.memberTypeMismatch().format({ name }));
                    }
                    typesAreConsistent = false;
                } else {
                    protocolConstraints.copyFromClone(protocolConstraintsClone);
                }
            }

            if (!isDestReadOnly && isSrcReadOnly) {
                if (subDiag) {
                    subDiag.addMessage(LocAddendum.memberIsNotReadOnlyInProtocol().format({ name }));
                }
                typesAreConsistent = false;
            }

            const isDestClassVar = isEffectivelyClassVar(destSymbol, /* isDataclass */ false);
            const isSrcClassVar = isEffectivelyClassVar(
                srcSymbol,
                /* isDataclass */ isClass(srcType) && ClassType.isDataClass(srcType)
            );
            const isSrcVariable = srcSymbol.getDeclarations().some((decl) => decl.type === DeclarationType.Variable);

            if (sourceIsClassObject) {
                // If the source is not marked as a ClassVar or the dest (the protocol) is,
                // the types are not consistent given that the source is a class object.
                if (isDestClassVar) {
                    subDiag?.addMessage(LocAddendum.memberIsClassVarInProtocol().format({ name }));
                    typesAreConsistent = false;
                } else if (isSrcVariable && !isSrcClassVar) {
                    if (!isMemberFromMetaclass) {
                        subDiag?.addMessage(LocAddendum.memberIsNotClassVarInClass().format({ name }));
                        typesAreConsistent = false;
                    }
                }
            } else {
                // If the source is marked as a ClassVar but the dest (the protocol) is not,
                // or vice versa, the types are not consistent.
                if (isDestClassVar !== isSrcClassVar) {
                    if (isDestClassVar) {
                        subDiag?.addMessage(LocAddendum.memberIsClassVarInProtocol().format({ name }));
                    } else {
                        subDiag?.addMessage(LocAddendum.memberIsNotClassVarInProtocol().format({ name }));
                    }
                    typesAreConsistent = false;
                }
            }

            const destPrimaryDecl = getLastTypedDeclarationForSymbol(destSymbol);
            const srcPrimaryDecl = getLastTypedDeclarationForSymbol(srcSymbol);

            if (
                destPrimaryDecl?.type === DeclarationType.Variable &&
                srcPrimaryDecl?.type === DeclarationType.Variable
            ) {
                const isDestReadOnly = !!destPrimaryDecl.isConstant || !!destPrimaryDecl.isFinal;
                let isSrcReadOnly = !!srcPrimaryDecl.isConstant;
                if (srcMemberInfo && isClass(srcMemberInfo.classType)) {
                    if (srcMemberInfo.isReadOnly) {
                        isSrcReadOnly = true;
                    }
                }

                if (!isDestReadOnly && isSrcReadOnly) {
                    if (subDiag) {
                        subDiag.addMessage(LocAddendum.memberIsWritableInProtocol().format({ name }));
                    }
                    typesAreConsistent = false;
                }
            }
        });
    });

    // If the dest protocol has type parameters, make sure the source type arguments match.
    if (typesAreConsistent && destType.shared.typeParams.length > 0) {
        // Create a specialized version of the protocol defined by the dest and
        // make sure the resulting type args can be assigned.
        const genericProtocolType = ClassType.specialize(destType, undefined);
        const specializedProtocolType = evaluator.solveAndApplyConstraints(
            genericProtocolType,
            protocolConstraints
        ) as ClassType;

        if (destType.priv.typeArgs) {
            if (
                !evaluator.assignTypeArgs(destType, specializedProtocolType, diag, constraints, flags, recursionCount)
            ) {
                typesAreConsistent = false;
            }
        } else if (constraints) {
            for (const typeParam of destType.shared.typeParams) {
                const typeArgEntry = protocolConstraints.getMainConstraintSet().getTypeVar(typeParam);

                if (typeArgEntry) {
                    constraints.copyBounds(typeArgEntry);
                }
            }
        }
    }

    return typesAreConsistent;
}

// Given a (possibly-specialized) destType and an optional constraint tracker,
// creates a new constraint tracker that combines the constraints from both the
// destType and the destConstraints.
function createProtocolConstraints(
    evaluator: TypeEvaluator,
    destType: ClassType,
    constraints: ConstraintTracker | undefined
): ConstraintTracker {
    const protocolConstraints = new ConstraintTracker();

    destType.shared.typeParams.forEach((typeParam, index) => {
        const entry = constraints?.getMainConstraintSet().getTypeVar(typeParam);

        if (entry) {
            protocolConstraints.copyBounds(entry);
        } else if (destType.priv.typeArgs && index < destType.priv.typeArgs.length) {
            let typeArg = destType.priv.typeArgs[index];
            let flags: AssignTypeFlags;
            let hasUnsolvedTypeVars = requiresSpecialization(typeArg);

            // If the type argument has unsolved TypeVars, see if they have
            // solved values in the destConstraints.
            if (hasUnsolvedTypeVars && constraints) {
                typeArg = evaluator.solveAndApplyConstraints(typeArg, constraints, /* applyOptions */ undefined, {
                    useLowerBoundOnly: true,
                });
                flags = AssignTypeFlags.Default;
                hasUnsolvedTypeVars = requiresSpecialization(typeArg);
            } else {
                flags = AssignTypeFlags.PopulateExpectedType;

                const variance = TypeVarType.getVariance(typeParam);
                if (variance === Variance.Invariant) {
                    flags |= AssignTypeFlags.Invariant;
                } else if (variance === Variance.Contravariant) {
                    flags |= AssignTypeFlags.Contravariant;
                }
            }

            if (!hasUnsolvedTypeVars) {
                assignTypeVar(evaluator, typeParam, typeArg, /* diag */ undefined, protocolConstraints, flags);
            }
        }
    });

    return protocolConstraints;
}
