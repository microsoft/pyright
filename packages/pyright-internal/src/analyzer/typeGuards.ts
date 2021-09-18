/*
 * typeGuards.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides logic for narrowing types based on conditional
 * expressions. The logic handles both positive ("if") and
 * negative ("else") narrowing cases.
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { ArgumentCategory, ExpressionNode, ParameterCategory, ParseNodeType } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { getFileInfo } from './analyzerNodeInfo';
import { FlowCondition, FlowFlags } from './codeFlow';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { getTypedDictMembersForClass } from './typedDicts';
import { EvaluatorFlags, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isNever,
    isNone,
    isOverloadedFunction,
    isTypeSame,
    isTypeVar,
    NoneType,
    OverloadedFunctionType,
    Type,
    TypeBase,
    TypeCategory,
    TypeCondition,
    TypedDictEntry,
    TypeVarType,
    UnknownType,
} from './types';
import {
    addConditionToType,
    canBeFalsy,
    canBeTruthy,
    ClassMember,
    computeMroLinearization,
    convertToInstance,
    convertToInstantiable,
    doForEachSubtype,
    getTypeCondition,
    isLiteralType,
    isLiteralTypeOrUnion,
    isOpenEndedTupleClass,
    isTupleClass,
    lookUpClassMember,
    lookUpObjectMember,
    mapSubtypes,
    removeFalsinessFromType,
    removeTruthinessFromType,
    transformPossibleRecursiveTypeAlias,
} from './typeUtils';

export type TypeNarrowingCallback = (type: Type) => Type | undefined;

// Given a reference expression and a flow node, returns a callback that
// can be used to narrow the type described by the target expression.
// If the specified flow node is not associated with the target expression,
// it returns undefined.
export function getTypeNarrowingCallback(
    evaluator: TypeEvaluator,
    reference: ExpressionNode,
    flowNode: FlowCondition
): TypeNarrowingCallback | undefined {
    let testExpression = flowNode.expression;
    const isPositiveTest = !!(flowNode.flags & (FlowFlags.TrueCondition | FlowFlags.TrueNeverCondition));

    if (testExpression.nodeType === ParseNodeType.AssignmentExpression) {
        if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
            testExpression = testExpression.rightExpression;
        } else if (ParseTreeUtils.isMatchingExpression(reference, testExpression.name)) {
            testExpression = testExpression.name;
        }
    }

    if (testExpression.nodeType === ParseNodeType.BinaryOperation) {
        const isOrIsNotOperator =
            testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.IsNot;
        const equalsOrNotEqualsOperator =
            testExpression.operator === OperatorType.Equals || testExpression.operator === OperatorType.NotEquals;

        if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
            // Invert the "isPositiveTest" value if this is an "is not" operation.
            const adjIsPositiveTest =
                testExpression.operator === OperatorType.Is || testExpression.operator === OperatorType.Equals
                    ? isPositiveTest
                    : !isPositiveTest;

            // Look for "X is None", "X is not None", "X == None", and "X != None".
            // These are commonly-used patterns used in control flow.
            if (
                testExpression.rightExpression.nodeType === ParseNodeType.Constant &&
                testExpression.rightExpression.constType === KeywordType.None
            ) {
                // Allow the LHS to be either a simple expression or an assignment
                // expression that assigns to a simple name.
                let leftExpression = testExpression.leftExpression;
                if (leftExpression.nodeType === ParseNodeType.AssignmentExpression) {
                    leftExpression = leftExpression.name;
                }

                if (ParseTreeUtils.isMatchingExpression(reference, leftExpression)) {
                    // Narrow the type by filtering on "None".
                    return (type: Type) => {
                        const expandedType = mapSubtypes(type, (subtype) => {
                            return transformPossibleRecursiveTypeAlias(subtype);
                        });
                        return evaluator.mapSubtypesExpandTypeVars(
                            expandedType,
                            /* conditionFilter */ undefined,
                            (subtype, unexpandedSubtype) => {
                                if (isAnyOrUnknown(subtype)) {
                                    // We need to assume that "Any" is always both None and not None,
                                    // so it matches regardless of whether the test is positive or negative.
                                    return subtype;
                                }

                                // If this is a TypeVar that isn't constrained, use the unexpanded
                                // TypeVar. For all other cases (including constrained TypeVars),
                                // use the expanded subtype.
                                const adjustedSubtype =
                                    isTypeVar(unexpandedSubtype) && unexpandedSubtype.details.constraints.length === 0
                                        ? unexpandedSubtype
                                        : subtype;

                                // See if it's a match for object.
                                if (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'object')) {
                                    return adjIsPositiveTest ? NoneType.createInstance() : adjustedSubtype;
                                }

                                // See if it's a match for None.
                                if (isNone(subtype) === adjIsPositiveTest) {
                                    return adjustedSubtype;
                                }

                                return undefined;
                            }
                        );
                    };
                }
            }

            // Look for "type(X) is Y" or "type(X) is not Y".
            if (isOrIsNotOperator && testExpression.leftExpression.nodeType === ParseNodeType.Call) {
                const callType = evaluator.getTypeOfExpression(testExpression.leftExpression.leftExpression).type;
                if (
                    isInstantiableClass(callType) &&
                    ClassType.isBuiltIn(callType, 'type') &&
                    testExpression.leftExpression.arguments.length === 1 &&
                    testExpression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple
                ) {
                    const arg0Expr = testExpression.leftExpression.arguments[0].valueExpression;
                    if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                        const classType = evaluator.getTypeOfExpression(testExpression.rightExpression).type;

                        if (isInstantiableClass(classType)) {
                            return (type: Type) => {
                                return narrowTypeForTypeIs(type, classType, adjIsPositiveTest);
                            };
                        }
                    }
                }
            }

            // Look for "X is Y" or "X is not Y" where Y is a an enum or False or True.
            if (isOrIsNotOperator) {
                if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                    const rightType = evaluator.getTypeOfExpression(testExpression.rightExpression).type;
                    if (
                        isClassInstance(rightType) &&
                        (ClassType.isEnumClass(rightType) || ClassType.isBuiltIn(rightType, 'bool')) &&
                        rightType.literalValue !== undefined
                    ) {
                        return (type: Type) => {
                            return narrowTypeForLiteralComparison(
                                evaluator,
                                type,
                                rightType,
                                adjIsPositiveTest,
                                /* isIsOperator */ true
                            );
                        };
                    }
                }
            }

            if (equalsOrNotEqualsOperator) {
                // Look for X == <literal> or X != <literal>
                const adjIsPositiveTest =
                    testExpression.operator === OperatorType.Equals ? isPositiveTest : !isPositiveTest;

                if (ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                    const rightType = evaluator.getTypeOfExpression(testExpression.rightExpression).type;
                    if (isClassInstance(rightType) && rightType.literalValue !== undefined) {
                        return (type: Type) => {
                            return narrowTypeForLiteralComparison(
                                evaluator,
                                type,
                                rightType,
                                adjIsPositiveTest,
                                /* isIsOperator */ false
                            );
                        };
                    }
                }

                if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
                    const leftType = evaluator.getTypeOfExpression(testExpression.leftExpression).type;
                    if (isClassInstance(leftType) && leftType.literalValue !== undefined) {
                        return (type: Type) => {
                            return narrowTypeForLiteralComparison(
                                evaluator,
                                type,
                                leftType,
                                adjIsPositiveTest,
                                /* isIsOperator */ false
                            );
                        };
                    }
                }

                // Look for X.Y == <literal> or X.Y != <literal>
                if (
                    testExpression.leftExpression.nodeType === ParseNodeType.MemberAccess &&
                    ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.leftExpression)
                ) {
                    const rightType = evaluator.getTypeOfExpression(testExpression.rightExpression).type;
                    const memberName = testExpression.leftExpression.memberName;
                    if (isClassInstance(rightType) && rightType.literalValue !== undefined) {
                        return (type: Type) => {
                            return narrowTypeForDiscriminatedFieldComparison(
                                evaluator,
                                type,
                                memberName.value,
                                rightType,
                                adjIsPositiveTest
                            );
                        };
                    }
                }

                // Look for X[<literal>] == <literal> or X[<literal>] != <literal>
                if (
                    testExpression.leftExpression.nodeType === ParseNodeType.Index &&
                    testExpression.leftExpression.items.length === 1 &&
                    !testExpression.leftExpression.trailingComma &&
                    testExpression.leftExpression.items[0].argumentCategory === ArgumentCategory.Simple &&
                    ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression.baseExpression)
                ) {
                    const indexType = evaluator.getTypeOfExpression(
                        testExpression.leftExpression.items[0].valueExpression
                    ).type;

                    if (isClassInstance(indexType) && isLiteralType(indexType)) {
                        if (ClassType.isBuiltIn(indexType, 'str')) {
                            const rightType = evaluator.getTypeOfExpression(testExpression.rightExpression).type;
                            if (isClassInstance(rightType) && rightType.literalValue !== undefined) {
                                return (type: Type) => {
                                    return narrowTypeForDiscriminatedDictEntryComparison(
                                        evaluator,
                                        type,
                                        indexType,
                                        rightType,
                                        adjIsPositiveTest
                                    );
                                };
                            }
                        } else if (ClassType.isBuiltIn(indexType, 'int')) {
                            const rightType = evaluator.getTypeOfExpression(testExpression.rightExpression).type;
                            if (isClassInstance(rightType) && rightType.literalValue !== undefined) {
                                return (type: Type) => {
                                    return narrowTypeForDiscriminatedTupleComparison(
                                        evaluator,
                                        type,
                                        indexType,
                                        rightType,
                                        adjIsPositiveTest
                                    );
                                };
                            }
                        }
                    }
                }
            }
        }

        if (testExpression.operator === OperatorType.In) {
            // Look for "x in y" where y is one of several built-in types.
            if (isPositiveTest && ParseTreeUtils.isMatchingExpression(reference, testExpression.leftExpression)) {
                const rightType = evaluator.getTypeOfExpression(testExpression.rightExpression).type;
                return (type: Type) => {
                    return narrowTypeForContains(evaluator, type, rightType);
                };
            }
        }

        if (testExpression.operator === OperatorType.In || testExpression.operator === OperatorType.NotIn) {
            if (ParseTreeUtils.isMatchingExpression(reference, testExpression.rightExpression)) {
                // Look for <string literal> in y where y is a union that contains
                // one or more TypedDicts.
                const leftType = evaluator.getTypeOfExpression(testExpression.leftExpression).type;
                if (isClassInstance(leftType) && ClassType.isBuiltIn(leftType, 'str') && isLiteralType(leftType)) {
                    const adjIsPositiveTest =
                        testExpression.operator === OperatorType.In ? isPositiveTest : !isPositiveTest;
                    return (type: Type) => {
                        return narrowTypeForTypedDictKey(
                            evaluator,
                            type,
                            ClassType.cloneAsInstantiable(leftType),
                            adjIsPositiveTest
                        );
                    };
                }
            }
        }
    }

    if (testExpression.nodeType === ParseNodeType.Call) {
        if (testExpression.leftExpression.nodeType === ParseNodeType.Name) {
            // Look for "isinstance(X, Y)" or "issubclass(X, Y)".
            if (
                (testExpression.leftExpression.value === 'isinstance' ||
                    testExpression.leftExpression.value === 'issubclass') &&
                testExpression.arguments.length === 2
            ) {
                // Make sure the first parameter is a supported expression type
                // and the second parameter is a valid class type or a tuple
                // of valid class types.
                const isInstanceCheck = testExpression.leftExpression.value === 'isinstance';
                const arg0Expr = testExpression.arguments[0].valueExpression;
                const arg1Expr = testExpression.arguments[1].valueExpression;
                if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                    const arg1Type = evaluator.getTypeOfExpression(
                        arg1Expr,
                        undefined,
                        EvaluatorFlags.EvaluateStringLiteralAsType |
                            EvaluatorFlags.ParamSpecDisallowed |
                            EvaluatorFlags.TypeVarTupleDisallowed
                    ).type;
                    const classTypeList = getIsInstanceClassTypes(arg1Type);
                    if (classTypeList) {
                        return (type: Type) => {
                            const narrowedType = narrowTypeForIsInstance(
                                evaluator,
                                type,
                                classTypeList,
                                isInstanceCheck,
                                isPositiveTest,
                                /* allowIntersections */ false,
                                testExpression
                            );
                            if (!isNever(narrowedType)) {
                                return narrowedType;
                            }

                            // Try again with intersection types allowed.
                            return narrowTypeForIsInstance(
                                evaluator,
                                type,
                                classTypeList,
                                isInstanceCheck,
                                isPositiveTest,
                                /* allowIntersections */ true,
                                testExpression
                            );
                        };
                    }
                }
            } else if (testExpression.leftExpression.value === 'callable' && testExpression.arguments.length === 1) {
                const arg0Expr = testExpression.arguments[0].valueExpression;
                if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                    return (type: Type) => {
                        let narrowedType = narrowTypeForCallable(
                            evaluator,
                            type,
                            isPositiveTest,
                            testExpression,
                            /* allowIntersections */ false
                        );
                        if (isPositiveTest && isNever(narrowedType)) {
                            // Try again with intersections allowed.
                            narrowedType = narrowTypeForCallable(
                                evaluator,
                                type,
                                isPositiveTest,
                                testExpression,
                                /* allowIntersections */ true
                            );
                        }

                        return narrowedType;
                    };
                }
            }
        }

        if (testExpression.arguments.length >= 1) {
            const arg0Expr = testExpression.arguments[0].valueExpression;
            if (ParseTreeUtils.isMatchingExpression(reference, arg0Expr)) {
                const functionType = evaluator.getTypeOfExpression(testExpression.leftExpression).type;

                // Does this look like it's a custom type guard function?
                if (
                    isFunction(functionType) &&
                    functionType.details.declaredReturnType &&
                    isClassInstance(functionType.details.declaredReturnType) &&
                    ClassType.isBuiltIn(functionType.details.declaredReturnType, 'TypeGuard')
                ) {
                    // Evaluate the type guard call expression.
                    const functionReturnType = evaluator.getTypeOfExpression(testExpression).type;
                    if (
                        isClassInstance(functionReturnType) &&
                        ClassType.isBuiltIn(functionReturnType, 'bool') &&
                        functionReturnType.typeGuardType
                    ) {
                        return (type: Type) => {
                            return isPositiveTest ? functionReturnType.typeGuardType : type;
                        };
                    }
                }
            }
        }
    }

    if (ParseTreeUtils.isMatchingExpression(reference, testExpression)) {
        return (type: Type) => {
            // Narrow the type based on whether the subtype can be true or false.
            return mapSubtypes(type, (subtype) => {
                if (isPositiveTest) {
                    if (canBeTruthy(subtype)) {
                        return removeFalsinessFromType(subtype);
                    }
                } else {
                    if (canBeFalsy(subtype)) {
                        return removeTruthinessFromType(subtype);
                    }
                }
                return undefined;
            });
        };
    }

    return undefined;
}

