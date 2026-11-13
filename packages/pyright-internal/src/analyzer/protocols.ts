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
import { DiagnosticRule } from '../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../localization/localize';
import { ExpressionNode, ParamCategory } from '../parser/parseNodes';
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
    combineTypes,
    FunctionParam,
    FunctionType,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isOverloaded,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
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
    buildSolutionFromSpecializedClass,
    ClassMember,
    containsLiteralType,
    derivesFromClassRecursive,
    doForEachSubtype,
    lookUpClassMember,
    makeFunctionTypeVarsBound,
    makeTypeVarsFree,
    MemberAccessFlags,
    partiallySpecializeType,
    requiresSpecialization,
    selfSpecializeClass,
    synthesizeTypeVarForSelfCls,
} from './typeUtils';

interface ProtocolAssignmentStackEntry {
    srcType: ClassType;
    destType: ClassType;
}

const sequenceProtocolMemberNames = new Set([
    '__len__',
    '__getitem__',
    '__contains__',
    '__iter__',
    '__reversed__',
    'count',
    'index',
]);

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
    isFastRejection: boolean;
}

interface ProtocolCompatibilityCheckState {
    isOverloadedTypeBindingFailure: boolean;
    isFastRejection: boolean;
    isUniversalCompatibilityCheck: boolean;
}

const protocolAssignmentStack: ProtocolAssignmentStackEntry[] = [];

// Maximum number of different types that are cached with a protocol.
const maxProtocolCompatibilityCacheEntries = 64;

// A pending check that a generic class is compatible with a protocol for
// every specialization of the class. While it's pending, nested checks of
// the same class and protocol are assumed to be compatible if their type
// arguments are a specialization of the pending check.
interface AlwaysCompatibleCheck {
    srcType: ClassType;
    destType: ClassType;

    // The protocol specialization being checked, or undefined while the
    // protocol's type arguments are being solved.
    specializedDestType: ClassType | undefined;
    flags: AssignTypeFlags;

    // Set if assignType reaches its recursion limit during the check, which
    // makes a successful result inconclusive.
    isRecursionLimitReached: boolean;
}

const universalCompatibilityStack: AlwaysCompatibleCheck[] = [];

