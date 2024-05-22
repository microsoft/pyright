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
import { LocMessage } from '../localization/localize';
import { ArgumentCategory, ExpressionNode, ParameterCategory } from '../parser/parseNodes';
import { populateTypeVarContextBasedOnExpectedType } from './constraintSolver';
import { applyConstructorTransform, hasConstructorTransform } from './constructorTransform';
import { getTypeVarScopesForNode } from './parseTreeUtils';
import { CallResult, FunctionArgument, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    InferenceContext,
    MemberAccessFlags,
    UniqueSignatureTracker,
    applySolvedTypeVars,
    buildTypeVarContextFromSpecializedClass,
    convertToInstance,
    doForEachSignature,
    doForEachSubtype,
    ensureFunctionSignaturesAreUnique,
    getTypeVarArgumentsRecursive,
    getTypeVarScopeId,
    isTupleClass,
    lookUpClassMember,
    mapSubtypes,
    selfSpecializeClass,
    specializeTupleClass,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';
import {
    ClassType,
    FunctionType,
    FunctionTypeFlags,
    InheritanceChain,
    OverloadedFunctionType,
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
    isOverloadedFunction,
    isTypeVar,
    isUnion,
    isUnknown,
} from './types';

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
export function validateConstructorArguments(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    signatureTracker: UniqueSignatureTracker | undefined
): CallResult {
    const metaclassResult = validateMetaclassCall(
        evaluator,
        errorNode,
        argList,
        type,
        skipUnknownArgCheck,
        inferenceContext,
        signatureTracker
    );

    if (metaclassResult) {
        const metaclassReturnType = metaclassResult.returnType ?? UnknownType.create();

        // If there a custom `__call__` method on the metaclass that returns
        // something other than an instance of the class, assume that it
        // overrides the normal `type.__call__` logic and don't perform the usual
        // __new__ and __init__ validation.
        if (metaclassResult.argumentErrors || shouldSkipNewAndInitEvaluation(evaluator, type, metaclassReturnType)) {
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
            signatureTracker,
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
                signatureTracker,
                newMethodTypeResult
            );

            validatedArgExpressions = true;
        } else if (returnResult.returnType) {
            const transformed = applyConstructorTransform(
                evaluator,
                errorNode,
                argList,
                type,
                {
                    argumentErrors: !!returnResult.argumentErrors,
                    returnType: returnResult.returnType,
                    isTypeIncomplete: !!returnResult.isTypeIncomplete,
                },
                signatureTracker
            );

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
    argList: FunctionArgument[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    signatureTracker: UniqueSignatureTracker | undefined,
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
            signatureTracker,
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
        newMethodReturnType = applySolvedTypeVars(
            ClassType.cloneAsInstance(type),
            new TypeVarContext(getTypeVarScopeId(type)),
            { unknownIfNotFound: true }
        ) as ClassType;
    }

    let initMethodTypeResult: TypeResult | undefined;

    // Validate __init__ if it's present. Skip if the __new__ method produced errors.
    if (
        !argumentErrors &&
        !isNever(newMethodReturnType) &&
        !shouldSkipInitEvaluation(evaluator, type, newMethodReturnType) &&
        isClassInstance(newMethodReturnType)
    ) {
        // If the __new__ method returned the same type as the class it's constructing
        // but didn't supply solved type arguments, we'll ignore its specialized return
        // type and rely on the __init__ method to supply the type arguments instead.
        let initMethodBindToType = newMethodReturnType;
        if (
            initMethodBindToType.typeArguments &&
            initMethodBindToType.typeArguments.some((typeArg) => isUnknown(typeArg))
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
                signatureTracker,
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
                signatureTracker,
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
    argList: FunctionArgument[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    signatureTracker: UniqueSignatureTracker | undefined,
    newMethodTypeResult: TypeResult,
    useSpeculativeModeForArgs: boolean
): CallResult {
    let newReturnType: Type | undefined;
    let isTypeIncomplete = false;
    let argumentErrors = false;
    const overloadsUsedForCall: FunctionType[] = [];

    if (signatureTracker) {
        newMethodTypeResult.type = ensureFunctionSignaturesAreUnique(
            newMethodTypeResult.type,
            signatureTracker,
            errorNode.start
        );
    }

    const typeVarContext = new TypeVarContext(getTypeVarScopeId(type));
    typeVarContext.addSolveForScope(getTypeVarScopeId(newMethodTypeResult.type));
    if (type.typeAliasInfo) {
        typeVarContext.addSolveForScope(type.typeAliasInfo.typeVarScopeId);
    }

    const callResult = evaluator.useSpeculativeMode(useSpeculativeModeForArgs ? errorNode : undefined, () => {
        return evaluator.validateCallArguments(
            errorNode,
            argList,
            newMethodTypeResult,
            typeVarContext,
            skipUnknownArgCheck,
            inferenceContext,
            signatureTracker
        );
    });

    if (callResult.isTypeIncomplete) {
        isTypeIncomplete = true;
    }

    if (callResult.argumentErrors) {
        argumentErrors = true;

        // Evaluate the arguments in a non-speculative manner to generate any diagnostics.
        typeVarContext.unlock();
        evaluator.validateCallArguments(
            errorNode,
            argList,
            newMethodTypeResult,
            typeVarContext,
            skipUnknownArgCheck,
            inferenceContext,
            signatureTracker
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
        if (isClassInstance(newReturnType) && isTupleClass(newReturnType) && !newReturnType.tupleTypeArguments) {
            if (newReturnType.typeArguments && newReturnType.typeArguments.length === 1) {
                newReturnType = specializeTupleClass(newReturnType, [
                    { type: newReturnType.typeArguments[0], isUnbounded: true },
                ]);
            }

            newReturnType = applyExpectedTypeForTupleConstructor(newReturnType, inferenceContext);
        }
    } else {
        newReturnType = applyExpectedTypeForConstructor(evaluator, type, inferenceContext, typeVarContext);
    }

    return { argumentErrors, returnType: newReturnType, isTypeIncomplete, overloadsUsedForCall };
}

function validateInitMethod(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    signatureTracker: UniqueSignatureTracker | undefined,
    initMethodType: Type
): CallResult {
    let returnType: Type | undefined;
    let isTypeIncomplete = false;
    let argumentErrors = false;
    const overloadsUsedForCall: FunctionType[] = [];

    if (signatureTracker) {
        initMethodType = ensureFunctionSignaturesAreUnique(initMethodType, signatureTracker, errorNode.start);
    }

    // If there is an expected type, analyze the __init__ call for each of the
    // subtypes that comprise the expected type. If one or more analyzes with no
    // errors, use those results. This requires special-case processing because
    // the __init__ method doesn't return the expected type. It always
    // returns None.
    if (inferenceContext) {
        let foundWorkingExpectedType = false;

        returnType = mapSubtypes(
            inferenceContext.expectedType,
            (expectedSubType) => {
                // If we've already successfully evaluated the __init__ method with
                // one expected type, ignore the remaining ones.
                if (foundWorkingExpectedType) {
                    return undefined;
                }

                expectedSubType = transformPossibleRecursiveTypeAlias(expectedSubType);

                // If the expected type is the same type as the class and the class
                // is already explicitly specialized, don't override the explicit
                // specialization.
                if (
                    isClassInstance(expectedSubType) &&
                    ClassType.isSameGenericClass(type, expectedSubType) &&
                    type.typeArguments
                ) {
                    return undefined;
                }

                const typeVarContext = new TypeVarContext(getTypeVarScopeId(type));
                typeVarContext.addSolveForScope(getTypeVarScopeId(initMethodType));

                if (
                    populateTypeVarContextBasedOnExpectedType(
                        evaluator,
                        ClassType.cloneAsInstance(type),
                        expectedSubType,
                        typeVarContext,
                        getTypeVarScopesForNode(errorNode),
                        errorNode.start
                    )
                ) {
                    const specializedConstructor = applySolvedTypeVars(initMethodType, typeVarContext);

                    let callResult: CallResult | undefined;
                    callResult = evaluator.useSpeculativeMode(errorNode, () => {
                        return evaluator.validateCallArguments(
                            errorNode,
                            argList,
                            { type: specializedConstructor },
                            typeVarContext.clone(),
                            skipUnknownArgCheck,
                            /* inferenceContext */ undefined,
                            signatureTracker
                        );
                    });

                    if (!callResult.argumentErrors) {
                        // Call validateCallArguments again, this time without speculative
                        // mode, so any errors are reported.
                        callResult = evaluator.validateCallArguments(
                            errorNode,
                            argList,
                            { type: specializedConstructor },
                            typeVarContext,
                            skipUnknownArgCheck,
                            /* inferenceContext */ undefined,
                            signatureTracker
                        );

                        if (callResult.isTypeIncomplete) {
                            isTypeIncomplete = true;
                        }

                        if (callResult.argumentErrors) {
                            argumentErrors = true;
                        }

                        if (callResult.overloadsUsedForCall) {
                            appendArray(overloadsUsedForCall, callResult.overloadsUsedForCall);
                        }

                        // Note that we've found an expected type that works.
                        foundWorkingExpectedType = true;

                        return applyExpectedSubtypeForConstructor(evaluator, type, expectedSubType, typeVarContext);
                    }
                }

                return undefined;
            },
            /* sortSubtypes */ true
        );

        if (isNever(returnType) || argumentErrors) {
            returnType = undefined;
        }
    }

    if (!returnType) {
        const typeVarContext = type.typeArguments
            ? buildTypeVarContextFromSpecializedClass(type)
            : new TypeVarContext(getTypeVarScopeId(type));

        typeVarContext.addSolveForScope(getTypeVarScopeId(initMethodType));
        const callResult = evaluator.validateCallArguments(
            errorNode,
            argList,
            { type: initMethodType },
            typeVarContext,
            skipUnknownArgCheck,
            /* inferenceContext */ undefined,
            signatureTracker
        );

        let adjustedClassType = type;
        if (
            callResult.specializedInitSelfType &&
            isClassInstance(callResult.specializedInitSelfType) &&
            ClassType.isSameGenericClass(callResult.specializedInitSelfType, adjustedClassType)
        ) {
            adjustedClassType = ClassType.cloneAsInstantiable(callResult.specializedInitSelfType);
        }

        returnType = applyExpectedTypeForConstructor(
            evaluator,
            adjustedClassType,
            /* inferenceContext */ undefined,
            typeVarContext
        );

        if (callResult.isTypeIncomplete) {
            isTypeIncomplete = true;
        }

        if (callResult.argumentErrors) {
            argumentErrors = true;
        } else if (callResult.overloadsUsedForCall) {
            overloadsUsedForCall.push(...callResult.overloadsUsedForCall);
        }
    }

    return { argumentErrors, returnType, isTypeIncomplete, overloadsUsedForCall };
}

function validateFallbackConstructorCall(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    type: ClassType,
    inferenceContext: InferenceContext | undefined
): CallResult {
    let reportedErrors = false;

    // It's OK if the argument list consists only of `*args` and `**kwargs`.
    if (argList.length > 0 && argList.some((arg) => arg.argumentCategory === ArgumentCategory.Simple)) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportCallIssue,
            LocMessage.constructorNoArgs().format({ type: type.aliasName || type.details.name }),
            errorNode
        );
        reportedErrors = true;
    }

    if (!inferenceContext && type.typeArguments) {
        // If there was no expected type but the type was already specialized,
        // assume that we're constructing an instance of the specialized type.
        return {
            argumentErrors: reportedErrors,
            overloadsUsedForCall: [],
            returnType: convertToInstance(type),
        };
    }

    // Do our best to specialize the instantiated class based on the expected
    // type if provided.
    const typeVarContext = new TypeVarContext(getTypeVarScopeId(type));

    if (inferenceContext) {
        let expectedType: Type | undefined = inferenceContext.expectedType;

        // If the expectedType is a union, try to pick one that is likely to
        // be the best choice.
        if (isUnion(expectedType)) {
            expectedType = findSubtype(expectedType, (subtype) => {
                if (isAnyOrUnknown(subtype) || isNever(subtype)) {
                    return false;
                }

                if (isClass(subtype) && evaluator.assignType(subtype, ClassType.cloneAsInstance(type))) {
                    return true;
                }

                return false;
            });
        }

        if (expectedType) {
            populateTypeVarContextBasedOnExpectedType(
                evaluator,
                ClassType.cloneAsInstance(type),
                expectedType,
                typeVarContext,
                getTypeVarScopesForNode(errorNode),
                errorNode.start
            );
        }
    }

    return {
        argumentErrors: reportedErrors,
        overloadsUsedForCall: [],
        returnType: applyExpectedTypeForConstructor(evaluator, type, inferenceContext, typeVarContext),
    };
}

function validateMetaclassCall(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    type: ClassType,
    skipUnknownArgCheck: boolean | undefined,
    inferenceContext: InferenceContext | undefined,
    signatureTracker: UniqueSignatureTracker | undefined
): CallResult | undefined {
    const metaclassCallMethodInfo = getBoundCallMethod(evaluator, errorNode, type);

    if (!metaclassCallMethodInfo) {
        return undefined;
    }

    const callResult = evaluator.validateCallArguments(
        errorNode,
        argList,
        metaclassCallMethodInfo,
        /* typeVarContext */ undefined,
        skipUnknownArgCheck,
        inferenceContext,
        signatureTracker
    );

    // If the return type is unannotated, don't use the inferred return type.
    const callType = metaclassCallMethodInfo.type;
    if (isFunction(callType) && !callType.details.declaredReturnType) {
        return undefined;
    }

    // If the return type is unknown, ignore it.
    if (callResult.returnType && isUnknown(callResult.returnType)) {
        return undefined;
    }

    return callResult;
}

function applyExpectedSubtypeForConstructor(
    evaluator: TypeEvaluator,
    type: ClassType,
    expectedSubtype: Type,
    typeVarContext: TypeVarContext
): Type | undefined {
    const specializedType = applySolvedTypeVars(ClassType.cloneAsInstance(type), typeVarContext, {
        applyInScopePlaceholders: true,
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
    typeVarContext: TypeVarContext
): Type {
    let unsolvedTypeVarsAreUnknown = true;

    // If this isn't a generic type or it's a type that has already been
    // explicitly specialized, the expected type isn't applicable.
    if (type.details.typeParameters.length === 0 || type.typeArguments) {
        return applySolvedTypeVars(ClassType.cloneAsInstance(type), typeVarContext, { applyInScopePlaceholders: true });
    }

    if (inferenceContext) {
        const specializedExpectedType = mapSubtypes(inferenceContext.expectedType, (expectedSubtype) => {
            return applyExpectedSubtypeForConstructor(evaluator, type, expectedSubtype, typeVarContext);
        });

        if (!isNever(specializedExpectedType)) {
            return specializedExpectedType;
        }

        // If the expected type didn't provide TypeVar values, remaining
        // unsolved TypeVars should be considered Unknown unless they were
        // provided explicitly in the constructor call.
        if (type.typeArguments) {
            unsolvedTypeVarsAreUnknown = false;
        }
    }

    const specializedType = applySolvedTypeVars(type, typeVarContext, {
        unknownIfNotFound: unsolvedTypeVarsAreUnknown,
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
        inferenceContext.expectedType.tupleTypeArguments
    ) {
        specializedType = specializeTupleClass(type, inferenceContext.expectedType.tupleTypeArguments);
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

    const fromNew = createFunctionFromNewMethod(evaluator, classType, selfType, recursionCount);

    if (fromNew) {
        let skipInitMethod = false;

        doForEachSignature(fromNew, (signature) => {
            const newMethodReturnType = FunctionType.getSpecializedReturnType(signature);
            if (newMethodReturnType && shouldSkipInitEvaluation(evaluator, classType, newMethodReturnType)) {
                skipInitMethod = true;
            }
        });

        if (skipInitMethod) {
            return fromNew;
        }
    }

    const fromInit = createFunctionFromInitMethod(evaluator, classType, selfType, recursionCount);

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
): FunctionType | OverloadedFunctionType | undefined {
    const metaclass = classType.details.effectiveMetaclass;
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
    if (!isFunction(callType) && !isOverloadedFunction(callType)) {
        return undefined;
    }

    const boundCallType = evaluator.bindFunctionToClassOrObject(
        classType,
        callType,
        callInfo && isInstantiableClass(callInfo.classType) ? callInfo.classType : undefined,
        /* treatConstructorAsClassMethod */ false,
        ClassType.cloneAsInstantiable(classType),
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
        if (signature.details.declaredReturnType) {
            const returnType = FunctionType.getSpecializedReturnType(signature);
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
): FunctionType | OverloadedFunctionType | undefined {
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
        const hasParametersWithTypeVars = newSubtype.details.parameters.some((param, index) => {
            if (index === 0 || !param.name) {
                return false;
            }

            const paramType = FunctionType.getEffectiveParameterType(newSubtype, index);
            const typeVars = getTypeVarArgumentsRecursive(paramType);
            return typeVars.some((typeVar) => typeVar.scopeId === getTypeVarScopeId(classType));
        });

        const boundNew = evaluator.bindFunctionToClassOrObject(
            hasParametersWithTypeVars ? selfSpecializeClass(classType) : classType,
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
        convertedNew.details.typeVarScopeId = newSubtype.details.typeVarScopeId;

        if (!convertedNew.details.docString && classType.details.docString) {
            convertedNew.details.docString = classType.details.docString;
        }

        convertedNew.details.flags &= ~(FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod);
        convertedNew.details.constructorTypeVarScopeId = getTypeVarScopeId(classType);

        return convertedNew;
    };

    if (isFunction(newType)) {
        return convertNewToConstructor(newType);
    }

    if (!isOverloadedFunction(newType)) {
        return undefined;
    }

    const newOverloads: FunctionType[] = [];
    newType.overloads.forEach((overload) => {
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

    return OverloadedFunctionType.create(newOverloads);
}

function createFunctionFromObjectNewMethod(classType: ClassType) {
    // Return a fallback constructor based on the object.__new__ method.
    const constructorFunction = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.None);
    constructorFunction.details.declaredReturnType = ClassType.cloneAsInstance(classType);

    // If this is type[T] or a protocol, we don't know what parameters are accepted
    // by the constructor, so add the default parameters.
    if (classType.includeSubclasses || ClassType.isProtocolClass(classType)) {
        FunctionType.addDefaultParameters(constructorFunction);
    }

    if (!constructorFunction.details.docString && classType.details.docString) {
        constructorFunction.details.docString = classType.details.docString;
    }

    return constructorFunction;
}

function createFunctionFromInitMethod(
    evaluator: TypeEvaluator,
    classType: ClassType,
    selfType: ClassType | TypeVarType | undefined,
    recursionCount: number
): FunctionType | OverloadedFunctionType | undefined {
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
        convertedInit.details.declaredReturnType = boundInit.strippedFirstParamType ?? selfType ?? objectType;
        convertedInit.details.name = '';
        convertedInit.details.fullName = '';

        if (convertedInit.specializedTypes) {
            convertedInit.specializedTypes.returnType = selfType ?? objectType;
        }

        if (!convertedInit.details.docString && classType.details.docString) {
            convertedInit.details.docString = classType.details.docString;
        }

        convertedInit.details.flags &= ~FunctionTypeFlags.StaticMethod;
        convertedInit.details.constructorTypeVarScopeId = getTypeVarScopeId(classType);

        return convertedInit;
    }

    if (isFunction(initType)) {
        return convertInitToConstructor(initType);
    }

    if (!isOverloadedFunction(initType)) {
        return undefined;
    }

    const initOverloads: FunctionType[] = [];
    initType.overloads.forEach((overload) => {
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

    return OverloadedFunctionType.create(initOverloads);
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
            const isDerivedFrom = ClassType.isDerivedFrom(subtype, classType, inheritanceChain);

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

    if (newMethod.details.paramSpec) {
        return false;
    }

    const params = newMethod.details.parameters;
    if (params.length !== 2) {
        return false;
    }

    if (params[0].category !== ParameterCategory.ArgsList || params[1].category !== ParameterCategory.KwargsDict) {
        return false;
    }

    const returnType = newMethod.details.declaredReturnType ?? newMethod.inferredReturnType;
    if (!returnType || !isTypeVar(returnType) || !returnType.details.isSynthesizedSelf) {
        return false;
    }

    return true;
}