// The "isinstance" and "issubclass" calls support two forms - a simple form
// that accepts a single class, and a more complex form that accepts a tuple
// of classes. This method determines which form and returns a list of classes
// or undefined.
function getIsInstanceClassTypes(argType: Type): (ClassType | TypeVarType | NoneType | FunctionType)[] | undefined {
    let foundNonClassType = false;
    const classTypeList: (ClassType | TypeVarType | NoneType | FunctionType)[] = [];

    // Create a helper function that returns a list of class types or
    // undefined if any of the types are not valid.
    const addClassTypesToList = (types: Type[]) => {
        types.forEach((subtype) => {
            if (isInstantiableClass(subtype) || (isTypeVar(subtype) && TypeBase.isInstantiable(subtype))) {
                classTypeList.push(subtype);
            } else if (isNone(subtype) && TypeBase.isInstantiable(subtype)) {
                classTypeList.push(subtype);
            } else if (
                isFunction(subtype) &&
                subtype.details.parameters.length === 2 &&
                subtype.details.parameters[0].category === ParameterCategory.VarArgList &&
                subtype.details.parameters[1].category === ParameterCategory.VarArgDictionary
            ) {
                classTypeList.push(subtype);
            } else {
                foundNonClassType = true;
            }
        });
    };

    doForEachSubtype(argType, (subtype) => {
        if (isClass(subtype) && TypeBase.isInstance(subtype) && isTupleClass(subtype)) {
            if (subtype.tupleTypeArguments) {
                addClassTypesToList(
                    isOpenEndedTupleClass(subtype) ? [subtype.tupleTypeArguments[0]] : subtype.tupleTypeArguments
                );
            }
        } else {
            addClassTypesToList([subtype]);
        }

        return undefined;
    });

    return foundNonClassType ? undefined : classTypeList;
}