export function noteAssignTypeRecursionLimit() {
    universalCompatibilityStack.forEach((entry) => {
        entry.isRecursionLimitReached = true;
    });
}

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

    // Diagnostic information beyond the maximum depth isn't displayed, and
    // collecting it means checking every member after one is incompatible.
    if (diag && diag.getNestLevel() > defaultMaxDiagnosticDepth) {
        diag = undefined;
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

    const pendingCheck = universalCompatibilityStack.find(
        (entry) =>
            entry.flags === flags &&
            TypeBase.isInstantiable(entry.srcType) === TypeBase.isInstantiable(srcType) &&
            ClassType.isSameGenericClass(entry.srcType, srcType) &&
            ClassType.isSameGenericClass(entry.destType, destType)
    );
    if (pendingCheck) {
        if (!pendingCheck.specializedDestType) {
            return true;
        }

        return (
            !!destType.priv.typeArgs &&
            evaluator.assignTypeArgs(
                destType,
                applySolvedTypeVars(
                    pendingCheck.specializedDestType,
                    buildSolutionFromSpecializedClass(srcType)
                ) as ClassType,
                diag,
                constraints,
                flags,
                recursionCount
            )
        );
    }

    // If the same class and protocol are already pending with different type
    // arguments, the type arguments can grow with each cycle, so first check
    // compatibility for every specialization of the class.
    if (
        !enforceInvariance &&
        universalCompatibilityStack.length === 0 &&
        destType.priv.typeArgs &&
        protocolAssignmentStack.some(
            (entry) =>
                ClassType.isSameGenericClass(entry.srcType, srcType) &&
                ClassType.isSameGenericClass(entry.destType, destType)
        )
    ) {
        const key = `${makeProtocolCompatibilityCacheClassKey(destType)}/${flags}/${TypeBase.isInstantiable(srcType)}`;
        let cache = srcType.shared.universalProtocolCompatibility as Map<string, ClassType | undefined> | undefined;
        if (cache === undefined) {
            cache = new Map<string, ClassType | undefined>();
            srcType.shared.universalProtocolCompatibility = cache;
        }

        let alwaysCompatibleType: ClassType | undefined;
        if (cache.has(key)) {
            alwaysCompatibleType = cache.get(key);
        } else {
            const result = checkAlwaysCompatible(evaluator, destType, srcType, flags, recursionCount);
            if (!result.isRecursionLimitReached) {
                alwaysCompatibleType = result.specializedDestType;
                cache.set(key, alwaysCompatibleType);
            }
        }

        // The specialization is one of possibly several that the class is
        // compatible with, so don't let it choose the solution of a type
        // variable in the dest's type arguments.
        const solvedDestType = constraints
            ? (evaluator.solveAndApplyConstraints(destType, constraints, /* applyOptions */ undefined, {
                  useLowerBoundOnly: true,
              }) as ClassType)
            : destType;

        if (
            alwaysCompatibleType &&
            !requiresSpecialization(solvedDestType) &&
            evaluator.assignTypeArgs(
                solvedDestType,
                applySolvedTypeVars(alwaysCompatibleType, buildSolutionFromSpecializedClass(srcType)) as ClassType,
                /* diag */ undefined,
                /* constraints */ undefined,
                flags,
                recursionCount
            )
        ) {
            return true;
        }
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
    const checkState: ProtocolCompatibilityCheckState = {
        isOverloadedTypeBindingFailure: false,
        isFastRejection: false,
        isUniversalCompatibilityCheck: false,
    };

    try {
        isCompatible = assignToProtocolInternal(
            evaluator,
            destType,
            srcType,
            diag,
            constraints,
            flags,
            recursionCount,
            checkState
        );
    } catch (e) {
        // We'd normally use "finally" here, but the TS debugger does such
        // a poor job dealing with finally, we'll use a catch instead.
        protocolAssignmentStack.pop();
        throw e;
    }

    protocolAssignmentStack.pop();

    // Cache the results for next time. A result within a pending check for
    // every specialization can depend on an assumption that the check fails.
    if (
        universalCompatibilityStack.length === 0 &&
        (!compat || (compat.isFastRejection && !checkState.isFastRejection))
    ) {
        setProtocolCompatibility(
            evaluator,
            destType,
            srcType,
            flags,
            clonedConstraints,
            constraints?.clone(),
            isCompatible,
            checkState.isFastRejection,
            recursionCount
        );
    }

    return isCompatible;
}

// Returns a specialization of the protocol that every specialization of the
// source class is compatible with, or undefined if the check fails.
function checkAlwaysCompatible(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType,
    flags: AssignTypeFlags,
    recursionCount: number
): { specializedDestType: ClassType | undefined; isRecursionLimitReached: boolean } {
    if (
        srcType.priv.tupleTypeArgs ||
        srcType.shared.typeParams.some((typeParam) => TypeVarType.hasConstraints(typeParam)) ||
        destType.shared.typeParams.some((typeParam) => TypeVarType.hasConstraints(typeParam))
    ) {
        return { specializedDestType: undefined, isRecursionLimitReached: false };
    }

    // Treat the source class's type parameters as opaque so the result holds
    // for any type argument.
    const genericSrcType = selfSpecializeClass(srcType, { overrideTypeArgs: true, useBoundTypeVars: true });
    const pendingCheck: AlwaysCompatibleCheck = {
        srcType: genericSrcType,
        destType,
        specializedDestType: undefined,
        flags,
        isRecursionLimitReached: false,
    };

    universalCompatibilityStack.push(pendingCheck);

    try {
        // Solve the protocol's type parameters. A type parameter that's used
        // only in nested checks of the same protocol stays unsolved, so use the
        // source class's type parameter of the same kind at the same index.
        const solveConstraints = new ConstraintTracker();
        if (
            !assignToProtocolInternal(
                evaluator,
                ClassType.specialize(destType, /* typeArgs */ undefined),
                genericSrcType,
                /* diag */ undefined,
                solveConstraints,
                flags,
                recursionCount
            )
        ) {
            universalCompatibilityStack.pop();
            return { specializedDestType: undefined, isRecursionLimitReached: pendingCheck.isRecursionLimitReached };
        }

        const typeArgs: Type[] = [];
        for (let i = 0; i < destType.shared.typeParams.length; i++) {
            const typeParam = destType.shared.typeParams[i];
            const srcTypeParam = i < srcType.shared.typeParams.length ? srcType.shared.typeParams[i] : undefined;
            let typeArg: Type | undefined;

            if (solveConstraints.getMainConstraintSet().getTypeVar(typeParam)) {
                typeArg = evaluator.solveAndApplyConstraints(typeParam, solveConstraints);
            } else if (
                srcTypeParam &&
                isTypeVarTuple(srcTypeParam) === isTypeVarTuple(typeParam) &&
                isParamSpec(srcTypeParam) === isParamSpec(typeParam)
            ) {
                typeArg = genericSrcType.priv.typeArgs?.[i];
            }

            if (!typeArg) {
                universalCompatibilityStack.pop();
                return {
                    specializedDestType: undefined,
                    isRecursionLimitReached: pendingCheck.isRecursionLimitReached,
                };
            }
            typeArgs.push(typeArg);
        }

        // Store the specialization with the source class's type parameters
        // free so it can be specialized for each source type argument.
        const specializedDestType = ClassType.specialize(destType, typeArgs);
        const scopeId = srcType.shared.typeVarScopeId;
        pendingCheck.specializedDestType = scopeId
            ? makeTypeVarsFree(specializedDestType, [scopeId])
            : specializedDestType;

        const isCompatible = assignToProtocolInternal(
            evaluator,
            specializedDestType,
            genericSrcType,
            /* diag */ undefined,
            /* constraints */ undefined,
            flags,
            recursionCount
        );

        universalCompatibilityStack.pop();
        return {
            specializedDestType: isCompatible ? pendingCheck.specializedDestType : undefined,
            isRecursionLimitReached: pendingCheck.isRecursionLimitReached,
        };
    } catch (e) {
        universalCompatibilityStack.pop();
        throw e;
    }
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

export function validateProtocolUnsafeOverlap(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    protocol: ClassType,
    testType: Type
) {
    if (ClassType.isProtocolClass(protocol)) {
        const diag = new DiagnosticAddendum();

        doForEachSubtype(testType, (testSubtype) => {
            if (isClassInstance(testSubtype) && isProtocolUnsafeOverlap(evaluator, protocol, testSubtype)) {
                diag.addMessage(
                    LocAddendum.protocolUnsafeOverlap().format({
                        name: testSubtype.shared.name,
                    })
                );
            }
        });

        if (!diag.isEmpty()) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.protocolUnsafeOverlap().format({
                    name: protocol.shared.name,
                }) + diag.getString(),
                errorNode
            );
        }
    }
}

