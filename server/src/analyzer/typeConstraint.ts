/*
* typeConstraint.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Classes that record a type constraint (sometimes referred to
* as a path constraint). Type constraints can be used to record
* an invariant within a conditional scope that affect types. For
* example, the expression "foo" implies implies that foo is not
* None, so "if foo:" implies that the the value of "foo" is not
* None within that scope.
*/

import { ArgumentCategory, BinaryExpressionNode, CallExpressionNode, ConstantNode,
    ExpressionNode, MemberAccessExpressionNode, NameNode,
    TypeAnnotationExpressionNode,
    UnaryExpressionNode } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { ClassType, NeverType, NoneType, ObjectType, Type, TypeCategory, UnionType } from './types';
import { TypeUtils } from './typeUtils';

export interface ConditionalTypeConstraintResults {
    // Type constraints that apply in cases where the condition potentially
    // evaluates to true (if) or false (else). Note that these are not
    // necessarily symmetric. For example, if the type is declared
    // as an "Union[int, None]", in the "if" case it is contrained to be
    // an int, but in the "else" case it is still a "Union[int, None]"
    // because an integer value of zero will evaluate to falsy.
    ifConstraints: TypeConstraint[];
    elseConstraints: TypeConstraint[];
}

export class TypeConstraint {
    // The expression this type constraint applies to.
    private _expression: ExpressionNode;

    // Resulting type if the expression matches.
    private _type: Type;

    // Indiciates that the type should be applied conditionally.
    private _isConditional: boolean;

    constructor(expression: ExpressionNode, type: Type) {
        this._expression = expression;
        this._type = type;
        this._isConditional = false;
    }

    getExpression() {
        return this._expression;
    }

    getType() {
        return this._type;
    }

    isConditional() {
        return this._isConditional;
    }

    setIsConditional() {
        this._isConditional = true;
    }

    cloneAsConditional(): TypeConstraint {
        if (this._isConditional) {
            return this;
        }

        const clone = new TypeConstraint(this._expression, this._type);
        clone.setIsConditional();
        return clone;
    }

    applyToType(node: ExpressionNode, type: Type): Type {
        if (this.doesExpressionMatch(node)) {
            // Don't transform special built-in types. These involve special processing
            // in expressionEvaluator, so we don't want to overwrite the results of
            // that processing with an assignment type constraint. By doing this, it
            // means that modules can't overwrite the values of special symbols like
            // Callable and Tuple.
            if (this._type instanceof ClassType && this._type.isSpecialBuiltIn()) {
                if (type.category !== TypeCategory.Unbound) {
                    return type;
                }
            }

            if (this._isConditional) {
                const types = [this._type, type];
                return TypeUtils.combineTypes(types);
            }
            return this._type;
        }

        return type;
    }

    // Determines whether the expression is one that the type constraint
    // module knows how to handle. In general, we need to restrict this
    // to expressions whose types cannot change throughout a block of code.
    // For now, we support only simple names and member access chains
    // that include only simple names (e.g. "A.B.C.D").
    static isSupportedExpression(expression: ExpressionNode) {
        if (expression instanceof NameNode) {
            return true;
        } else if (expression instanceof MemberAccessExpressionNode) {
            if (!this.isSupportedExpression(expression.leftExpression)) {
                return false;
            }

            return true;
        }

        return false;
    }

    doesExpressionMatch(expression: ExpressionNode) {
        return this._doesExpressionMatchRecursive(expression, this._expression);
    }

    private _doesExpressionMatchRecursive(expression1: ExpressionNode,
            expression2: ExpressionNode): boolean {

        if (expression1 instanceof NameNode) {
            if (expression2 instanceof NameNode) {
                return expression1.nameToken.value === expression2.nameToken.value;
            }
        } else if (expression1 instanceof MemberAccessExpressionNode) {
            if (expression2 instanceof MemberAccessExpressionNode) {
                return this._doesExpressionMatchRecursive(expression1.leftExpression, expression2.leftExpression) &&
                    this._doesExpressionMatchRecursive(expression1.memberName, expression2.memberName);
            }
        }

        return false;
    }
}