// Attempts to narrow a type (make it more constrained) based on a
// call to isinstance or issubclass. For example, if the original
// type of expression "x" is "Mammal" and the test expression is
// "isinstance(x, Cow)", (assuming "Cow" is a subclass of "Mammal"),
// we can conclude that x must be constrained to "Cow".
function narrowTypeForIsInstance(
    evaluator: TypeEvaluator,
    type: Type,
    classTypeList: (ClassType | TypeVarType | NoneType | FunctionType)[],
    isInstanceCheck: boolean,
    isPositiveTest: boolean,
    allowIntersections: boolean,
    errorNode: ExpressionNode
): Type {
    const expandedTypes = mapSubtypes(type, (subtype) => {
        return transformPossibleRecursiveTypeAlias(subtype);
    });

    // Filters the varType by the parameters of the isinstance
    // and returns the list of types the varType could be after
    // applying the filter.
    const filterClassType = (
        varType: ClassType,
        unexpandedType: Type,
        constraints: TypeCondition[] | undefined,
        negativeFallbackType: Type
    ): Type[] => {
        const filteredTypes: Type[] = [];

        let foundSuperclass = false;
        let isClassRelationshipIndeterminate = false;

        for (const filterType of classTypeList) {
            const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);

            if (isInstantiableClass(concreteFilterType)) {
                // Handle the special case where the variable type is a TypedDict and
                // we're filtering against 'dict'. TypedDict isn't derived from dict,
                // but at runtime, isinstance returns True.
                const filterIsSuperclass =
                    !isTypeVar(filterType) &&
                    (ClassType.isDerivedFrom(varType, concreteFilterType) ||
                        (isInstanceCheck &&
                            ClassType.isProtocolClass(concreteFilterType) &&
                            evaluator.canAssignType(concreteFilterType, varType, new DiagnosticAddendum())) ||
                        (ClassType.isBuiltIn(concreteFilterType, 'dict') && ClassType.isTypedDictClass(varType)));
                const filterIsSubclass =
                    ClassType.isDerivedFrom(concreteFilterType, varType) ||
                    (isInstanceCheck &&
                        ClassType.isProtocolClass(varType) &&
                        evaluator.canAssignType(varType, concreteFilterType, new DiagnosticAddendum()));

                if (filterIsSuperclass) {
                    foundSuperclass = true;
                }

                // Normally, a type should never be both a subclass or a superclass.
                // This can happen if either of the class types derives from a
                // class whose type is unknown (e.g. an import failed). We'll
                // note this case specially so we don't do any narrowing, which
                // will generate false positives.
                if (
                    filterIsSubclass &&
                    filterIsSuperclass &&
                    !ClassType.isSameGenericClass(varType, concreteFilterType)
                ) {
                    isClassRelationshipIndeterminate = true;
                }

                if (isPositiveTest) {
                    if (filterIsSuperclass) {
                        // If the variable type is a subclass of the isinstance filter,
                        // we haven't learned anything new about the variable type.
                        filteredTypes.push(addConditionToType(varType, constraints));
                    } else if (filterIsSubclass) {
                        // If the variable type is a superclass of the isinstance
                        // filter, we can narrow the type to the subclass.
                        filteredTypes.push(addConditionToType(filterType, constraints));
                    } else if (allowIntersections) {
                        // The two types appear to have no relation. It's possible that the
                        // two types are protocols or the program is expecting one type to
                        // be a mix-in class used with the other. In this case, we'll
                        // synthesize a new class type that represents an intersection of
                        // the two types.
                        const className = `<subclass of ${varType.details.name} and ${concreteFilterType.details.name}>`;
                        const fileInfo = getFileInfo(errorNode);
                        const newClassType = ClassType.createInstantiable(
                            className,
                            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
                            fileInfo.moduleName,
                            fileInfo.filePath,
                            ClassTypeFlags.None,
                            ParseTreeUtils.getTypeSourceId(errorNode),
                            /* declaredMetaclass */ undefined,
                            varType.details.effectiveMetaclass,
                            varType.details.docString
                        );
                        newClassType.details.baseClasses = [ClassType.cloneAsInstantiable(varType), concreteFilterType];
                        computeMroLinearization(newClassType);

                        filteredTypes.push(isInstanceCheck ? ClassType.cloneAsInstance(newClassType) : newClassType);
                    }
                }
            } else if (isTypeVar(filterType) && TypeBase.isInstantiable(filterType)) {
                // Handle the case where the filter type is Type[T] and the unexpanded
                // subtype is some instance type, possibly T.
                if (isInstanceCheck && TypeBase.isInstance(unexpandedType)) {
                    if (isTypeVar(unexpandedType) && isTypeSame(convertToInstance(filterType), unexpandedType)) {
                        // If the unexpanded subtype is T, we can definitively filter
                        // in both the positive and negative cases.
                        if (isPositiveTest) {
                            filteredTypes.push(unexpandedType);
                        }
                    } else {
                        if (isPositiveTest) {
                            filteredTypes.push(convertToInstance(filterType));
                        } else {
                            // If the unexpanded subtype is some other instance, we can't
                            // filter anything because it might be an instance.
                            filteredTypes.push(unexpandedType);
                            isClassRelationshipIndeterminate = true;
                        }
                    }
                } else if (!isInstanceCheck && TypeBase.isInstantiable(unexpandedType)) {
                    if (isTypeVar(unexpandedType) && isTypeSame(filterType, unexpandedType)) {
                        if (isPositiveTest) {
                            filteredTypes.push(unexpandedType);
                        }
                    } else {
                        if (isPositiveTest) {
                            filteredTypes.push(filterType);
                        } else {
                            filteredTypes.push(unexpandedType);
                            isClassRelationshipIndeterminate = true;
                        }
                    }
                }
            } else if (isFunction(filterType)) {
                // Handle an isinstance check against Callable.
                if (isInstanceCheck) {
                    let isCallable = false;

                    if (isClass(varType)) {
                        if (TypeBase.isInstantiable(unexpandedType)) {
                            isCallable = true;
                        } else {
                            isCallable = !!lookUpClassMember(varType, '__call__');
                        }
                    }

                    if (isCallable) {
                        if (isPositiveTest) {
                            filteredTypes.push(unexpandedType);
                        } else {
                            foundSuperclass = true;
                        }
                    }
                }
            }
        }

        // In the negative case, if one or more of the filters
        // always match the type (i.e. they are an exact match or
        // a superclass of the type), then there's nothing left after
        // the filter is applied. If we didn't find any superclass
        // match, then the original variable type survives the filter.
        if (!isPositiveTest) {
            if (!foundSuperclass || isClassRelationshipIndeterminate) {
                filteredTypes.push(negativeFallbackType);
            }
        }

        if (!isInstanceCheck) {
            return filteredTypes;
        }

        return filteredTypes.map((t) => convertToInstance(t));
    };

    const filterFunctionType = (varType: FunctionType | OverloadedFunctionType, unexpandedType: Type): Type[] => {
        const filteredTypes: Type[] = [];

        if (isPositiveTest) {
            for (const filterType of classTypeList) {
                const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);

                if (evaluator.canAssignType(varType, convertToInstance(concreteFilterType), new DiagnosticAddendum())) {
                    // If the filter type is a Callable, use the original type. If the
                    // filter type is a callback protocol, use the filter type.
                    if (isFunction(filterType)) {
                        filteredTypes.push(unexpandedType);
                    } else {
                        filteredTypes.push(convertToInstance(filterType));
                    }
                }
            }
        } else if (
            !classTypeList.some((filterType) =>
                evaluator.canAssignType(
                    varType,
                    convertToInstance(evaluator.makeTopLevelTypeVarsConcrete(filterType)),
                    new DiagnosticAddendum()
                )
            )
        ) {
            filteredTypes.push(unexpandedType);
        }

        return filteredTypes;
    };

    const anyOrUnknownSubstitutions: Type[] = [];
    const anyOrUnknown: Type[] = [];

    const filteredType = evaluator.mapSubtypesExpandTypeVars(
        expandedTypes,
        /* conditionFilter */ undefined,
        (subtype, unexpandedSubtype) => {
            // If we fail to filter anything in the negative case, we need to decide
            // whether to retain the original TypeVar or replace it with its specialized
            // type(s). We'll assume that if someone is using isinstance or issubclass
            // on a constrained TypeVar that they want to filter based on its constrained
            // parts.
            const negativeFallback = getTypeCondition(subtype) ? subtype : unexpandedSubtype;
            const isSubtypeTypeObject = isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'type');

            if (isPositiveTest && isAnyOrUnknown(subtype)) {
                // If this is a positive test and the effective type is Any or
                // Unknown, we can assume that the type matches one of the
                // specified types.
                if (isInstanceCheck) {
                    anyOrUnknownSubstitutions.push(
                        combineTypes(classTypeList.map((classType) => convertToInstance(classType)))
                    );
                } else {
                    anyOrUnknownSubstitutions.push(combineTypes(classTypeList));
                }

                anyOrUnknown.push(subtype);
                return undefined;
            }

            if (isInstanceCheck) {
                if (isNone(subtype)) {
                    const containsNoneType = classTypeList.some((t) => isNone(t) && TypeBase.isInstantiable(t));
                    if (isPositiveTest) {
                        return containsNoneType ? subtype : undefined;
                    } else {
                        return containsNoneType ? undefined : subtype;
                    }
                }

                if (isModule(subtype) || (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'ModuleType'))) {
                    // Handle type narrowing for runtime-checkable protocols
                    // when applied to modules.
                    if (isPositiveTest) {
                        const filteredTypes = classTypeList.filter((classType) => {
                            const concreteClassType = evaluator.makeTopLevelTypeVarsConcrete(classType);
                            return (
                                isInstantiableClass(concreteClassType) && ClassType.isProtocolClass(concreteClassType)
                            );
                        });

                        if (filteredTypes.length > 0) {
                            return convertToInstance(combineTypes(filteredTypes));
                        }
                    }
                }

                if (isClassInstance(subtype) && !isSubtypeTypeObject) {
                    return combineTypes(
                        filterClassType(
                            ClassType.cloneAsInstantiable(subtype),
                            convertToInstance(unexpandedSubtype),
                            getTypeCondition(subtype),
                            negativeFallback
                        )
                    );
                }

                if ((isFunction(subtype) || isOverloadedFunction(subtype)) && isInstanceCheck) {
                    return combineTypes(filterFunctionType(subtype, convertToInstance(unexpandedSubtype)));
                }

                if (isInstantiableClass(subtype) || isSubtypeTypeObject) {
                    // Handle the special case of isinstance(x, type).
                    const includesTypeType = classTypeList.some(
                        (classType) => isInstantiableClass(classType) && ClassType.isBuiltIn(classType, 'type')
                    );
                    if (isPositiveTest) {
                        return includesTypeType ? negativeFallback : undefined;
                    } else {
                        return includesTypeType ? undefined : negativeFallback;
                    }
                }
            } else {
                if (isInstantiableClass(subtype)) {
                    return combineTypes(
                        filterClassType(subtype, unexpandedSubtype, getTypeCondition(subtype), negativeFallback)
                    );
                }

                if (isSubtypeTypeObject) {
                    const objectType = evaluator.getBuiltInObject(errorNode, 'object');
                    if (objectType && isClassInstance(objectType)) {
                        return combineTypes(
                            filterClassType(
                                ClassType.cloneAsInstantiable(objectType),
                                convertToInstantiable(unexpandedSubtype),
                                getTypeCondition(subtype),
                                negativeFallback
                            )
                        );
                    }
                }
            }

            return isPositiveTest ? undefined : negativeFallback;
        }
    );

    // If the result is Any/Unknown and contains no other subtypes and
    // we have substitutions for Any/Unknown, use those instead. We don't
    // want to apply this if the filtering produced something other than
    // Any/Unknown. For example, if the statement is "isinstance(x, list)"
    // and the type of x is "List[str] | int | Any", the result should be
    // "List[str]", not "List[str] | List[Unknown]".
    if (isNever(filteredType) && anyOrUnknownSubstitutions.length > 0) {
        return combineTypes(anyOrUnknownSubstitutions);
    }

    if (anyOrUnknown.length > 0) {
        return combineTypes([filteredType, ...anyOrUnknown]);
    }

    return filteredType;
}

