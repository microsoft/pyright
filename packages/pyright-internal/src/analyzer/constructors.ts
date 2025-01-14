/*
 * constructors.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides type evaluation logic for constructors. A constructor
 * in Python is implemented by a `__call__` method on the metaclass,
 * which is typically the `type` class. The default implementation
 * calls the `__new__` method on the class to allocate the object.
 * If the resulting object is an instance of the class, it then calls
 * the `__init__` method on the resulting object with the same arguments.
 */

import { appendArray } from '../common/collectionUtils';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { ExpressionNode, ParamCategory } from '../parser/parseNodes';
import { ConstraintSolution } from './constraintSolution';
import { addConstraintsForExpectedType } from './constraintSolver';
import { ConstraintTracker } from './constraintTracker';
import { applyConstructorTransform, hasConstructorTransform } from './constructorTransform';
import { Arg, CallResult, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    ClassType,
    FunctionType,
    FunctionTypeFlags,
    InheritanceChain,
    OverloadedType,
    Type,
    TypeVarType,
    UnknownType,
    combineTypes,
    findSubtype,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isOverloaded,
    isTypeVar,
    isUnknown,
} from './types';
import {
    InferenceContext,
    MemberAccessFlags,
    addTypeVarsToListIfUnique,
    applySolvedTypeVars,
    convertToInstance,
    doForEachSignature,
    doForEachSubtype,
    getTypeVarArgsRecursive,
    getTypeVarScopeId,
    getTypeVarScopeIds,
    isTupleClass,
    lookUpClassMember,
    mapSubtypes,
    selfSpecializeClass,
    specializeTupleClass,
} from './typeUtils';

// Fetches and binds the __new__ method from a class.
export function getBoundNewMethod(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    type: ClassType,
    diag: DiagnosticAddendum | undefined = undefined,
    additionalFlags = MemberAccessFlags.SkipObjectBaseClass
) {
    const flags =
        MemberAccessFlags.SkipClassMembers |
        MemberAccessFlags.SkipAttributeAccessOverride |
        MemberAccessFlags.TreatConstructorAsClassMethod |
        additionalFlags;

    return evaluator.getTypeOfBoundMember(errorNode, type, '__new__', { method: 'get' }, diag, flags);
}

// Fetches and binds the __init__ method from a class instance.
export function getBoundInitMethod(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    type: ClassType,
    diag: DiagnosticAddendum | undefined = undefined,
    additionalFlags = MemberAccessFlags.SkipObjectBaseClass
) {
    const flags =
        MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.SkipAttributeAccessOverride | additionalFlags;

    return evaluator.getTypeOfBoundMember(errorNode, type, '__init__', { method: 'get' }, diag, flags);
}

// Fetches and binds the __call__ method from a class or its metaclass.
export function getBoundCallMethod(evaluator: TypeEvaluator, errorNode: ExpressionNode, type: ClassType) {
    return evaluator.getTypeOfBoundMember(
        errorNode,
        type,
        '__call__',
        { method: 'get' },
        /* diag */ undefined,
        MemberAccessFlags.SkipInstanceMembers |
            MemberAccessFlags.SkipTypeBaseClass |
            MemberAccessFlags.SkipAttributeAccessOverride
    );
}

