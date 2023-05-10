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

import { DiagnosticRule } from '../common/diagnosticRules';
import { Localizer } from '../localization/localize';
import { ExpressionNode } from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { populateTypeVarContextBasedOnExpectedType } from './constraintSolver';
import { applyConstructorTransform, hasConstructorTransform } from './constructorTransform';
import { getTypeVarScopesForNode } from './parseTreeUtils';
import { CallResult, FunctionArgument, MemberAccessFlags, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassMemberLookupFlags,
    InferenceContext,
    applySolvedTypeVars,
    buildTypeVarContextFromSpecializedClass,
    convertToInstance,
    getTypeVarScopeId,
    isPartlyUnknown,
    isTupleClass,
    lookUpClassMember,
    mapSubtypes,
    requiresSpecialization,
    specializeTupleClass,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';
import {
    ClassType,
    FunctionType,
    FunctionTypeFlags,
    OverloadedFunctionType,
    Type,
    UnknownType,
    isAny,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isOverloadedFunction,
    isUnknown,
} from './types';

// Matches the arguments of a call to the constructor for a class.
// If successful, it returns the resulting (specialized) object type that
// is allocated by the constructor. If unsuccessful, it reports diagnostics.
export function validateConstructorArguments(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    type: ClassType,
    skipUnknownArgCheck: boolean,
    inferenceContext: InferenceContext | undefined
): CallResult {
    // If there a custom `__call__` method on the metaclass, assume that it
    // overrides the normal `type.__call__` logic and don't perform the usual
    // __new__ and __init__ validation.
    const metaclassResult = validateMetaclassCall(
        evaluator,
        errorNode,
        argList,
        type,
        skipUnknownArgCheck,
        inferenceContext
    );
    if (metaclassResult) {
        return metaclassResult;
    }

    // Determine whether the class overrides the object.__new__ method.
    const newMethodInfo = evaluator.getTypeOfClassMemberName(
        errorNode,
        type,
        /* isAccessedThroughObject */ false,
        '__new__',
        { method: 'get' },
        /* diag */ undefined,
        MemberAccessFlags.AccessClassMembersOnly |
            MemberAccessFlags.SkipObjectBaseClass |
            MemberAccessFlags.TreatConstructorAsClassMethod,
        type
    );

    // Determine whether the class overrides the object.__init__ method.
    const initMethodInfo = evaluator.getTypeOfObjectMember(
        errorNode,
        ClassType.cloneAsInstance(type),
        '__init__',
        { method: 'get' },
        /* diag */ undefined,
        MemberAccessFlags.SkipObjectBaseClass | MemberAccessFlags.SkipAttributeAccessOverride
    );

    let returnType: Type | undefined;
    let validatedTypes = false;
    let argumentErrors = false;
    let isTypeIncomplete = false;
    const overloadsUsedForCall: FunctionType[] = [];

    // If the class doesn't override object.__new__ or object.__init__, use the
    // fallback constructor type evaluation for the `object` class.
    if (!newMethodInfo && !initMethodInfo) {
        const callResult = validateFallbackConstructorCall(evaluator, errorNode, argList, type, inferenceContext);

        if (callResult.argumentErrors) {
            argumentErrors = true;
        } else {
            overloadsUsedForCall.push(...callResult.overloadsUsedForCall);
        }

        returnType = callResult.returnType ?? UnknownType.create();
    } else {
        // Validate __init__
        // We validate __init__ before __new__ because the former typically has
        // more specific type annotations, and we want to evaluate the arguments
        // in the context of these types. The __new__ method often uses generic
        // vargs and kwargs.
        const initMethodType = initMethodInfo?.type;
        if (initMethodType && !shouldSkipConstructorCheck(initMethodType)) {
            // If there is an expected type, analyze the constructor call
            // for each of the subtypes that comprise the expected type. If
            // one or more analyzes with no errors, use those results.
            if (inferenceContext) {
                const expectedCallResult = validateConstructorMethodWithContext(
                    evaluator,
                    errorNode,
                    argList,
                    type,
                    skipUnknownArgCheck,
                    inferenceContext,
                    initMethodType
                );

                if (expectedCallResult && !expectedCallResult.argumentErrors) {
                    returnType = expectedCallResult.returnType;

                    if (expectedCallResult.isTypeIncomplete) {
                        isTypeIncomplete = true;
                    }
                }
            }

            if (!returnType) {
                const typeVarContext = type.typeArguments
                    ? buildTypeVarContextFromSpecializedClass(type, /* makeConcrete */ false)
                    : new TypeVarContext(getTypeVarScopeId(type));

                typeVarContext.addSolveForScope(getTypeVarScopeId(initMethodType));
                const callResult = evaluator.validateCallArguments(
                    errorNode,
                    argList,
                    { type: initMethodType },
                    typeVarContext,
                    skipUnknownArgCheck
                );

                let adjustedClassType = type;
                if (
                    callResult.specializedInitSelfType &&
                    isClassInstance(callResult.specializedInitSelfType) &&
                    ClassType.isSameGenericClass(callResult.specializedInitSelfType, type)
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
                } else {
                    overloadsUsedForCall.push(...callResult.overloadsUsedForCall);
                }
            }

            validatedTypes = true;
            skipUnknownArgCheck = true;
        }

        // Validate __new__
        // Don't report errors for __new__ if __init__ already generated errors. They're
        // probably going to be entirely redundant anyway.
        if (!argumentErrors && newMethodInfo && !shouldSkipConstructorCheck(newMethodInfo.type)) {
            const constructorMethodType = newMethodInfo.type;
            let newReturnType: Type | undefined;

            // If there is an expected type that was not applied above when
            // handling the __init__ method, try to apply it with the __new__ method.
            if (inferenceContext && !returnType) {
                const expectedCallResult = validateConstructorMethodWithContext(
                    evaluator,
                    errorNode,
                    argList,
                    type,
                    skipUnknownArgCheck,
                    inferenceContext,
                    constructorMethodType
                );

                if (expectedCallResult && !expectedCallResult.argumentErrors) {
                    newReturnType = expectedCallResult.returnType;
                    returnType = newReturnType;

                    if (expectedCallResult.isTypeIncomplete) {
                        isTypeIncomplete = true;
                    }
                }
            }

            const typeVarContext = new TypeVarContext(getTypeVarScopeId(type));

            if (type.typeAliasInfo) {
                typeVarContext.addSolveForScope(type.typeAliasInfo.typeVarScopeId);
            }

            typeVarContext.addSolveForScope(getTypeVarScopeId(constructorMethodType));

            // Use speculative mode if we're going to later apply a constructor transform.
            // This allows us to use bidirectional type inference for arguments in the transform.
            const callResult = evaluator.useSpeculativeMode(
                hasConstructorTransform(type) ? errorNode : undefined,
                () => {
                    return evaluator.validateCallArguments(
                        errorNode,
                        argList,
                        newMethodInfo!,
                        typeVarContext,
                        skipUnknownArgCheck
                    );
                }
            );

            if (callResult.isTypeIncomplete) {
                isTypeIncomplete = true;
            }

            if (callResult.argumentErrors) {
                argumentErrors = true;
            } else if (!newReturnType) {
                newReturnType = callResult.returnType;

                if (overloadsUsedForCall.length === 0) {
                    overloadsUsedForCall.push(...callResult.overloadsUsedForCall);
                }

                // If the constructor returned an object whose type matches the class of
                // the original type being constructed, use the return type in case it was
                // specialized. If it doesn't match, we'll fall back on the assumption that
                // the constructed type is an instance of the class type. We need to do this
                // in cases where we're inferring the return type based on a call to
                // super().__new__().
                if (newReturnType) {
                    if (isClassInstance(newReturnType) && ClassType.isSameGenericClass(newReturnType, type)) {
                        // If the specialized return type derived from the __init__
                        // method is "better" than the return type provided by the
                        // __new__ method (where "better" means that the type arguments
                        // are all known), stick with the __init__ result.
                        if (
                            (!isPartlyUnknown(newReturnType) && !requiresSpecialization(newReturnType)) ||
                            returnType === undefined
                        ) {
                            // Special-case the 'tuple' type specialization to use
                            // the homogenous arbitrary-length form.
                            if (
                                isClassInstance(newReturnType) &&
                                ClassType.isTupleClass(newReturnType) &&
                                !newReturnType.tupleTypeArguments &&
                                newReturnType.typeArguments &&
                                newReturnType.typeArguments.length === 1
                            ) {
                                newReturnType = specializeTupleClass(newReturnType, [
                                    { type: newReturnType.typeArguments[0], isUnbounded: true },
                                ]);
                            }

                            returnType = newReturnType;
                        }
                    } else if (!returnType && !isUnknown(newReturnType)) {
                        returnType = newReturnType;
                    }
                }
            }

            if (!returnType) {
                returnType = applyExpectedTypeForConstructor(evaluator, type, inferenceContext, typeVarContext);
            } else if (isClassInstance(returnType) && isTupleClass(returnType) && !returnType.tupleTypeArguments) {
                returnType = applyExpectedTypeForTupleConstructor(returnType, inferenceContext);
            }
            validatedTypes = true;
        }
    }

    // If we weren't able to validate the args, analyze the expressions here
    // to mark symbols referenced and report expression evaluation errors.
    if (!validatedTypes) {
        argList.forEach((arg) => {
            if (arg.valueExpression && !evaluator.isSpeculativeModeInUse(arg.valueExpression)) {
                evaluator.getTypeOfExpression(arg.valueExpression);
            }
        });
    }

    // Apply a constructor transform if applicable.
    if (!argumentErrors && returnType) {
        const transformed = applyConstructorTransform(evaluator, errorNode, argList, type, {
            argumentErrors,
            returnType,
            isTypeIncomplete,
        });

        returnType = transformed.returnType;

        if (transformed.isTypeIncomplete) {
            isTypeIncomplete = true;
        }

        if (transformed.argumentErrors) {
            argumentErrors = true;
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

    if (argList.length > 0) {
        const fileInfo = getFileInfo(errorNode);
        evaluator.addDiagnostic(
            fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            DiagnosticRule.reportGeneralTypeIssues,
            Localizer.Diagnostic.constructorNoArgs().format({ type: type.aliasName || type.details.name }),
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
        populateTypeVarContextBasedOnExpectedType(
            evaluator,
            ClassType.cloneAsInstance(type),
            inferenceContext.expectedType,
            typeVarContext,
            getTypeVarScopesForNode(errorNode)
        );
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
    skipUnknownArgCheck: boolean,
    inferenceContext: InferenceContext | undefined
): CallResult | undefined {
    const metaclass = type.details.effectiveMetaclass;

    if (metaclass && isInstantiableClass(metaclass) && !ClassType.isSameGenericClass(metaclass, type)) {
        const metaclassCallMethodInfo = evaluator.getTypeOfClassMemberName(
            errorNode,
            metaclass,
            /* isAccessedThroughObject */ true,
            '__call__',
            { method: 'get' },
            /* diag */ undefined,
            MemberAccessFlags.ConsiderMetaclassOnly |
                MemberAccessFlags.SkipTypeBaseClass |
                MemberAccessFlags.SkipAttributeAccessOverride,
            type
        );

        if (metaclassCallMethodInfo) {
            const callResult = evaluator.validateCallArguments(
                errorNode,
                argList,
                metaclassCallMethodInfo,
                /* typeVarContext */ undefined,
                skipUnknownArgCheck,
                inferenceContext
            );

            if (!callResult.returnType || isUnknown(callResult.returnType)) {
                // The return result isn't known. We'll assume in this case that
                // the metaclass __call__ method allocated a new instance of the
                // requested class.
                const typeVarContext = new TypeVarContext(getTypeVarScopeId(type));
                callResult.returnType = applyExpectedTypeForConstructor(
                    evaluator,
                    type,
                    inferenceContext,
                    typeVarContext
                );
            }

            return callResult;
        }
    }

    return undefined;
}

// For a constructor call that targets a generic class and an "expected type"
// (i.e. bidirectional inference), this function attempts to infer the correct
// specialized return type for the constructor.
function validateConstructorMethodWithContext(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: FunctionArgument[],
    type: ClassType,
    skipUnknownArgCheck: boolean,
    inferenceContext: InferenceContext,
    constructorMethodType: Type
): CallResult | undefined {
    let isTypeIncomplete = false;
    let argumentErrors = false;
    const overloadsUsedForCall: FunctionType[] = [];

    const returnType = mapSubtypes(inferenceContext.expectedType, (expectedSubType) => {
        expectedSubType = transformPossibleRecursiveTypeAlias(expectedSubType);

        const typeVarContext = new TypeVarContext(getTypeVarScopeId(type));
        typeVarContext.addSolveForScope(getTypeVarScopeId(constructorMethodType));

        if (
            populateTypeVarContextBasedOnExpectedType(
                evaluator,
                ClassType.cloneAsInstance(type),
                expectedSubType,
                typeVarContext,
                getTypeVarScopesForNode(errorNode)
            )
        ) {
            const specializedConstructor = applySolvedTypeVars(constructorMethodType, typeVarContext);

            let callResult: CallResult | undefined;
            evaluator.useSpeculativeMode(errorNode, () => {
                callResult = evaluator.validateCallArguments(
                    errorNode,
                    argList,
                    { type: specializedConstructor },
                    typeVarContext.clone(),
                    skipUnknownArgCheck
                );
            });

            if (!callResult!.argumentErrors) {
                // Call validateCallArguments again, this time without speculative
                // mode, so any errors are reported.
                callResult = evaluator.validateCallArguments(
                    errorNode,
                    argList,
                    { type: specializedConstructor },
                    typeVarContext,
                    skipUnknownArgCheck
                );

                if (callResult.isTypeIncomplete) {
                    isTypeIncomplete = true;
                }

                if (callResult.argumentErrors) {
                    argumentErrors = true;
                }

                overloadsUsedForCall.push(...callResult.overloadsUsedForCall);

                return applyExpectedSubtypeForConstructor(
                    evaluator,
                    type,
                    expectedSubType,
                    inferenceContext,
                    typeVarContext
                );
            }
        }

        return undefined;
    });

    if (isNever(returnType)) {
        return undefined;
    }

    return { returnType, isTypeIncomplete, argumentErrors, overloadsUsedForCall };
}

function applyExpectedSubtypeForConstructor(
    evaluator: TypeEvaluator,
    type: ClassType,
    expectedSubtype: Type,
    inferenceContext: InferenceContext,
    typeVarContext: TypeVarContext
): Type | undefined {
    const specializedType = applySolvedTypeVars(ClassType.cloneAsInstance(type), typeVarContext);

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

    if (inferenceContext) {
        const specializedExpectedType = mapSubtypes(inferenceContext.expectedType, (expectedSubtype) => {
            return applyExpectedSubtypeForConstructor(
                evaluator,
                type,
                expectedSubtype,
                inferenceContext,
                typeVarContext
            );
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
    recursionCount = 0
): FunctionType | OverloadedFunctionType | undefined {
    // Use the __init__ method if available. It's usually more detailed.
    const initInfo = lookUpClassMember(
        classType,
        '__init__',
        ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
    );

    if (initInfo) {
        const initType = evaluator.getTypeOfMember(initInfo);
        const objectType = ClassType.cloneAsInstance(classType);

        const convertInitToConstructor = (initSubtype: FunctionType) => {
            let constructorFunction = evaluator.bindFunctionToClassOrObject(
                objectType,
                initSubtype,
                /* memberClass */ undefined,
                /* errorNode */ undefined,
                recursionCount
            ) as FunctionType | undefined;

            if (constructorFunction) {
                constructorFunction = FunctionType.clone(constructorFunction);
                constructorFunction.details.declaredReturnType = objectType;

                if (constructorFunction.specializedTypes) {
                    constructorFunction.specializedTypes.returnType = objectType;
                }

                if (!constructorFunction.details.docString && classType.details.docString) {
                    constructorFunction.details.docString = classType.details.docString;
                }

                constructorFunction.details.flags &= ~FunctionTypeFlags.StaticMethod;
            }

            return constructorFunction;
        };

        if (isFunction(initType)) {
            return convertInitToConstructor(initType);
        } else if (isOverloadedFunction(initType)) {
            const initOverloads: FunctionType[] = [];
            initType.overloads.forEach((overload) => {
                const converted = convertInitToConstructor(overload);
                if (converted) {
                    initOverloads.push(converted);
                }
            });

            if (initOverloads.length === 0) {
                return undefined;
            } else if (initOverloads.length === 1) {
                return initOverloads[0];
            }

            return OverloadedFunctionType.create(initOverloads);
        }
    }

    // Fall back on the __new__ method if __init__ isn't available.
    const newInfo = lookUpClassMember(
        classType,
        '__new__',
        ClassMemberLookupFlags.SkipInstanceVariables | ClassMemberLookupFlags.SkipObjectBaseClass
    );

    if (newInfo) {
        const newType = evaluator.getTypeOfMember(newInfo);

        const convertNewToConstructor = (newSubtype: FunctionType) => {
            let constructorFunction = evaluator.bindFunctionToClassOrObject(
                classType,
                newSubtype,
                /* memberClass */ undefined,
                /* errorNode */ undefined,
                recursionCount,
                /* treatConstructorAsClassMember */ true
            ) as FunctionType | undefined;

            if (constructorFunction) {
                constructorFunction = FunctionType.clone(constructorFunction);

                if (!constructorFunction.details.docString && classType.details.docString) {
                    constructorFunction.details.docString = classType.details.docString;
                }

                constructorFunction.details.flags &= ~(
                    FunctionTypeFlags.StaticMethod | FunctionTypeFlags.ConstructorMethod
                );
            }

            return constructorFunction;
        };

        if (isFunction(newType)) {
            return convertNewToConstructor(newType);
        } else if (isOverloadedFunction(newType)) {
            const newOverloads: FunctionType[] = [];
            newType.overloads.forEach((overload) => {
                const converted = convertNewToConstructor(overload);
                if (converted) {
                    newOverloads.push(converted);
                }
            });

            if (newOverloads.length === 0) {
                return undefined;
            } else if (newOverloads.length === 1) {
                return newOverloads[0];
            }

            return OverloadedFunctionType.create(newOverloads);
        }
    }

    // Return a generic constructor.
    const constructorFunction = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.None);
    constructorFunction.details.declaredReturnType = ClassType.cloneAsInstance(classType);
    FunctionType.addDefaultParameters(constructorFunction);

    if (!constructorFunction.details.docString && classType.details.docString) {
        constructorFunction.details.docString = classType.details.docString;
    }

    return constructorFunction;
}

// Determines whether we should skip argument validation. This is required
// for certain synthesized constructor types, namely NamedTuples.
function shouldSkipConstructorCheck(type: Type) {
    return isFunction(type) && FunctionType.isSkipConstructorCheck(type);
}