// Attempts to narrow a type (make it more constrained) based on an "in" or
// "not in" binary expression.
function narrowTypeForContains(evaluator: TypeEvaluator, referenceType: Type, containerType: Type) {
    // We support contains narrowing only for certain built-in types that have been specialized.
    if (!isClassInstance(containerType) || !ClassType.isBuiltIn(containerType)) {
        return referenceType;
    }

    const builtInName = containerType.details.name;

    if (!['list', 'set', 'frozenset', 'deque'].some((name) => name === builtInName)) {
        return referenceType;
    }

    if (!containerType.typeArguments || containerType.typeArguments.length !== 1) {
        return referenceType;
    }

    const typeArg = containerType.typeArguments[0];
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        if (isAnyOrUnknown(subtype)) {
            canNarrow = false;
            return subtype;
        }

        if (!evaluator.canAssignType(typeArg, subtype, new DiagnosticAddendum())) {
            // If the reference type isn't assignable to the element type, we will
            // assume that the __contains__ method will return false.
            return undefined;
        }

        return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
}

// Attempts to narrow a type based on whether it is a TypedDict with
// a literal key value.
function narrowTypeForTypedDictKey(
    evaluator: TypeEvaluator,
    referenceType: Type,
    literalKey: ClassType,
    isPositiveTest: boolean
): Type {
    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
            const entries = getTypedDictMembersForClass(evaluator, subtype, /* allowNarrowed */ true);
            const tdEntry = entries.get(literalKey.literalValue as string);

            if (isPositiveTest) {
                if (!tdEntry) {
                    // If the class is final, we can say with certainty that if
                    // the TypedDict doesn't define this entry, it is not this type.
                    // If it's not final, we can't say this because it could be a
                    // subclass of this TypedDict that adds more fields.
                    return ClassType.isFinal(subtype) ? undefined : subtype;
                }

                // If the entry is currently not required and not marked provided, we can mark
                // it as provided after this guard expression confirms it is.
                if (tdEntry.isRequired || tdEntry.isProvided) {
                    return subtype;
                }

                const oldNarrowedEntriesMap = subtype.typedDictNarrowedEntries;
                const newNarrowedEntriesMap = new Map<string, TypedDictEntry>();
                if (oldNarrowedEntriesMap) {
                    // Copy the old entries.
                    oldNarrowedEntriesMap.forEach((value, key) => {
                        newNarrowedEntriesMap.set(key, value);
                    });
                }

                // Add the new entry.
                newNarrowedEntriesMap.set(literalKey.literalValue as string, {
                    valueType: tdEntry.valueType,
                    isRequired: false,
                    isProvided: true,
                });

                // Clone the TypedDict object with the new entries.
                return ClassType.cloneAsInstance(
                    ClassType.cloneForNarrowedTypedDictEntries(
                        ClassType.cloneAsInstantiable(subtype),
                        newNarrowedEntriesMap
                    )
                );
            } else {
                return tdEntry !== undefined && (tdEntry.isRequired || tdEntry.isProvided) ? undefined : subtype;
            }
        }

        return subtype;
    });

    return narrowedType;
}