// Matches the arguments of a call to the constructor for a class.
// If successful, it returns the resulting (specialized) object type that
// is allocated by the constructor. If unsuccessful, it reports diagnostics.
export function validateConstructorArgs(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined
): CallResult {
    // If this is an unspecialized generic type alias, specialize it now
    // using default type argument values.
    const aliasInfo = type.props?.typeAliasInfo;
    if (aliasInfo?.shared.typeParams && !aliasInfo.typeArgs) {
        type = applySolvedTypeVars(type, new ConstraintSolution(), {
            replaceUnsolved: {
                scopeIds: [aliasInfo.shared.typeVarScopeId],
                tupleClassType: evaluator.getTupleClassType(),
            },
        }) as ClassType;
    }

    const metaclassResult = validateMetaclassCall(
        evaluator,
        errorNode,
        argList,
        type,
        skipUnknownArgCheck,
        inferenceContext,
        /* useSpeculativeModeForArgs */ true
    );

    if (metaclassResult) {
        const metaclassReturnType = metaclassResult.returnType ?? UnknownType.create();

        // If there a custom `__call__` method on the metaclass that returns
        // something other than an instance of the class, assume that it
        // overrides the normal `type.__call__` logic and don't perform the usual
        // __new__ and __init__ validation.
        if (metaclassResult.argumentErrors || shouldSkipNewAndInitEvaluation(evaluator, type, metaclassReturnType)) {
            validateMetaclassCall(
                evaluator,
                errorNode,
                argList,
                type,
                skipUnknownArgCheck,
                inferenceContext,
                /* useSpeculativeModeForArgs */ false
            );

            return metaclassResult;
        }
    }

    // Determine whether the class overrides the object.__new__ method.
    const newMethodDiag = new DiagnosticAddendum();
    const newMethodTypeResult = getBoundNewMethod(evaluator, errorNode, type, newMethodDiag);
    if (newMethodTypeResult?.typeErrors) {
        evaluator.addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, newMethodDiag.getString(), errorNode);
    }

    const useConstructorTransform = hasConstructorTransform(type);

    // If there is a constructor transform, evaluate all arguments speculatively
    // so we can later re-evaluate them in the context of the transform.
    const returnResult = evaluator.useSpeculativeMode(useConstructorTransform ? errorNode : undefined, () => {
        return validateNewAndInitMethods(
            evaluator,
            errorNode,
            argList,
            type,
            skipUnknownArgCheck,
            inferenceContext,
            newMethodTypeResult
        );
    });

    let validatedArgExpressions = !useConstructorTransform || returnResult.argumentErrors;

    // Apply a constructor transform if applicable.
    if (useConstructorTransform) {
        if (returnResult.argumentErrors) {
            // If there were errors when validating the __new__ and __init__ methods,
            // we need to re-evaluate the arguments to generate error messages because
            // we previously evaluated them speculatively.
            validateNewAndInitMethods(
                evaluator,
                errorNode,
                argList,
                type,
                skipUnknownArgCheck,
                inferenceContext,
                newMethodTypeResult
            );

            validatedArgExpressions = true;
        } else if (returnResult.returnType) {
            const transformed = applyConstructorTransform(evaluator, errorNode, argList, type, {
                argumentErrors: !!returnResult.argumentErrors,
                returnType: returnResult.returnType,
                isTypeIncomplete: !!returnResult.isTypeIncomplete,
            });

            if (transformed) {
                returnResult.returnType = transformed.returnType;

                if (transformed.isTypeIncomplete) {
                    returnResult.isTypeIncomplete = true;
                }

                if (transformed.argumentErrors) {
                    returnResult.argumentErrors = true;
                }

                validatedArgExpressions = true;
            }
        }
    }

    // If we weren't able to validate the args, analyze the expressions here
    // to mark symbols referenced and report expression evaluation errors.
    if (!validatedArgExpressions) {
        argList.forEach((arg) => {
            if (arg.valueExpression && !evaluator.isSpeculativeModeInUse(arg.valueExpression)) {
                evaluator.getTypeOfExpression(arg.valueExpression);
            }
        });
    }

    return returnResult;
}