export class TypeConstraintBuilder {
    // Given a test expression (one that's used in an if statement to test a
    // conditional), return all of the type constraints that apply both
    // within the "if" clause and the "else" clause.
    static buildTypeConstraintsForConditional(testExpression: ExpressionNode,
            typeEvaluator: (node: ExpressionNode) => Type):
                ConditionalTypeConstraintResults | undefined {

        if (testExpression instanceof BinaryExpressionNode) {
            const results: ConditionalTypeConstraintResults = {
                ifConstraints: [],
                elseConstraints: []
            };

            if (testExpression.operator === OperatorType.Is ||
                    testExpression.operator === OperatorType.IsNot) {

                // Look for "X is None" or "X is not None". These are commonly-used
                // patterns used in control flow.
                if (TypeConstraint.isSupportedExpression(testExpression.leftExpression)) {
                    if (testExpression.rightExpression instanceof ConstantNode &&
                            testExpression.rightExpression.token.keywordType === KeywordType.None) {

                        const originalType = typeEvaluator(testExpression.leftExpression);
                        const positiveType = this._transformTypeForIsNoneExpression(originalType, true);
                        const negativeType = this._transformTypeForIsNoneExpression(originalType, false);
                        const trueConstraint = new TypeConstraint(testExpression.leftExpression, positiveType);
                        const falseConstraint = new TypeConstraint(testExpression.leftExpression, negativeType);
                        const isPositive = testExpression.operator === OperatorType.Is;

                        results.ifConstraints.push(isPositive ? trueConstraint : falseConstraint);
                        results.elseConstraints.push(isPositive ? falseConstraint : trueConstraint);

                        return results;
                    }
                }

                // Look for "type(X) is Y" or "type(X) is not Y".
                if (testExpression.leftExpression instanceof CallExpressionNode) {
                    const callType = typeEvaluator(testExpression.leftExpression.leftExpression);
                    if (callType instanceof ClassType && callType.isBuiltIn() &&
                            callType.getClassName() === 'type' &&
                            testExpression.leftExpression.arguments.length === 1 &&
                            testExpression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple) {

                        const argExpression = testExpression.leftExpression.arguments[0].valueExpression;
                        if (TypeConstraint.isSupportedExpression(argExpression)) {
                            const classType = typeEvaluator(testExpression.rightExpression);
                            if (classType instanceof ClassType) {
                                const originalType = typeEvaluator(argExpression);
                                const positiveType = this._transformTypeForIsTypeExpression(originalType, classType, true);
                                const negativeType = this._transformTypeForIsTypeExpression(originalType, classType, false);
                                const trueConstraint = new TypeConstraint(argExpression, positiveType);
                                const falseConstraint = new TypeConstraint(argExpression, negativeType);
                                const isPositive = testExpression.operator === OperatorType.Is;

                                results.ifConstraints.push(isPositive ? trueConstraint : falseConstraint);
                                results.elseConstraints.push(isPositive ? falseConstraint : trueConstraint);

                                return results;
                            }
                        }
                    }
                }
            } else if (testExpression.operator === OperatorType.And) {
                const leftConstraints = this.buildTypeConstraintsForConditional(
                    testExpression.leftExpression, typeEvaluator);
                const rightConstraints = this.buildTypeConstraintsForConditional(
                    testExpression.rightExpression, typeEvaluator);

                // For an AND operator, all of the "if" constraints must be true,
                // but we can't make any assumptions about the "else" constraints
                // because we can't determine which false evaluation caused the
                // AND to become false.
                if (leftConstraints) {
                    results.ifConstraints = leftConstraints.ifConstraints;
                }
                if (rightConstraints) {
                    results.ifConstraints = results.ifConstraints.concat(rightConstraints.ifConstraints);
                }
                if (results.ifConstraints.length === 0) {
                    return undefined;
                }
                return results;
            } else if (testExpression.operator === OperatorType.Or) {
                const leftConstraints = this.buildTypeConstraintsForConditional(
                    testExpression.leftExpression, typeEvaluator);
                const rightConstraints = this.buildTypeConstraintsForConditional(
                    testExpression.rightExpression, typeEvaluator);

                // For an OR operator, all of the "else" constraints must be false,
                // but we can't make any assumptions about the "if" constraints
                // because we can't determine which evaluation caused the
                // OR to become true.
                if (leftConstraints) {
                    results.elseConstraints = leftConstraints.elseConstraints;
                }
                if (rightConstraints) {
                    results.elseConstraints = results.elseConstraints.concat(rightConstraints.elseConstraints);
                }
                if (results.elseConstraints.length === 0) {
                    return undefined;
                }
                return results;
            }
        } else if (testExpression instanceof UnaryExpressionNode) {
            if (testExpression.operator === OperatorType.Not) {
                const constraints = this.buildTypeConstraintsForConditional(
                    testExpression.expression, typeEvaluator);

                if (constraints) {
                    // A not operator simply flips the else and if constraints.
                    return {
                        ifConstraints: constraints.elseConstraints,
                        elseConstraints: constraints.ifConstraints
                    };
                }
            }
        } else if (testExpression instanceof NameNode ||
                testExpression instanceof MemberAccessExpressionNode) {

            if (TypeConstraint.isSupportedExpression(testExpression)) {
                const originalType = typeEvaluator(testExpression);
                const positiveType = this._transformTypeForTruthyExpression(originalType, true);
                const negativeType = this._transformTypeForTruthyExpression(originalType, false);
                const trueConstraint = new TypeConstraint(testExpression, positiveType);
                const falseConstraint = new TypeConstraint(testExpression, negativeType);
                return {
                    ifConstraints: [trueConstraint],
                    elseConstraints: [falseConstraint]
                };
            }
        } else if (testExpression instanceof CallExpressionNode) {
            if (testExpression.leftExpression instanceof NameNode &&
                    testExpression.leftExpression.nameToken.value === 'isinstance' &&
                    testExpression.arguments.length === 2) {

                // Make sure the first parameter is a supported expression type
                // and the second parameter is a valid class type or a tuple
                // of valid class types.
                const arg0Expr = testExpression.arguments[0].valueExpression;
                const arg1Expr = testExpression.arguments[1].valueExpression;

                if (TypeConstraint.isSupportedExpression(arg0Expr)) {
                    const arg1Type = typeEvaluator(arg1Expr);

                    // Create a shared lambda for creating the actual type constraint.
                    const createIsInstanceTypeConstraint = (classList: ClassType[]) => {
                        const originalType = typeEvaluator(arg0Expr);
                        const positiveType = this._transformTypeForIsInstanceExpression(originalType, classList, true);
                        const negativeType = this._transformTypeForIsInstanceExpression(originalType, classList, false);
                        const trueConstraint = new TypeConstraint(arg0Expr, positiveType);
                        const falseConstraint = new TypeConstraint(arg0Expr, negativeType);
                        return {
                            ifConstraints: [trueConstraint],
                            elseConstraints: [falseConstraint]
                        };
                    };

                    if (arg1Type instanceof ClassType) {
                        return createIsInstanceTypeConstraint([arg1Type]);
                    } else if (arg1Type instanceof ObjectType) {
                        // The isinstance call supports a variation where the second
                        // parameter is a tuple of classes.
                        const objClass = arg1Type.getClassType();
                        if (objClass.isBuiltIn() && objClass.getClassName() === 'Tuple' && objClass.getTypeArguments()) {
                            let foundNonClassType = false;
                            const classTypeList: ClassType[] = [];
                            objClass.getTypeArguments()!.forEach(typeArg => {
                                if (typeArg instanceof ClassType) {
                                    classTypeList.push(typeArg);
                                } else {
                                    foundNonClassType = true;
                                }
                            });

                            if (!foundNonClassType) {
                                return createIsInstanceTypeConstraint(classTypeList);
                            }
                        }
                    }
                }
            }
        }

        return undefined;
    }