// Attempts to narrow a TypedDict type based on a comparison (equal or not
// equal) between a discriminating entry type that has a declared literal
// type to a literal value.
function narrowTypeForDiscriminatedDictEntryComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    indexLiteralType: ClassType,
    literalType: ClassType,
    isPositiveTest: boolean
): Type {
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
            const symbolMap = getTypedDictMembersForClass(evaluator, subtype);
            const tdEntry = symbolMap.get(indexLiteralType.literalValue as string);

            if (tdEntry && isLiteralTypeOrUnion(tdEntry.valueType)) {
                if (isPositiveTest) {
                    return evaluator.canAssignType(tdEntry.valueType, literalType, new DiagnosticAddendum())
                        ? subtype
                        : undefined;
                } else {
                    return evaluator.canAssignType(literalType, tdEntry.valueType, new DiagnosticAddendum())
                        ? undefined
                        : subtype;
                }
            }
        }

        canNarrow = false;
        return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
}

function narrowTypeForDiscriminatedTupleComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    indexLiteralType: ClassType,
    literalType: ClassType,
    isPositiveTest: boolean
): Type {
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        if (isClassInstance(subtype) && ClassType.isTupleClass(subtype) && !isOpenEndedTupleClass(subtype)) {
            const indexValue = indexLiteralType.literalValue as number;
            if (subtype.tupleTypeArguments && indexValue >= 0 && indexValue < subtype.tupleTypeArguments.length) {
                const tupleEntryType = subtype.tupleTypeArguments[indexValue];
                if (tupleEntryType && isLiteralTypeOrUnion(tupleEntryType)) {
                    if (isPositiveTest) {
                        return evaluator.canAssignType(tupleEntryType, literalType, new DiagnosticAddendum())
                            ? subtype
                            : undefined;
                    } else {
                        return evaluator.canAssignType(literalType, tupleEntryType, new DiagnosticAddendum())
                            ? undefined
                            : subtype;
                    }
                }
            }
        }

        canNarrow = false;
        return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
}