function validateNewAndInitMethods(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    newMethodTypeResult: TypeResult | undefined
): CallResult {
    let returnType: Type | undefined;
    let validatedArgExpressions = false;
    let argumentErrors = false;
    let isTypeIncomplete = false;
    const overloadsUsedForCall: FunctionType[] = [];
    let newMethodReturnType: Type | undefined;

    // Validate __new__ if it is present.
    if (newMethodTypeResult) {
        // Use speculative mode for arg expressions because we don't know whether
        // we'll need to re-evaluate these expressions later for __init__.
        const newCallResult = validateNewMethod(
            evaluator,
            errorNode,
            argList,
            type,
            skipUnknownArgCheck,
            inferenceContext,
            newMethodTypeResult,
            /* useSpeculativeModeForArgs */ true
        );

        if (newCallResult.argumentErrors) {
            argumentErrors = true;
        } else {
            appendArray(overloadsUsedForCall, newCallResult.overloadsUsedForCall ?? []);
        }

        if (newCallResult.isTypeIncomplete) {
            isTypeIncomplete = true;
        }

        newMethodReturnType = newCallResult.returnType;
    }

    if (!newMethodReturnType || isDefaultNewMethod(newMethodTypeResult?.type)) {
        // If there is no __new__ method or it uses a default signature,
        // (cls, *args, **kwargs) -> Self, allow the __init__ method to
        // determine the specialized type of the class.
        newMethodReturnType = ClassType.cloneAsInstance(type);
    } else if (isAnyOrUnknown(newMethodReturnType)) {
        // If the __new__ method returns Any or Unknown, we'll ignore its return
        // type and assume that it returns Self.
        newMethodReturnType = applySolvedTypeVars(ClassType.cloneAsInstance(type), new ConstraintSolution(), {
            replaceUnsolved: {
                scopeIds: getTypeVarScopeIds(type),
                tupleClassType: evaluator.getTupleClassType(),
            },
        }) as ClassType;
    }

    let initMethodTypeResult: TypeResult | undefined;

    // If there were errors evaluating the __new__ method, assume that __new__
    // returns the class instance and proceed accordingly. This may produce
    // false positives in some cases, but it will prevent false negatives
    // if the __init__ method also produces type errors (perhaps unrelated
    // to the errors in the __new__ method).
    if (argumentErrors) {
        initMethodTypeResult = { type: convertToInstance(type) };
    }

    // Validate __init__ if it's present.
    if (
        !isNever(newMethodReturnType) &&
        !shouldSkipInitEvaluation(evaluator, type, newMethodReturnType) &&
        isClassInstance(newMethodReturnType)
    ) {
        // If the __new__ method returned the same type as the class it's constructing
        // but didn't supply solved type arguments, we'll ignore its specialized return
        // type and rely on the __init__ method to supply the type arguments instead.
        let initMethodBindToType = newMethodReturnType;
        if (
            initMethodBindToType.priv.typeArgs &&
            initMethodBindToType.priv.typeArgs.some((typeArg) => isUnknown(typeArg))
        ) {
            initMethodBindToType = ClassType.cloneAsInstance(type);
        }

        // Determine whether the class overrides the object.__init__ method.
        const initMethodDiag = new DiagnosticAddendum();
        initMethodTypeResult = getBoundInitMethod(evaluator, errorNode, initMethodBindToType, initMethodDiag);
        if (initMethodTypeResult?.typeErrors) {
            evaluator.addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, initMethodDiag.getString(), errorNode);
        }

        // Validate __init__ if it's present.
        if (initMethodTypeResult) {
            const initCallResult = validateInitMethod(
                evaluator,
                errorNode,
                argList,
                initMethodBindToType,
                skipUnknownArgCheck,
                inferenceContext,
                initMethodTypeResult.type
            );

            if (initCallResult.argumentErrors) {
                argumentErrors = true;
            } else if (initCallResult.overloadsUsedForCall) {
                overloadsUsedForCall.push(...initCallResult.overloadsUsedForCall);
            }

            if (initCallResult.isTypeIncomplete) {
                isTypeIncomplete = true;
            }

            returnType = initCallResult.returnType;
            validatedArgExpressions = true;
            skipUnknownArgCheck = true;
        }
    }

    if (!validatedArgExpressions && newMethodTypeResult) {
        // If we skipped the __init__ method and the __new__ method was evaluated only
        // speculatively, evaluate it non-speculatively now so we can report errors.
        if (!evaluator.isSpeculativeModeInUse(errorNode)) {
            validateNewMethod(
                evaluator,
                errorNode,
                argList,
                type,
                skipUnknownArgCheck,
                inferenceContext,
                newMethodTypeResult,
                /* useSpeculativeModeForArgs */ false
            );
        }

        validatedArgExpressions = true;
        returnType = newMethodReturnType;
    }

    // If the class doesn't override object.__new__ or object.__init__, use the
    // fallback constructor type evaluation for the `object` class.
    if (!newMethodTypeResult && !initMethodTypeResult) {
        const callResult = validateFallbackConstructorCall(evaluator, errorNode, argList, type, inferenceContext);

        if (callResult.argumentErrors) {
            argumentErrors = true;
        } else if (callResult.overloadsUsedForCall) {
            appendArray(overloadsUsedForCall, callResult.overloadsUsedForCall);
        }

        if (callResult.isTypeIncomplete) {
            isTypeIncomplete = true;
        }

        returnType = callResult.returnType ?? UnknownType.create();
    }

    return { argumentErrors, returnType, isTypeIncomplete, overloadsUsedForCall };
}

