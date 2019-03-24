/*
* typeConstraint.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Classes that record an invariant within a conditional scope
* that affect types. For example, the expression "foo" implies
* implies that foo is not None, so "if foo:" implies that the
* the value of "foo" is not None within that scope.
*/

import { BinaryExpressionNode, CallExpressionNode, ConstantNode,
    ExpressionNode, MemberAccessExpressionNode, NameNode,
    UnaryExpressionNode } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { ClassType, NoneType, ObjectType, TupleType, Type, UnionType } from './types';
import { TypeUtils } from './typeUtils';

export abstract class TypeConstraint {
    private _isPositiveTest: boolean;

    constructor(isPositiveTest: boolean) {
        this._isPositiveTest = isPositiveTest;
    }

    isPositiveTest() {
        return this._isPositiveTest;
    }

    negate() {
        this._isPositiveTest = !this._isPositiveTest;
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

    static doesExpressionMatch(expression1: ExpressionNode, expression2: ExpressionNode): boolean {
        if (expression1 instanceof NameNode) {
            if (expression2 instanceof NameNode) {
                return expression1.nameToken.value === expression2.nameToken.value;
            }
        } else if (expression1 instanceof MemberAccessExpressionNode) {
            if (expression2 instanceof MemberAccessExpressionNode) {
                return this.doesExpressionMatch(expression1.leftExpression, expression2.leftExpression) &&
                    this.doesExpressionMatch(expression1.memberName, expression2.memberName);
            }
        }

        return false;
    }

    abstract applyToType(node: ExpressionNode, type: Type): Type;
}

// Represents a simple check for truthiness. It eliminates the
// possibility of "None" for a type.
export class TruthyTypeConstraint extends TypeConstraint {
    private _expression: ExpressionNode;

    constructor(node: ExpressionNode, isPositiveTest = true) {
        super(isPositiveTest);
        this._expression = node;
    }

    applyToType(node: ExpressionNode, type: Type): Type {
        if (TypeConstraint.doesExpressionMatch(node, this._expression)) {
            if (type.isAny()) {
                return type;
            }

            if (this.isPositiveTest()) {
                if (type instanceof UnionType) {
                    return type.removeOptional();
                } else if (type instanceof NoneType) {
                    // TODO - we may want to return a "never" type in
                    // this case to indicate that the condition will
                    // always evaluate to false.
                    return NoneType.create();
                }
            } else {
                if (type instanceof UnionType) {
                    let remainingTypes = type.getTypes().filter(t => TypeUtils.canBeFalsy(t));
                    if (remainingTypes.length === 0) {
                        // TODO - we may want to return a "never" type in
                        // this case to indicate that the condition will
                        // always evaluate to false.
                        return NoneType.create();
                    } else {
                        return TypeUtils.combineTypesArray(remainingTypes);
                    }
                }
            }
        }

        // Return the original type.
        return type;
    }
}

// Represents an "is" or "is not" None check.
export class IsNoneTypeConstraint extends TypeConstraint {
    private _expression: ExpressionNode;

    constructor(node: ExpressionNode, isPositiveTest = true) {
        super(isPositiveTest);
        this._expression = node;
    }

    applyToType(node: ExpressionNode, type: Type): Type {
        if (TypeConstraint.doesExpressionMatch(node, this._expression)) {
            if (type instanceof UnionType) {
                let remainingTypes = type.getTypes().filter(t => {
                    if (t.isAny()) {
                        // We need to assume that "Any" is always an instance and not an instance,
                        // so it matches regardless of whether the test is positive or negative.
                        return true;
                    }

                    // See if it's a match for None.
                    return (t instanceof NoneType) === this.isPositiveTest();
                });

                if (remainingTypes.length === 0) {
                    // TODO - we may want to return a "never" type in
                    // this case to indicate that the condition will
                    // always evaluate to false.
                    return NoneType.create();
                }

                return TypeUtils.combineTypesArray(remainingTypes);
            } else if (type instanceof NoneType) {
                if (!this.isPositiveTest()) {
                    // TODO - we may want to return a "never" type in
                    // this case to indicate that the condition will
                    // always evaluate to false.
                    return NoneType.create();
                }
            }
        }

        return type;
    }
}

// Represents an "instanceof" check, potentially constraining a
// union type.
export class InstanceOfTypeConstraint extends TypeConstraint {
    private _expression: ExpressionNode;
    private _classTypeList: ClassType[];

    constructor(node: ExpressionNode, typeList: ClassType[], isPositiveTest = true) {
        super(isPositiveTest);
        this._expression = node;
        this._classTypeList = typeList;
    }