// Attempts to narrow a type based on a comparison (equal or not equal)
// between a discriminating field that has a declared literal type to a
// literal value.
function narrowTypeForDiscriminatedFieldComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    memberName: string,
    literalType: ClassType,
    isPositiveTest: boolean
): Type {
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        let memberInfo: ClassMember | undefined;
        if (isClassInstance(subtype)) {
            memberInfo = lookUpObjectMember(subtype, memberName);
        } else if (isInstantiableClass(subtype)) {
            memberInfo = lookUpClassMember(subtype, memberName);
        }

        if (memberInfo && memberInfo.isTypeDeclared) {
            const memberType = evaluator.getTypeOfMember(memberInfo);

            if (isLiteralTypeOrUnion(memberType)) {
                if (isPositiveTest) {
                    return evaluator.canAssignType(memberType, literalType, new DiagnosticAddendum())
                        ? subtype
                        : undefined;
                } else {
                    return evaluator.canAssignType(literalType, memberType, new DiagnosticAddendum())
                        ? undefined
                        : subtype;
                }
            }
        }

        canNarrow = false;
        return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
}

// Attempts to narrow a type based on a "type(x) is y" or "type(x) is not y" check.
function narrowTypeForTypeIs(type: Type, classType: ClassType, isPositiveTest: boolean) {
    return mapSubtypes(type, (subtype) => {
        if (isClassInstance(subtype)) {
            const matches = ClassType.isDerivedFrom(classType, ClassType.cloneAsInstantiable(subtype));
            if (isPositiveTest) {
                if (matches) {
                    if (ClassType.isSameGenericClass(subtype, classType)) {
                        return subtype;
                    }
                    return ClassType.cloneAsInstance(classType);
                }
                return undefined;
            } else {
                // If the class if marked final and it matches, then
                // we can eliminate it in the negative case.
                if (matches && ClassType.isFinal(subtype)) {
                    return undefined;
                }

                // We can't eliminate the subtype in the negative
                // case because it could be a subclass of the type,
                // in which case `type(x) is y` would fail.
                return subtype;
            }
        } else if (isNone(subtype)) {
            return isPositiveTest ? undefined : subtype;
        }

        return subtype;
    });
}