// Evaluates the __new__ method for type correctness. If useSpeculativeModeForArgs
// is true, use speculative mode to evaluate the arguments (unless an argument
// error is produced, in which case it's OK to use speculative mode).
function validateNewMethod(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    newMethodTypeResult: TypeResult,
    useSpeculativeModeForArgs: boolean
): CallResult {
    let newReturnType: Type | undefined;
    let isTypeIncomplete = false;
    let argumentErrors = false;
    const overloadsUsedForCall: FunctionType[] = [];

    const constraints = new ConstraintTracker();

    const callResult = evaluator.useSpeculativeMode(
        useSpeculativeModeForArgs ? errorNode : undefined,
        () => {
            return evaluator.validateCallArgs(
                errorNode,
                argList,
                newMethodTypeResult,
                constraints,
                skipUnknownArgCheck,
                inferenceContext
            );
        },
        { dependentType: newMethodTypeResult.type }
    );

    if (callResult.isTypeIncomplete) {
        isTypeIncomplete = true;
    }

    if (callResult.argumentErrors) {
        argumentErrors = true;

        // Evaluate the arguments in a non-speculative manner to generate any diagnostics.
        evaluator.validateCallArgs(
            errorNode,
            argList,
            newMethodTypeResult,
            constraints,
            skipUnknownArgCheck,
            inferenceContext
        );
    } else {
        newReturnType = callResult.returnType;

        if (overloadsUsedForCall.length === 0 && callResult.overloadsUsedForCall) {
            overloadsUsedForCall.push(...callResult.overloadsUsedForCall);
        }
    }

    if (newReturnType) {
        // Special-case the 'tuple' type specialization to use the homogenous
        // arbitrary-length form.
        if (isClassInstance(newReturnType) && isTupleClass(newReturnType) && !newReturnType.priv.tupleTypeArgs) {
            if (newReturnType.priv.typeArgs && newReturnType.priv.typeArgs.length === 1) {
                newReturnType = specializeTupleClass(newReturnType, [
                    { type: newReturnType.priv.typeArgs[0], isUnbounded: true },
                ]);
            }

            newReturnType = applyExpectedTypeForTupleConstructor(newReturnType, inferenceContext);
        }
    } else {
        newReturnType = applyExpectedTypeForConstructor(evaluator, type, inferenceContext, constraints);
    }

    return { argumentErrors, returnType: newReturnType, isTypeIncomplete, overloadsUsedForCall };
}

function validateInitMethod(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    initMethodType: Type
): CallResult {
    let isTypeIncomplete = false;
    let argumentErrors = false;
    const overloadsUsedForCall: FunctionType[] = [];

    const constraints = new ConstraintTracker();
    if (type.priv.typeArgs) {
        addConstraintsForExpectedType(evaluator, type, type, constraints, /* liveTypeVarScopes */ undefined);
    }

    const returnTypeOverride = selfSpecializeClass(type);
    const callResult = evaluator.validateCallArgs(
        errorNode,
        argList,
        { type: initMethodType },
        constraints,
        skipUnknownArgCheck,
        inferenceContext ? { ...inferenceContext, returnTypeOverride } : undefined
    );

    let adjustedClassType = type;
    if (
        callResult.specializedInitSelfType &&
        isClassInstance(callResult.specializedInitSelfType) &&
        ClassType.isSameGenericClass(callResult.specializedInitSelfType, adjustedClassType)
    ) {
        adjustedClassType = ClassType.cloneAsInstantiable(callResult.specializedInitSelfType);
    }

    const returnType = applyExpectedTypeForConstructor(
        evaluator,
        adjustedClassType,
        /* inferenceContext */ undefined,
        constraints
    );

    if (callResult.isTypeIncomplete) {
        isTypeIncomplete = true;
    }

    if (callResult.argumentErrors) {
        argumentErrors = true;
    } else if (callResult.overloadsUsedForCall) {
        overloadsUsedForCall.push(...callResult.overloadsUsedForCall);
    }

    return { argumentErrors, returnType, isTypeIncomplete, overloadsUsedForCall };
}