    // Builds a type constraint that applies the specified type to an expression.
    static buildTypeConstraintForAssignment(targetNode: ExpressionNode,
            assignmentType: Type): TypeConstraint | undefined {

        if (targetNode instanceof TypeAnnotationExpressionNode) {
            if (TypeConstraint.isSupportedExpression(targetNode.valueExpression)) {
                return new TypeConstraint(targetNode.valueExpression, assignmentType);
            }

            return undefined;
        }

        if (TypeConstraint.isSupportedExpression(targetNode)) {
            return new TypeConstraint(targetNode, assignmentType);
        }

        return undefined;
    }

    // Represents a simple check for truthiness. It eliminates the
    // possibility of "None" for a type.
    private static _transformTypeForTruthyExpression(type: Type, isPositiveTest: boolean): Type {
        if (type.isAny()) {
            return type;
        }

        let types: Type[];
        if (type instanceof UnionType) {
            types = type.getTypes();
        } else {
            types = [type];
        }

        if (isPositiveTest) {
            types = types.filter(t => TypeUtils.canBeTruthy(t));
        } else {
            types = types.filter(t => TypeUtils.canBeFalsy(t));
        }

        return TypeUtils.combineTypes(types);
    }

    // Represents an "is" or "is not" None test.
    private static _transformTypeForIsNoneExpression(type: Type, isPositiveTest: boolean): Type {
        if (type instanceof UnionType) {
            const remainingTypes = type.getTypes().filter(t => {
                if (t.isAny()) {
                    // We need to assume that "Any" is always an instance and not an instance,
                    // so it matches regardless of whether the test is positive or negative.
                    return true;
                }

                // See if it's a match for None.
                return (t instanceof NoneType) === isPositiveTest;
            });

            return TypeUtils.combineTypes(remainingTypes);
        } else if (type instanceof NoneType) {
            if (!isPositiveTest) {
                // Use a "Never" type (which is a special form
                // of None) to indicate that the condition will
                // always evaluate to false.
                return NeverType.create();
            }
        }

        return type;
    }