// Attempts to narrow a type (make it more constrained) based on a comparison
// (equal or not equal) to a literal value. It also handles "is" or "is not"
// operators if isIsOperator is true.
function narrowTypeForLiteralComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    literalType: ClassType,
    isPositiveTest: boolean,
    isIsOperator: boolean
): Type {
    return mapSubtypes(referenceType, (subtype) => {
        subtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);
        if (isClassInstance(subtype) && ClassType.isSameGenericClass(literalType, subtype)) {
            if (subtype.literalValue !== undefined) {
                const literalValueMatches = ClassType.isLiteralValueSame(subtype, literalType);
                if ((literalValueMatches && !isPositiveTest) || (!literalValueMatches && isPositiveTest)) {
                    return undefined;
                }
                return subtype;
            } else if (isPositiveTest) {
                return literalType;
            } else {
                // If we're able to enumerate all possible literal values
                // (for bool or enum), we can eliminate all others in a negative test.
                const allLiteralTypes = enumerateLiteralsForType(evaluator, subtype);
                if (allLiteralTypes) {
                    return combineTypes(
                        allLiteralTypes.filter((type) => !ClassType.isLiteralValueSame(type, literalType))
                    );
                }
            }
        } else if (isPositiveTest) {
            if (isIsOperator || isNone(subtype)) {
                return undefined;
            }
        }

        return subtype;
    });
}