function validateFallbackConstructorCall(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    type: ClassType,
    inferenceContext: InferenceContext | undefined
): CallResult {
    // Bind the __new__ method from the object class.
    const newMethodType = getBoundNewMethod(
        evaluator,
        errorNode,
        type,
        /* diag */ undefined,
        /* additionalFlags */ MemberAccessFlags.Default
    )?.type;

    // If there was no object.__new__ or it's not a callable, then something has
    // gone terribly wrong in the typeshed stubs. To avoid crashing, simply
    // return the instance.
    if (!newMethodType || (!isFunction(newMethodType) && !isOverloaded(newMethodType))) {
        return { returnType: convertToInstance(type) };
    }

    return validateNewMethod(
        evaluator,
        errorNode,
        argList,
        type,
        /* skipUnknownArgCheck */ false,
        inferenceContext,
        { type: newMethodType },
        /* useSpeculativeModeForArgs */ false
    );
}

function validateMetaclassCall(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    useSpeculativeModeForArgs: boolean
): CallResult | undefined {
    const metaclassCallMethodInfo = getBoundCallMethod(evaluator, errorNode, type);

    if (!metaclassCallMethodInfo) {
        return undefined;
    }

    const callResult = evaluator.useSpeculativeMode(useSpeculativeModeForArgs ? errorNode : undefined, () => {
        return evaluator.validateCallArgs(
            errorNode,
            argList,
            metaclassCallMethodInfo,
            /* constraints */ undefined,
            skipUnknownArgCheck,
            inferenceContext
        );
    });

    if (!callResult.argumentErrors) {
        // If the return type is unannotated, don't use the inferred return type.
        const callType = metaclassCallMethodInfo.type;
        if (isFunction(callType) && !callType.shared.declaredReturnType) {
            return undefined;
        }

        // If the return type is unknown, ignore it.
        if (callResult.returnType && isUnknown(callResult.returnType)) {
            return undefined;
        }
    }

    return callResult;
}

function applyExpectedSubtypeForConstructor(
    evaluator: TypeEvaluator,
    type: ClassType,
    expectedSubtype: Type,
    constraints: ConstraintTracker
): Type | undefined {
    const specializedType = evaluator.solveAndApplyConstraints(ClassType.cloneAsInstance(type), constraints, {
        replaceUnsolved: {
            scopeIds: [],
            tupleClassType: evaluator.getTupleClassType(),
        },
    });

    if (!evaluator.assignType(expectedSubtype, specializedType)) {
        return undefined;
    }

    // If the expected type is "Any", transform it to an Any.
    if (isAny(expectedSubtype)) {
        return expectedSubtype;
    }

    return specializedType;
}

// Handles the case where a constructor is a generic type and the type
// arguments are not specified but can be provided by the expected type.
function applyExpectedTypeForConstructor(
    evaluator: TypeEvaluator,
    type: ClassType,
    inferenceContext: InferenceContext | undefined,
    constraints: ConstraintTracker
): Type {
    let defaultIfNotFound = true;

    // If this isn't a generic type or it's a type that has already been
    // explicitly specialized, the expected type isn't applicable.
    if (type.shared.typeParams.length === 0 || type.priv.typeArgs) {
        return evaluator.solveAndApplyConstraints(ClassType.cloneAsInstance(type), constraints, {
            replaceUnsolved: {
                scopeIds: [],
                tupleClassType: evaluator.getTupleClassType(),
            },
        });
    }

    if (inferenceContext) {
        const specializedExpectedType = mapSubtypes(inferenceContext.expectedType, (expectedSubtype) => {
            return applyExpectedSubtypeForConstructor(evaluator, type, expectedSubtype, constraints);
        });

        if (!isNever(specializedExpectedType)) {
            return specializedExpectedType;
        }

        // If the expected type didn't provide TypeVar values, remaining
        // unsolved TypeVars should be considered Unknown unless they were
        // provided explicitly in the constructor call.
        if (type.priv.typeArgs) {
            defaultIfNotFound = false;
        }
    }

    const specializedType = evaluator.solveAndApplyConstraints(type, constraints, {
        replaceUnsolved: defaultIfNotFound
            ? {
                  scopeIds: getTypeVarScopeIds(type),
                  tupleClassType: evaluator.getTupleClassType(),
              }
            : undefined,
    }) as ClassType;
    return ClassType.cloneAsInstance(specializedType);
}