    applyToType(node: ExpressionNode, type: Type): Type {
        let doInstanceCheck = (objType: ObjectType) => {
            const matchingInstance = this._classTypeList.find(
                t => TypeUtils.isInstanceOf(objType, t));
            if (this.isPositiveTest()) {
                // For a positive test, see if the type is an instance of at
                // least one of the class types.
                return matchingInstance !== undefined;
            } else {
                // For a negative test, see if the type is not an instance of
                // all class types.
                return matchingInstance === undefined;
            }
        };

        if (TypeConstraint.doesExpressionMatch(node, this._expression)) {
            if (type instanceof UnionType) {
                let remainingTypes = type.getTypes().filter(t => {
                    if (t.isAny()) {
                        // We need to assume that "Any" is always an instance and not an instance,
                        // so it matches regardless of whether the test is positive or negative.
                        return true;
                    }

                    if (t instanceof ObjectType) {
                        return doInstanceCheck(t);
                    }

                    // All other types are never instances of a class.
                    return !this.isPositiveTest();
                });

                if (remainingTypes.length === 0) {
                    // TODO - we may want to return a "never" type in
                    // this case to indicate that the condition will
                    // always evaluate to false.
                    return NoneType.create();
                }

                return TypeUtils.combineTypesArray(remainingTypes);
            } else if (type instanceof ObjectType) {
                if (type.isAny()) {
                    // We need to assume that "Any" is always an instance and not an instance,
                    // so it matches regardless of whether the test is positive or negative.
                    return type;
                }

                if (doInstanceCheck(type)) {
                    return type;
                } else {
                    // TODO - we may want to return a "never" type in
                    // this case to indicate that the condition will
                    // always evaluate to false.
                    return NoneType.create();
                }
            }
        }

        // Return the original type.
        return type;
    }
}

export interface TypeConstraintResults {
    ifConstraints: TypeConstraint[];
    elseConstraints: TypeConstraint[];
}

export class TypeConstraintBuilder {
    // Given a test expression (one that's used in an if statement to test a
    // conditional), return all of the type constraints that apply both
    // within the "if" clause and the "else" clause.
    static buildTypeConstraints(testExpression: ExpressionNode,
            typeEvaluator: (node: ExpressionNode) => Type):
                TypeConstraintResults | undefined {

        if (testExpression instanceof BinaryExpressionNode) {
            let results: TypeConstraintResults = {
                ifConstraints: [],
                elseConstraints: []
            };

            // Look for "X is None" or "X is not None". These are commonly-used
            // patterns used in control flow.
            if (testExpression.operator === OperatorType.Is ||
                    testExpression.operator === OperatorType.IsNot) {
                if (testExpression.rightExpression instanceof ConstantNode &&
                        testExpression.rightExpression.token.keywordType === KeywordType.None) {

                    const trueConstraint = new IsNoneTypeConstraint(testExpression.leftExpression, true);
                    const falseConstraint = new IsNoneTypeConstraint(testExpression.leftExpression, false);
                    const isPositive = testExpression.operator === OperatorType.Is;

                    results.ifConstraints.push(isPositive ? trueConstraint : falseConstraint);
                    results.elseConstraints.push(isPositive ? falseConstraint : trueConstraint);

                    return results;
                }
            } else if (testExpression.operator === OperatorType.And) {
                let leftConstraints = this.buildTypeConstraints(
                    testExpression.leftExpression, typeEvaluator);
                let rightConstraints = this.buildTypeConstraints(
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
                let leftConstraints = this.buildTypeConstraints(
                    testExpression.leftExpression, typeEvaluator);
                let rightConstraints = this.buildTypeConstraints(
                    testExpression.rightExpression, typeEvaluator);

                // For an OR operator, all of the negated "else" constraints must be true,
                // but we can't make any assumptions about the "if" constraints
                // because we can't determine which evaluation caused the
                // OR to become true.
                if (leftConstraints) {
                    results.elseConstraints.forEach(c => {
                        c.negate();
                    });
                    results.elseConstraints = results.elseConstraints;
                }
                if (rightConstraints) {
                    rightConstraints.elseConstraints.forEach(c => {
                        c.negate();
                    });
                    results.elseConstraints = results.elseConstraints.concat(rightConstraints.elseConstraints);
                }
                if (results.elseConstraints.length === 0) {
                    return undefined;
                }
                return results;
            }
        } else if (testExpression instanceof UnaryExpressionNode) {
            if (testExpression.operator === OperatorType.Not) {
                let constraints = this.buildTypeConstraints(
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
                const trueConstraint = new TruthyTypeConstraint(testExpression, true);
                const falseConstraint = new TruthyTypeConstraint(testExpression, false);
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
                    const classType = typeEvaluator(arg1Expr);

                    if (classType instanceof ClassType) {
                        const trueConstraint = new InstanceOfTypeConstraint(arg0Expr, [classType], true);
                        const falseConstraint = new InstanceOfTypeConstraint(arg0Expr, [classType], false);
                        return {
                            ifConstraints: [trueConstraint],
                            elseConstraints: [falseConstraint]
                        };
                    } else if (classType instanceof TupleType) {
                        let tupleBaseTypes = classType.getEntryTypes();
                        if (tupleBaseTypes.length > 0 &&
                                tupleBaseTypes.find(t => !(t instanceof ClassType)) === undefined) {
                            const classTypeList = tupleBaseTypes.map(t => t as ClassType);
                            const trueConstraint = new InstanceOfTypeConstraint(arg0Expr, classTypeList, true);
                            const falseConstraint = new InstanceOfTypeConstraint(arg0Expr, classTypeList, false);
                            return {
                                ifConstraints: [trueConstraint],
                                elseConstraints: [falseConstraint]
                            };
                        }
                    }
                }
            }
        }

        return undefined;
    }
}