function makeProtocolCompatibilityCacheClassKey(classType: ClassType): string {
    // Create a unique key based on the full name of the class and its type source ID,
    // which is derived from the character offset of the class in the source file.
    return `${classType.shared.fullName}.${classType.shared.typeSourceId}`;
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
    if (!map) {
        return undefined;
    }

    const classKey = makeProtocolCompatibilityCacheClassKey(destType);
    const entries = map.get(classKey);
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
    isFastRejection: boolean,
    recursionCount: number
) {
    let map = srcType.shared.protocolCompatibility as Map<string, ProtocolCompatibility[]> | undefined;
    if (!map) {
        map = new Map<string, ProtocolCompatibility[]>();
        srcType.shared.protocolCompatibility = map;
    }

    const classKey = makeProtocolCompatibilityCacheClassKey(destType);
    let entries = map.get(classKey);
    if (!entries) {
        entries = [];
        map.set(classKey, entries);
    }

    // See if the srcType is always incompatible regardless of how it
    // and the destType are specialized.
    let isAlwaysIncompatible = false;

    if (
        !isCompatible &&
        !isFastRejection &&
        !entries.some(
            (entry) =>
                !entry.isFastRejection &&
                entry.flags === flags &&
                ClassType.isSameGenericClass(entry.destType, destType)
        )
    ) {
        // Type parameter defaults don't make a class nongeneric. Replace all
        // specializations before testing for universal incompatibility.
        const genericDestType = selfSpecializeClass(destType, { overrideTypeArgs: true });
        const genericSrcType = selfSpecializeClass(srcType, { overrideTypeArgs: true });
        const checkState: ProtocolCompatibilityCheckState = {
            isOverloadedTypeBindingFailure: false,
            isFastRejection: false,
            isUniversalCompatibilityCheck: true,
        };

        // An overload can use its "self" annotation to filter by specialization,
        // so a generic binding failure doesn't prove universal incompatibility.
        if (
            !assignToProtocolInternal(
                evaluator,
                genericDestType,
                genericSrcType,
                /* diag */ undefined,
                /* constraints */ undefined,
                flags,
                recursionCount,
                checkState
            ) &&
            !checkState.isOverloadedTypeBindingFailure
        ) {
            isAlwaysIncompatible = true;
        }
    }

    if (!isFastRejection) {
        const fastEntryIndex = entries.findIndex(
            (entry) =>
                entry.isFastRejection &&
                entry.flags === flags &&
                isTypeSame(entry.destType, destType, { honorIsTypeArgExplicit: true, honorTypeForm: true }) &&
                entry.srcType !== undefined &&
                isTypeSame(entry.srcType, srcType, { honorIsTypeArgExplicit: true, honorTypeForm: true }) &&
                isConstraintTrackerSame(preConstraints, entry.preConstraints)
        );
        if (fastEntryIndex >= 0) {
            entries.splice(fastEntryIndex, 1);
        }
    }

    const newEntry: ProtocolCompatibility = {
        destType,
        srcType: isAlwaysIncompatible ? undefined : srcType,
        flags,
        preConstraints,
        postConstraints,
        isCompatible,
        isFastRejection,
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

    if (!context1.isSame(context2)) {
        return false;
    }

    return context1.getConstraintSets().every((set, index) => {
        const other = context2.getConstraintSet(index);
        const scopes = Array.from(set.getScopeIds());
        const otherScopes = Array.from(other.getScopeIds());
        return (
            scopes.length === otherScopes.length &&
            scopes.every((scope, scopeIndex) => scope === otherScopes[scopeIndex]) &&
            set.getTypeVars().every((entry) => entry.retainLiterals === other.getTypeVar(entry.typeVar)?.retainLiterals)
        );
    });
}

function assignToProtocolInternal(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType | ModuleType,
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount: number,
    checkState?: ProtocolCompatibilityCheckState
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
        const srcClassType = srcType;

        // If the srcType is conditioned on its own "self", use "Self" as the
        // selfType. A condition from an enclosing expression's Self type should
        // not affect the specialization of this class.
        const synthCond = srcClassType.props?.condition?.find((c) => {
            const boundType = c.typeVar.shared.boundType;
            if (!TypeVarType.isSelf(c.typeVar) || !boundType || !isClass(boundType)) {
                return false;
            }

            return derivesFromClassRecursive(srcClassType, boundType, /* ignoreUnknown */ true);
        });
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

    if (
        !checkState?.isUniversalCompatibilityCheck &&
        (!diag || evaluator.isSpeculativeModeInUse(/* node */ undefined))
    ) {
        const mismatchedMember = tryFastRejectSequenceProtocol(
            evaluator,
            destType,
            srcType,
            constraints,
            flags,
            recursionCount
        );
        if (mismatchedMember) {
            if (checkState) {
                checkState.isFastRejection = true;
            }
            diag?.createAddendum().addMessage(LocAddendum.memberTypeMismatch().format({ name: mismatchedMember }));
            return false;
        }
    }

    let typesAreConsistent = true;
    const checkedSymbolSet = new Set<string>();
    let assignTypeFlags =
        flags &
        (AssignTypeFlags.OverloadOverlap |
            AssignTypeFlags.PartialOverloadOverlap |
            AssignTypeFlags.RejectCyclicLowerBound);

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

                if (!srcMemberInfo && (flags & AssignTypeFlags.AllowMissingProtocolMembers) !== 0) {
                    return;
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
                if (isFunctionOrOverloaded(srcMemberType)) {
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
                                if (checkState && isOverloaded(srcMemberType)) {
                                    checkState.isOverloadedTypeBindingFailure = true;
                                }
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
            if (!destSymbol.isInstanceMember() && isFunctionOrOverloaded(destMemberType)) {
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
                    if (checkState && isOverloaded(destMemberType)) {
                        checkState.isOverloadedTypeBindingFailure = true;
                    }
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
                            assignTypeFlags,
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
                const memberDiag = subDiag?.createAddendum();
                const memberFlags = isInvariant ? assignTypeFlags | AssignTypeFlags.Invariant : assignTypeFlags;

                if (
                    !evaluator.assignType(
                        destMemberType,
                        srcMemberType,
                        memberDiag,
                        protocolConstraintsClone,
                        memberFlags,
                        recursionCount
                    )
                ) {
                    if (subDiag) {
                        if (isInvariant) {
                            subDiag.addMessage(LocAddendum.memberIsInvariant().format({ name }));
                        }
                        subDiag.addMessage(LocAddendum.memberTypeMismatch().format({ name }));

                        const displayDestType = evaluator.solveAndApplyConstraints(
                            destMemberType,
                            protocolConstraintsClone
                        );
                        if (!isTypeSame(displayDestType, destMemberType) && !requiresSpecialization(displayDestType)) {
                            const printedTypes = evaluator.printSrcDestTypes(srcMemberType, displayDestType);

                            // Replace the details with a one-line summary if the source and
                            // solved dest types print differently, unless the dest is a method
                            // that still fails with its return type unchecked, which means its
                            // parameters don't match.
                            if (
                                printedTypes.sourceType !== printedTypes.destType &&
                                (!isFunctionOrOverloaded(destMemberType) ||
                                    ((memberFlags & AssignTypeFlags.SkipReturnTypeCheck) === 0 &&
                                        evaluator.assignType(
                                            destMemberType,
                                            srcMemberType,
                                            /* diag */ undefined,
                                            protocolConstraints.clone(),
                                            memberFlags | AssignTypeFlags.SkipReturnTypeCheck,
                                            recursionCount
                                        )))
                            ) {
                                const children = subDiag.getChildren();
                                children.splice(children.indexOf(memberDiag!), 1);
                                subDiag.addMessage(LocAddendum.typeAssignmentMismatch().format(printedTypes));
                            }
                        }
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
                !evaluator.assignTypeArgs(
                    destType,
                    specializedProtocolType,
                    diag,
                    constraints,
                    flags & ~AssignTypeFlags.AllowMissingProtocolMembers,
                    recursionCount
                )
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

// Some recursive sequence protocols describe an element as either a leaf value or another
// instance of the same protocol. Proving that a list of complex element types does not match
// such a protocol through the normal member-by-member walk can be disproportionately expensive.
//
// This is a negative-only fast path. It first verifies the protocol's specialized __getitem__
// return type is exactly `Leaf | Protocol[Leaf]`. This makes element compatibility a necessary
// condition of the full protocol assignment. If that condition fails, the source sequence cannot
// satisfy __getitem__. Every uncertain case falls back to the normal structural protocol walk.
export function tryFastRejectSequenceProtocol(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType | ModuleType,
    constraints: ConstraintTracker | undefined,
    flags: AssignTypeFlags,
    recursionCount: number
): '__getitem__' | undefined {
    if (!isClassInstance(srcType) || !ClassType.isBuiltIn(srcType, 'list')) {
        return undefined;
    }

    if (destType.shared.typeParams.length !== 1 || !destType.priv.typeArgs || destType.priv.typeArgs.length !== 1) {
        return undefined;
    }

    const destTypeParam = destType.shared.typeParams[0];
    if (TypeVarType.getVariance(destTypeParam) !== Variance.Covariant) {
        return undefined;
    }

    if (!isSequenceLikeProtocol(destType)) {
        return undefined;
    }

    const srcElementType = srcType.priv.typeArgs?.[0];

    if (!srcElementType || isAnyOrUnknown(srcElementType) || isTypeVar(srcElementType)) {
        return undefined;
    }

    const listIndexContract = getListElementIndexContract(evaluator, srcType);
    if (!listIndexContract) {
        return undefined;
    }

    if (
        !(constraints && !constraints.isEmpty() && requiresSpecialization(destType.priv.typeArgs[0])) &&
        hasMissingLeafAndSequenceMembers(evaluator, destType, srcType)
    ) {
        const expected = combineTypes([destType.priv.typeArgs[0], ClassType.cloneAsInstance(destType)]);
        if (hasRecursiveSequenceGetItem(evaluator, destType, expected, listIndexContract.sliceIndexType)) {
            return '__getitem__';
        }
    }

    const destElementType = destType.priv.typeArgs[0];
    if (
        isAnyOrUnknown(destElementType) ||
        isTypeVar(destElementType) ||
        (constraints && requiresSpecialization(destElementType))
    ) {
        return undefined;
    }

    const recursiveDestElementType = combineTypes([destElementType, ClassType.cloneAsInstance(destType)]);
    if (!hasRecursiveSequenceGetItem(evaluator, destType, recursiveDestElementType, listIndexContract.sliceIndexType)) {
        return undefined;
    }

    // The reduced check can solve TypeVars while testing a generic overload. Keep those speculative
    // solutions isolated; a fast rejection must not modify constraints observable by the caller.
    const constraintsClone = constraints?.clone();
    let assignTypeFlags = flags & (AssignTypeFlags.OverloadOverlap | AssignTypeFlags.PartialOverloadOverlap);
    if (containsLiteralType(srcElementType, /* includeTypeArgs */ true)) {
        assignTypeFlags |= AssignTypeFlags.RetainLiteralsForTypeVar;
    }

    if (
        !evaluator.assignType(
            recursiveDestElementType,
            srcElementType,
            /* diag */ undefined,
            constraintsClone,
            assignTypeFlags,
            recursionCount
        )
    ) {
        return '__getitem__';
    }

    return undefined;
}

function getListElementIndexContract(
    evaluator: TypeEvaluator,
    source: ClassType
): { sliceIndexType: ClassType } | undefined {
    if (source.shared.typeParams.length !== 1) {
        return undefined;
    }
    const member = lookUpClassMember(source, '__getitem__');
    if (
        !member ||
        !isInstantiableClass(member.classType) ||
        !ClassType.isSameGenericClass(member.classType, ClassType.cloneAsInstantiable(source))
    ) {
        return undefined;
    }
    const memberType = evaluator.getDeclaredTypeOfSymbol(member.symbol)?.type;
    if (!memberType || !isOverloaded(memberType)) {
        return undefined;
    }
    const overloads = OverloadedType.getOverloads(memberType);
    if (overloads.length !== 2) {
        return undefined;
    }
    const indexTypes = overloads.map((overload) => {
        const parameters = overload.shared.parameters;
        if (
            parameters.filter((parameter) => parameter.name).length !== 2 ||
            parameters.some((parameter) => parameter.category !== ParamCategory.Simple) ||
            !parameters[0]?.name ||
            !parameters[1]?.name ||
            !FunctionType.isInstanceMethod(overload) ||
            FunctionParam.isTypeDeclared(parameters[0])
        ) {
            return undefined;
        }
        return FunctionType.getParamType(overload, 1);
    });
    const returnType = FunctionType.getEffectiveReturnType(overloads[0]);
    if (
        !!indexTypes[0] &&
        isClassInstance(indexTypes[0]) &&
        indexTypes[0].shared.fullName === 'typing.SupportsIndex' &&
        !!indexTypes[1] &&
        isClassInstance(indexTypes[1]) &&
        ClassType.isBuiltIn(indexTypes[1], 'slice') &&
        !!returnType &&
        isTypeSame(returnType, source.shared.typeParams[0])
    ) {
        return { sliceIndexType: indexTypes[1] };
    }
    return undefined;
}

function hasMissingLeafAndSequenceMembers(
    evaluator: TypeEvaluator,
    destination: ClassType,
    source: ClassType | ModuleType
): boolean {
    if (!isClassInstance(source) || !ClassType.isBuiltIn(source, 'list')) {
        return false;
    }
    const element = source.priv.typeArgs?.[0];
    if (!element) {
        return false;
    }
    const elements = isUnion(element) ? element.priv.subtypes : [element];
    if (!elements.length) {
        return false;
    }
    const leaf = destination.priv.typeArgs?.[0];
    if (
        !leaf ||
        !isClassInstance(leaf) ||
        !ClassType.isProtocolClass(leaf) ||
        !leaf.shared.mro.every(isInstantiableClass)
    ) {
        return false;
    }
    const members = new Set<string>();
    for (const base of leaf.shared.mro) {
        if (!isInstantiableClass(base) || !ClassType.isProtocolClass(base)) {
            continue;
        }
        ClassType.getSymbolTable(base).forEach((symbol, name) => {
            if (
                symbol.isClassMember() &&
                !symbol.isIgnoredForProtocolMatch() &&
                name !== '__slots__' &&
                name !== '__class_getitem__'
            ) {
                members.add(name);
            }
        });
    }
    if (members.size !== 1 || members.has('__call__')) {
        return false;
    }
    const memberName = Array.from(members)[0];
    const member = lookUpClassMember(leaf, memberName);
    if (!member || !evaluator.getDeclaredTypeOfSymbol(member.symbol)) {
        return false;
    }
    return elements.every((elementType) => {
        let elementClass: ClassType | undefined;
        if (isFunctionOrOverloaded(elementType)) {
            elementClass = evaluator.getFunctionClassType(elementType);
        } else if (
            isClassInstance(elementType) &&
            !ClassType.isProtocolClass(elementType) &&
            !ClassType.isTypedDictClass(elementType) &&
            !requiresSpecialization(elementType) &&
            !elementType.props?.condition?.length
        ) {
            elementClass = ClassType.cloneAsInstantiable(elementType);
            const attributeAccess = lookUpClassMember(elementClass, '__getattribute__');
            if (
                lookUpClassMember(elementClass, '__getattr__') ||
                (attributeAccess &&
                    (!isInstantiableClass(attributeAccess.classType) ||
                        !ClassType.isBuiltIn(attributeAccess.classType, 'object')))
            ) {
                return false;
            }
        }
        return (
            elementClass &&
            elementClass.shared.mro.every(isInstantiableClass) &&
            !lookUpClassMember(elementClass, memberName) &&
            !lookUpClassMember(elementClass, '__getitem__')
        );
    });
}

function hasRecursiveSequenceGetItem(
    evaluator: TypeEvaluator,
    classType: ClassType,
    expectedReturnType: Type,
    sliceIndexType: ClassType
): boolean {
    const memberInfo = lookUpClassMember(classType, '__getitem__');
    if (!memberInfo || !isInstantiableClass(memberInfo.classType)) {
        return false;
    }

    let memberType = evaluator.getDeclaredTypeOfSymbol(memberInfo.symbol)?.type;
    if (!memberType) {
        return false;
    }

    memberType = partiallySpecializeType(memberType, classType, evaluator.getTypeClassType());
    if (!isFunction(memberType)) {
        return false;
    }

    const boundMemberType = evaluator.bindFunctionToClassOrObject(
        ClassType.cloneAsInstance(classType),
        memberType,
        classType,
        /* treatConstructorAsClassMethod */ undefined,
        /* firstParamType */ undefined,
        /* diag */ undefined,
        /* recursionCount */ 0
    );
    if (!boundMemberType || !isFunction(boundMemberType)) {
        return false;
    }

    const indexParam = boundMemberType.shared.parameters[0];
    if (!indexParam || indexParam.category !== ParamCategory.Simple || !indexParam.name) {
        return false;
    }

    const indexType = FunctionType.getParamType(boundMemberType, 0);
    if (!isClassInstance(indexType) || !ClassType.isBuiltIn(indexType, 'int')) {
        return false;
    }

    if (evaluator.assignType(sliceIndexType, indexType)) {
        return false;
    }

    const returnType = FunctionType.getEffectiveReturnType(boundMemberType);
    return !!returnType && isTypeSame(returnType, expectedReturnType);
}

// Restrict the semantic check above to the standard read-only sequence protocol surface. This is
// a scope guard rather than the correctness proof: protocols with these names but different
// __getitem__ semantics are rejected by hasRecursiveSequenceGetItem and use normal matching.
function isSequenceLikeProtocol(classType: ClassType): boolean {
    const requiredMemberNames = new Set<string>();

    classType.shared.mro.forEach((mroClass) => {
        if (!isInstantiableClass(mroClass) || !ClassType.isProtocolClass(mroClass)) {
            return;
        }

        ClassType.getSymbolTable(mroClass).forEach((symbol, name) => {
            if (!symbol.isClassMember() || symbol.isIgnoredForProtocolMatch()) {
                return;
            }

            requiredMemberNames.add(name);
        });
    });

    if (
        !requiredMemberNames.has('__len__') ||
        !requiredMemberNames.has('__getitem__') ||
        !requiredMemberNames.has('__iter__')
    ) {
        return false;
    }

    return Array.from(requiredMemberNames).every((name) => sequenceProtocolMemberNames.has(name));
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
        // The constraints can hold this type parameter for an enclosing
        // instantiation of the same protocol, so use them only if the dest
        // isn't specialized with a different type argument.
        const destTypeArg = destType.priv.typeArgs?.[index];
        const entry =
            !destTypeArg || isTypeSame(destTypeArg, typeParam)
                ? constraints?.getMainConstraintSet().getTypeVar(typeParam)
                : undefined;

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