// Similar to applyExpectedTypeForConstructor, this function handles the
// special case of the tuple class.
function applyExpectedTypeForTupleConstructor(type: ClassType, inferenceContext: InferenceContext | undefined) {
    let specializedType = type;

    if (
        inferenceContext &&
        isClassInstance(inferenceContext.expectedType) &&
        isTupleClass(inferenceContext.expectedType) &&
        inferenceContext.expectedType.priv.tupleTypeArgs
    ) {
        specializedType = specializeTupleClass(type, inferenceContext.expectedType.priv.tupleTypeArgs);
    }

    return specializedType;
}

// Synthesize a function that represents the constructor for this class
// taking into consideration the __init__ and __new__ methods.
export function createFunctionFromConstructor(
    evaluator: TypeEvaluator,
    classType: ClassType,
    selfType: ClassType | TypeVarType | undefined = undefined,
    recursionCount = 0
): Type | undefined {
    const fromMetaclassCall = createFunctionFromMetaclassCall(evaluator, classType, recursionCount);
    if (fromMetaclassCall) {
        return fromMetaclassCall;
    }

    let fromNew = createFunctionFromNewMethod(evaluator, classType, selfType, recursionCount);

    if (fromNew) {
        let skipInitMethod = false;

        doForEachSignature(fromNew, (signature) => {
            const newMethodReturnType = FunctionType.getEffectiveReturnType(signature);
            if (newMethodReturnType && shouldSkipInitEvaluation(evaluator, classType, newMethodReturnType)) {
                skipInitMethod = true;
            }
        });

        if (skipInitMethod) {
            return fromNew;
        }
    }

    const fromInit = createFunctionFromInitMethod(evaluator, classType, selfType, recursionCount);

    // If there is a valid __init__ method and the __new__ method
    // is the default __new__ method provided by the object class,
    // discard the __new__ method.
    if (fromInit && fromNew && isDefaultNewMethod(fromNew)) {
        fromNew = undefined;
    }

    // If there is both a __new__ and __init__ method, return a union
    // comprised of both resulting function types.
    if (fromNew && fromInit) {
        return combineTypes([fromInit, fromNew]);
    }

    if (fromNew || fromInit) {
        return fromNew ?? fromInit;
    }

    return fromNew ?? createFunctionFromObjectNewMethod(classType);
}

function createFunctionFromMetaclassCall(
    evaluator: TypeEvaluator,
    classType: ClassType,
    recursionCount: number
): FunctionType | OverloadedType | undefined {
    const metaclass = classType.shared.effectiveMetaclass;
    if (!metaclass || !isClass(metaclass)) {
        return undefined;
    }

    const callInfo = lookUpClassMember(
        metaclass,
        '__call__',
        MemberAccessFlags.SkipInstanceMembers |
            MemberAccessFlags.SkipTypeBaseClass |
            MemberAccessFlags.SkipAttributeAccessOverride
    );

    if (!callInfo) {
        return undefined;
    }

    const callType = evaluator.getTypeOfMember(callInfo);
    if (!isFunction(callType) && !isOverloaded(callType)) {
        return undefined;
    }

    const boundCallType = evaluator.bindFunctionToClassOrObject(
        classType,
        callType,
        callInfo && isInstantiableClass(callInfo.classType) ? callInfo.classType : undefined,
        /* treatConstructorAsClassMethod */ false,
        classType,
        /* diag */ undefined,
        recursionCount
    );

    if (!boundCallType) {
        return undefined;
    }

    let useMetaclassCall = false;

    // Look at the signatures of all the __call__ methods to determine whether
    // any of them returns something other than the instance of the class being
    // constructed.
    doForEachSignature(boundCallType, (signature) => {
        if (signature.shared.declaredReturnType) {
            const returnType = FunctionType.getEffectiveReturnType(signature);
            if (returnType && shouldSkipNewAndInitEvaluation(evaluator, classType, returnType)) {
                useMetaclassCall = true;
            }
        }
    });

    return useMetaclassCall ? boundCallType : undefined;
}