    // Represents a "type(X) is Y" or "type(X) is not Y" test.
    private static _transformTypeForIsTypeExpression(type: Type, classType: ClassType,
            isPositiveTest: boolean): Type {

        return TypeUtils.doForSubtypes(type, subtype => {
            if (subtype instanceof ObjectType) {
                const matches = subtype.getClassType().isSameGenericClass(classType);
                if (isPositiveTest) {
                    return matches ? subtype : undefined;
                } else {
                    return matches ? undefined : subtype;
                }
            } else if (subtype instanceof NoneType) {
                return isPositiveTest ? undefined : subtype;
            }

            return subtype;
        });
    }

    // Represents an "isinstance" check, potentially constraining a
    // union type.
    private static _transformTypeForIsInstanceExpression(type: Type, classTypeList: ClassType[],
            isPositiveTest: boolean): Type {

        // Filters the varType by the parameters of the isinstance
        // and returns the list of types the varType could be after
        // applying the filter.
        const filterType = (varType: ClassType): ObjectType[] => {
            const filteredTypes: ClassType[] = [];

            let foundSuperclass = false;
            for (const filterType of classTypeList) {
                const filterIsSuperclass = varType.isDerivedFrom(filterType);
                const filterIsSubclass = filterType.isDerivedFrom(varType);

                if (filterIsSuperclass) {
                    foundSuperclass = true;
                }

                if (isPositiveTest) {
                    if (filterIsSuperclass) {
                        // If the variable type is a subclass of the isinstance
                        // filter, we haven't learned anything new about the
                        // variable type.
                        filteredTypes.push(varType);
                    } else if (filterIsSubclass) {
                        // If the variable type is a superclass of the isinstance
                        // filter, we can narrow the type to the subclass.
                        filteredTypes.push(filterType);
                    }
                }
            }

            // In the negative case, if one or more of the filters
            // always match the type (i.e. they are an exact match or
            // a superclass of the type), then there's nothing left after
            // the filter is applied. If we didn't find any superclass
            // match, then the original variable type survives the filter.
            if (!isPositiveTest && !foundSuperclass) {
                filteredTypes.push(varType);
            }

            return filteredTypes.map(t => new ObjectType(t));
        };

        const finalizeFilteredTypeList = (types: Type[]): Type => {
            return TypeUtils.combineTypes(types);
        };

        if (type instanceof ObjectType) {
            const filteredType = filterType(type.getClassType());
            return finalizeFilteredTypeList(filteredType);
        } else if (type instanceof UnionType) {
            let remainingTypes: Type[] = [];

            type.getTypes().forEach(t => {
                if (t.isAny()) {
                    // Any types always remain for both positive and negative
                    // checks because we can't say anything about them.
                    remainingTypes.push(t);
                } else if (t instanceof ObjectType) {
                    remainingTypes = remainingTypes.concat(
                        filterType(t.getClassType()));
                } else {
                    // All other types are never instances of a class.
                    if (!isPositiveTest) {
                        remainingTypes.push(t);
                    }
                }
            });

            return finalizeFilteredTypeList(remainingTypes);
        }

        // Return the original type.
        return type;
    }
}