function enumerateLiteralsForType(evaluator: TypeEvaluator, type: ClassType): ClassType[] | undefined {
    if (ClassType.isBuiltIn(type, 'bool')) {
        // Booleans have only two types: True and False.
        return [
            ClassType.cloneWithLiteral(type, /* value */ true),
            ClassType.cloneWithLiteral(type, /* value */ false),
        ];
    }

    if (ClassType.isEnumClass(type)) {
        // Enumerate all of the values in this enumeration.
        const enumList: ClassType[] = [];
        const fields = type.details.fields;
        fields.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch() && !symbol.isInstanceMember()) {
                const symbolType = evaluator.getEffectiveTypeOfSymbol(symbol);
                if (
                    isClassInstance(symbolType) &&
                    ClassType.isSameGenericClass(type, symbolType) &&
                    symbolType.literalValue !== undefined
                ) {
                    enumList.push(symbolType);
                }
            }
        });

        return enumList;
    }

    return undefined;
}

// Attempts to narrow a type (make it more constrained) based on a
// call to "callable". For example, if the original type of expression "x" is
// Union[Callable[..., Any], Type[int], int], it would remove the "int" because
// it's not callable.
function narrowTypeForCallable(
    evaluator: TypeEvaluator,
    type: Type,
    isPositiveTest: boolean,
    errorNode: ExpressionNode,
    allowIntersections: boolean
): Type {
    return evaluator.mapSubtypesExpandTypeVars(type, /* conditionFilter */ undefined, (subtype) => {
        switch (subtype.category) {
            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction: {
                return isPositiveTest ? subtype : undefined;
            }

            case TypeCategory.None:
            case TypeCategory.Module: {
                return isPositiveTest ? undefined : subtype;
            }

            case TypeCategory.Class: {
                if (TypeBase.isInstantiable(subtype)) {
                    return isPositiveTest ? subtype : undefined;
                }

                // See if the object is callable.
                const callMemberType = lookUpClassMember(subtype, '__call__');
                if (!callMemberType) {
                    if (!isPositiveTest) {
                        return subtype;
                    }

                    if (allowIntersections) {
                        // The type appears to not be callable. It's possible that the
                        // two type is a subclass that is callable. We'll synthesize a
                        // new intersection type.
                        const className = `<callable subtype of ${subtype.details.name}>`;
                        const fileInfo = getFileInfo(errorNode);
                        const newClassType = ClassType.createInstantiable(
                            className,
                            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
                            fileInfo.moduleName,
                            fileInfo.filePath,
                            ClassTypeFlags.None,
                            ParseTreeUtils.getTypeSourceId(errorNode),
                            /* declaredMetaclass */ undefined,
                            subtype.details.effectiveMetaclass,
                            subtype.details.docString
                        );
                        newClassType.details.baseClasses = [ClassType.cloneAsInstantiable(subtype)];
                        computeMroLinearization(newClassType);

                        // Add a __call__ method to the new class.
                        const callMethod = FunctionType.createInstance(
                            '__call__',
                            '',
                            '',
                            FunctionTypeFlags.SynthesizedMethod
                        );
                        const selfParam: FunctionParameter = {
                            category: ParameterCategory.Simple,
                            name: 'self',
                            type: ClassType.cloneAsInstance(newClassType),
                            hasDeclaredType: true,
                        };
                        FunctionType.addParameter(callMethod, selfParam);
                        FunctionType.addDefaultParameters(callMethod);
                        callMethod.details.declaredReturnType = UnknownType.create();
                        newClassType.details.fields.set(
                            '__call__',
                            Symbol.createWithType(SymbolFlags.ClassMember, callMethod)
                        );

                        return ClassType.cloneAsInstance(newClassType);
                    }

                    return undefined;
                } else {
                    return isPositiveTest ? subtype : undefined;
                }
            }

            default: {
                // For all other types, we can't determine whether it's
                // callable or not, so we can't eliminate them.
                return subtype;
            }
        }
    });
}