function createFunctionFromNewMethod(
    evaluator: TypeEvaluator,
    classType: ClassType,
    selfType: ClassType | TypeVarType | undefined,
    recursionCount: number
): FunctionType | OverloadedType | undefined {
    const newInfo = lookUpClassMember(
        classType,
        '__new__',
        MemberAccessFlags.SkipInstanceMembers |
            MemberAccessFlags.SkipAttributeAccessOverride |
            MemberAccessFlags.SkipObjectBaseClass
    );

    if (!newInfo) {
        return undefined;
    }

    const newType = evaluator.getTypeOfMember(newInfo);

    const convertNewToConstructor = (newSubtype: FunctionType) => {
        // If there are no parameters that include class-scoped type parameters,
        // self-specialize the class because the type arguments for the class
        // can't be solved if there are no parameters to supply them.
        const hasParamsWithTypeVars = newSubtype.shared.parameters.some((param, index) => {
            if (index === 0 || !param.name) {
                return false;
            }

            const paramType = FunctionType.getParamType(newSubtype, index);
            const typeVars = getTypeVarArgsRecursive(paramType);
            return typeVars.some((typeVar) => typeVar.priv.scopeId === getTypeVarScopeId(classType));
        });

        const boundNew = evaluator.bindFunctionToClassOrObject(
            hasParamsWithTypeVars ? selfSpecializeClass(classType) : classType,
            newSubtype,
            newInfo && isInstantiableClass(newInfo.classType) ? newInfo.classType : undefined,
            /* treatConstructorAsClassMethod */ true,
            selfType,
            /* diag */ undefined,
            recursionCount
        ) as FunctionType | undefined;

        if (!boundNew) {
            return undefined;
        }

        const convertedNew = FunctionType.clone(boundNew);
        convertedNew.shared.typeVarScopeId = newSubtype.shared.typeVarScopeId;

        if (!convertedNew.shared.docString && classType.shared.docString) {
            convertedNew.shared.docString = classType.shared.docString;
        }

        convertedNew.shared.flags &= ~(FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod);
        convertedNew.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);

        return convertedNew;
    };

    if (isFunction(newType)) {
        return convertNewToConstructor(newType);
    }

    if (!isOverloaded(newType)) {
        return undefined;
    }

    const newOverloads: FunctionType[] = [];
    OverloadedType.getOverloads(newType).forEach((overload) => {
        const converted = convertNewToConstructor(overload);
        if (converted) {
            newOverloads.push(converted);
        }
    });

    if (newOverloads.length === 0) {
        return undefined;
    }

    if (newOverloads.length === 1) {
        return newOverloads[0];
    }

    return OverloadedType.create(newOverloads);
}

function createFunctionFromObjectNewMethod(classType: ClassType) {
    // Return a fallback constructor based on the object.__new__ method.
    const constructorFunction = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.None);
    constructorFunction.shared.declaredReturnType = ClassType.cloneAsInstance(classType);

    // If this is type[T] or a protocol, we don't know what parameters are accepted
    // by the constructor, so add the default parameters.
    if (classType.priv.includeSubclasses || ClassType.isProtocolClass(classType)) {
        FunctionType.addDefaultParams(constructorFunction);
    }

    if (!constructorFunction.shared.docString && classType.shared.docString) {
        constructorFunction.shared.docString = classType.shared.docString;
    }

    return constructorFunction;
}

function createFunctionFromInitMethod(
    evaluator: TypeEvaluator,
    classType: ClassType,
    selfType: ClassType | TypeVarType | undefined,
    recursionCount: number
): FunctionType | OverloadedType | undefined {
    // Use the __init__ method if available. It's usually more detailed.
    const initInfo = lookUpClassMember(
        classType,
        '__init__',
        MemberAccessFlags.SkipInstanceMembers |
            MemberAccessFlags.SkipAttributeAccessOverride |
            MemberAccessFlags.SkipObjectBaseClass
    );

    if (!initInfo) {
        return undefined;
    }

    const initType = evaluator.getTypeOfMember(initInfo);
    const objectType = ClassType.cloneAsInstance(classType);

    function convertInitToConstructor(initSubtype: FunctionType) {
        const boundInit = evaluator.bindFunctionToClassOrObject(
            objectType,
            initSubtype,
            initInfo && isInstantiableClass(initInfo.classType) ? initInfo.classType : undefined,
            /* treatConstructorAsClassMethod */ undefined,
            selfType,
            /* diag */ undefined,
            recursionCount
        ) as FunctionType | undefined;

        if (!boundInit) {
            return undefined;
        }

        const convertedInit = FunctionType.clone(boundInit);
        let returnType = selfType;
        if (!returnType) {
            returnType = objectType;

            // If this is a generic type, self-specialize the class (i.e. fill in
            // its own type parameters as type arguments).
            if (objectType.shared.typeParams.length > 0 && !objectType.priv.typeArgs) {
                const constraints = new ConstraintTracker();

                // If a TypeVar is not used in any of the parameter types, it should take
                // on its default value (typically Unknown) in the resulting specialized type.
                const typeVarsInParams: TypeVarType[] = [];

                convertedInit.shared.parameters.forEach((param, index) => {
                    const paramType = FunctionType.getParamType(convertedInit, index);
                    addTypeVarsToListIfUnique(typeVarsInParams, getTypeVarArgsRecursive(paramType));
                });

                typeVarsInParams.forEach((typeVar) => {
                    constraints.setBounds(typeVar, typeVar);
                });

                returnType = evaluator.solveAndApplyConstraints(objectType, constraints, {
                    replaceUnsolved: {
                        scopeIds: getTypeVarScopeIds(objectType),
                        tupleClassType: evaluator.getTupleClassType(),
                    },
                }) as ClassType;
            }
        }

        convertedInit.shared.declaredReturnType = boundInit.priv.strippedFirstParamType ?? returnType;

        if (convertedInit.priv.specializedTypes) {
            convertedInit.priv.specializedTypes.returnType = returnType;
        }

        if (!convertedInit.shared.docString && classType.shared.docString) {
            convertedInit.shared.docString = classType.shared.docString;
        }

        convertedInit.shared.flags &= ~FunctionTypeFlags.StaticMethod;
        convertedInit.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);

        return convertedInit;
    }

    if (isFunction(initType)) {
        return convertInitToConstructor(initType);
    }

    if (!isOverloaded(initType)) {
        return undefined;
    }

    const initOverloads: FunctionType[] = [];
    OverloadedType.getOverloads(initType).forEach((overload) => {
        const converted = convertInitToConstructor(overload);
        if (converted) {
            initOverloads.push(converted);
        }
    });

    if (initOverloads.length === 0) {
        return undefined;
    }

    if (initOverloads.length === 1) {
        return initOverloads[0];
    }

    return OverloadedType.create(initOverloads);
}

// If the __call__ method returns a type that is not an instance of the class,
// skip the __new__ and __init__ method evaluation.
function shouldSkipNewAndInitEvaluation(
    evaluator: TypeEvaluator,
    classType: ClassType,
    callMethodReturnType: Type
): boolean {
    if (
        !evaluator.assignType(convertToInstance(classType), callMethodReturnType) ||
        isNever(callMethodReturnType) ||
        findSubtype(callMethodReturnType, (subtype) => isAny(subtype))
    ) {
        return true;
    }

    // Handle the special case of an enum class, where the __new__ and __init__
    // methods are replaced at runtime by the metaclass.
    if (ClassType.isEnumClass(classType)) {
        return true;
    }

    return false;
}

// If __new__ returns a type that is not an instance of the class, skip the
// __init__ method evaluation. This is consistent with the behavior of the
// type.__call__ runtime behavior.
function shouldSkipInitEvaluation(evaluator: TypeEvaluator, classType: ClassType, newMethodReturnType: Type): boolean {
    const returnType = evaluator.makeTopLevelTypeVarsConcrete(newMethodReturnType);

    let skipInitCheck = false;
    doForEachSubtype(returnType, (subtype) => {
        if (isUnknown(subtype)) {
            return;
        }

        if (isClassInstance(subtype)) {
            const inheritanceChain: InheritanceChain = [];
            const isDerivedFrom = ClassType.isDerivedFrom(
                ClassType.cloneAsInstantiable(subtype),
                classType,
                inheritanceChain
            );

            if (!isDerivedFrom) {
                skipInitCheck = true;
            }

            return;
        }

        skipInitCheck = true;
    });

    return skipInitCheck;
}

// Determine whether the __new__ method is the placeholder signature
// of "def __new__(cls, *args, **kwargs) -> Self".
function isDefaultNewMethod(newMethod?: Type): boolean {
    if (!newMethod || !isFunction(newMethod)) {
        return false;
    }

    const params = newMethod.shared.parameters;
    if (params.length !== 2) {
        return false;
    }

    if (params[0].category !== ParamCategory.ArgsList || params[1].category !== ParamCategory.KwargsDict) {
        return false;
    }

    const returnType = newMethod.shared.declaredReturnType ?? newMethod.priv.inferredReturnType;
    if (!returnType || !isTypeVar(returnType) || !TypeVarType.isSelf(returnType)) {
        return false;
    }

    return true;
}
