/*
 * tupleComparison.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Operation-local views for lexicographic tuple comparison.
 */

import { ArgCategory, ExpressionNode, ParseNodeType } from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';
import { operatorSupportsChaining } from './parseTreeUtils';
import { ScopeType } from './scope';
import { TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    MemberAccessFlags,
    getTypeCondition,
    isLiteralType,
    isNoneInstance,
    isTupleClass,
    lookUpClassMember,
} from './typeUtils';
import {
    ClassType,
    combineTypes,
    exceedsInferredTupleLiteralProduct,
    getInferredTupleLiteralBase,
    getTupleLiteralTypeComplexity,
    getTypeAliasInfo,
    Type,
    TupleTypeArg,
    TypeBase,
    UnknownType,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isTypeSame,
    isUnion,
    isTypeVar,
    TypeVarType,
    TypeAliasSharedInfo,
    maxTypeRecursionCount,
    maxSubtypesForInferredType,
} from './types';

const comparisonMethods: { [operator: number]: [string, string] } = {
    [OperatorType.LessThan]: ['__lt__', '__gt__'],
    [OperatorType.LessThanOrEqual]: ['__le__', '__ge__'],
    [OperatorType.GreaterThan]: ['__gt__', '__lt__'],
    [OperatorType.GreaterThanOrEqual]: ['__ge__', '__le__'],
};

export function isTupleOrdering(operator: OperatorType): boolean {
    return comparisonMethods[operator] !== undefined;
}

export function getTupleComparisonResult(
    evaluator: TypeEvaluator,
    leftType: ClassType,
    rightType: ClassType,
    operator: OperatorType,
    errorNode: ExpressionNode
): TypeResult | undefined {
    const type = inferTupleComparison(evaluator, leftType, rightType, operator, errorNode);
    return type ? { type } : undefined;
}

// Validate lexicographic ordering without changing either operand's narrowed
// type. Memoize repeated type pairs and visit each alignment only once.
function inferTupleComparison(
    evaluator: TypeEvaluator,
    leftType: ClassType,
    rightType: ClassType,
    operator: OperatorType,
    errorNode: ExpressionNode
): Type | undefined {
    const leftExpression = errorNode.nodeType === ParseNodeType.BinaryOperation ? errorNode.d.leftExpr : undefined;
    let rightExpression = errorNode.nodeType === ParseNodeType.BinaryOperation ? errorNode.d.rightExpr : undefined;
    if (
        rightExpression?.nodeType === ParseNodeType.BinaryOperation &&
        !rightExpression.d.hasParens &&
        operatorSupportsChaining(rightExpression.d.operator)
    ) {
        rightExpression = rightExpression.d.leftExpr;
    }
    const runtimeClass = (type: Type): ClassType | undefined => {
        if (!isClass(type)) return undefined;
        const cls = TypeBase.isInstance(type) ? ClassType.cloneAsInstantiable(type) : type.shared.effectiveMetaclass;
        return cls && isInstantiableClass(cls) ? cls : undefined;
    };
    const lookupMethod = (type: Type, name: string, flags?: MemberAccessFlags) => {
        const cls = runtimeClass(type);
        return cls ? lookUpClassMember(cls, name, flags) : undefined;
    };
    const isBuiltinOrderingMethod = (type: Type, name: string): boolean => {
        const member = lookupMethod(type, name);
        return (
            !!member &&
            isClass(member.classType) &&
            ClassType.isBuiltIn(member.classType, ['int', 'float', 'str', 'bytes', 'bytearray', 'tuple', 'list'])
        );
    };

    // Presence and successful binding are separate facts. A failed call to a
    // present user method does not mean Python will try the reflected method.
    const callMethod = (
        receiver: Type,
        name: string,
        argument: Type,
        receiverUnexpanded = receiver,
        argumentUnexpanded = argument
    ): { kind: 'success'; result: TypeResult } | { kind: 'missing' | 'invalid' } => {
        let result = evaluator.getTypeOfMagicMethodCall(
            receiverUnexpanded,
            name,
            [{ type: argumentUnexpanded }],
            errorNode,
            undefined
        );
        if (!result && isTypeVar(receiverUnexpanded) && isClass(receiver)) {
            // A union bound has no single lookup class. Bind the selected class
            // method to the original variable rather than replacing Self with a bound.
            result = evaluator.useSpeculativeMode(errorNode, () => {
                const method = evaluator.getBoundMagicMethod(receiver, name, receiverUnexpanded, errorNode);
                if (!method) return undefined;
                const call = evaluator.validateCallArgs(
                    errorNode,
                    [{ argCategory: ArgCategory.Simple, typeResult: { type: argumentUnexpanded } }],
                    { type: method },
                    undefined,
                    true,
                    undefined
                );
                return call.argumentErrors || !call.returnType
                    ? undefined
                    : { type: call.returnType, isIncomplete: call.isTypeIncomplete };
            });
        }
        if (!result && receiverUnexpanded !== receiver) {
            result = evaluator.getTypeOfMagicMethodCall(
                receiver,
                name,
                [{ type: argumentUnexpanded }],
                errorNode,
                undefined
            );
        }
        if (!result && argumentUnexpanded !== argument) {
            result = evaluator.getTypeOfMagicMethodCall(receiver, name, [{ type: argument }], errorNode, undefined);
        }
        if (result) return { kind: 'success', result };
        return { kind: lookupMethod(receiver, name, MemberAccessFlags.SkipInstanceMembers) ? 'invalid' : 'missing' };
    };
    const resultTypes: Type[] = [];
    const reflectionOrder = new Map<ClassType['shared'], Map<ClassType['shared'], boolean>>();
    const boolType = evaluator.getBuiltInObject(errorNode, 'bool');
    const comparedPairs = new Map<Type, Map<Type, boolean>>();
    const pendingPairs: { left: Type; right: Type; depth: number; isConditional: boolean }[] = [];
    let hasRecursiveAlias = false;
    let recursiveBudgetExceeded = false;
    const hasUnknownShape = [leftType, rightType].some((type) =>
        type.priv.tupleTypeArgs?.some((arg) => arg.isUnbounded && isAnyOrUnknown(arg.type))
    );
    let requiresDeclaredContract = hasUnknownShape;
    // NotImplemented is a dispatch signal; all other return types are values
    // of the comparison expression, including non-boolean values.
    const classifyResult = (type: Type, left: Type, right: Type) => {
        const values: Type[] = [];
        let declines = false;
        let preservedTypeVars: Map<number, TypeVarType> | undefined;
        let declinedTypeVars: Set<TypeVarType> | undefined;
        evaluator.mapSubtypesExpandTypeVars(
            type,
            { conditionFilter: [...(getTypeCondition(left) ?? []), ...(getTypeCondition(right) ?? [])] },
            (subtype, unexpandedSubtype) => {
                const typeVar =
                    isTypeVar(unexpandedSubtype) &&
                    !TypeVarType.hasConstraints(unexpandedSubtype) &&
                    !unexpandedSubtype.shared.recursiveAlias
                        ? unexpandedSubtype
                        : undefined;
                if (isClassInstance(subtype) && subtype.shared.fullName === 'types.NotImplementedType') {
                    declines = true;
                    if (typeVar) {
                        (declinedTypeVars ??= new Set()).add(typeVar);
                    }
                } else {
                    if (typeVar) {
                        (preservedTypeVars ??= new Map()).set(values.length, typeVar);
                    }
                    values.push(subtype);
                }
                return subtype;
            }
        );
        preservedTypeVars?.forEach((typeVar, index) => {
            // A bound is a classification view, not the successful return value.
            // If the bound itself includes NotImplemented, retain only its values.
            if (!declinedTypeVars?.has(typeVar)) {
                values[index] = typeVar;
            }
        });
        return { values, declines };
    };

    const getOrderingResult = (
        left: Type,
        right: Type,
        leftUnexpanded = left,
        rightUnexpanded = right
    ): Type[] | undefined => {
        const leftClass = runtimeClass(left);
        const rightClass = runtimeClass(right);
        let reflectedFirst = false;
        if (leftClass && rightClass && !ClassType.isSameGenericClass(leftClass, rightClass)) {
            let byRight = reflectionOrder.get(leftClass.shared);
            if (!byRight) {
                byRight = new Map();
                reflectionOrder.set(leftClass.shared, byRight);
            }
            const cached = byRight.get(rightClass.shared);
            if (cached !== undefined) {
                reflectedFirst = cached;
            } else {
                // MROs are already finite and shared across specializations.
                // Reuse the same inheritance lookup across tuple positions.
                reflectedFirst = rightClass.shared.mro.some((base) => {
                    evaluator.checkForCancellation();
                    return isClass(base) && ClassType.isSameGenericClass(base, leftClass);
                });
                byRight.set(rightClass.shared, reflectedFirst);
            }
        }
        const operands = [left, right];
        const unexpandedOperands = [leftUnexpanded, rightUnexpanded];
        const methods = comparisonMethods[operator];
        const values: Type[] = [];
        for (const index of reflectedFirst ? [1, 0] : [0, 1]) {
            const receiver = operands[index];
            const method = methods[index];
            const call = callMethod(
                receiver,
                method,
                operands[1 - index],
                unexpandedOperands[index],
                unexpandedOperands[1 - index]
            );
            if (call.kind !== 'success') {
                // Invalid user arguments are errors; built-in slots can refuse.
                if (call.kind === 'invalid' && !isBuiltinOrderingMethod(receiver, method)) {
                    return undefined;
                }
                continue;
            }
            const result = classifyResult(call.result.type, left, right);
            values.push(...result.values);
            if (!result.declines) return values;
        }
        // A refusing or missing fallback does not erase successful values.
        return values.length ? values : undefined;
    };

    const getDeclaredContractResult = (): Type | undefined => {
        const contract = (type: ClassType) => {
            const elementType = evaluator.stripLiteralValue(
                getInferredTupleLiteralBase(type.priv.typeArgs?.[0] ?? UnknownType.create())
            );
            return ClassType.specialize(type, [elementType], true, undefined, [
                { type: elementType, isUnbounded: true },
            ]);
        };
        const values = getOrderingResult(contract(leftType), contract(rightType));
        return values ? combineTypes(values) : undefined;
    };

    const getRecursiveBudgetFallback = (): Type | undefined => {
        const declared = getDeclaredContractResult();
        if (!declared) return undefined;
        // Keep cheap results already reached, but never combine growing generic graphs.
        return combineTypes([
            ...resultTypes.filter(
                (type) =>
                    isAnyOrUnknown(type) ||
                    (isClassInstance(type) &&
                        !type.priv.typeArgs?.length &&
                        !type.priv.tupleTypeArgs?.length &&
                        !ClassType.isBuiltIn(type, 'bool'))
            ),
            declared,
        ]);
    };

    const sameName = (left: ExpressionNode | undefined, right: ExpressionNode | undefined): boolean => {
        if (
            left?.nodeType !== ParseNodeType.Name ||
            right?.nodeType !== ParseNodeType.Name ||
            left.d.value !== right.d.value
        ) {
            return false;
        }
        const first = evaluator.lookUpSymbolRecursive(left, left.d.value, false);
        const second = evaluator.lookUpSymbolRecursive(right, right.d.value, false);
        return (
            !!first &&
            !!second &&
            first.scope.type !== ScopeType.Class &&
            second.scope.type !== ScopeType.Class &&
            first.symbol === second.symbol
        );
    };
    if (sameName(leftExpression, rightExpression)) {
        return boolType;
    }

    let pureOperands: boolean | undefined;
    let identityBudgetExceeded = false;
    const sameReferenceAt = (leftIndex: number, rightIndex: number, depth: number): boolean => {
        if (
            depth !== 0 ||
            leftExpression?.nodeType !== ParseNodeType.Tuple ||
            rightExpression?.nodeType !== ParseNodeType.Tuple ||
            !sameName(leftExpression.d.items[leftIndex], rightExpression.d.items[rightIndex])
        ) {
            return false;
        }
        if (pureOperands === undefined) {
            const pending: ExpressionNode[] = [leftExpression, rightExpression];
            let remaining = maxSubtypesForInferredType;
            pureOperands = true;
            while (pending.length) {
                if (--remaining < 0) {
                    identityBudgetExceeded = true;
                    pureOperands = false;
                    break;
                }
                const node: ExpressionNode = pending.pop()!;
                if (
                    node.nodeType === ParseNodeType.Name ||
                    node.nodeType === ParseNodeType.Number ||
                    node.nodeType === ParseNodeType.Constant
                ) {
                    continue;
                }
                if (node.nodeType === ParseNodeType.StringList) {
                    if (node.d.strings.every((item) => item.nodeType === ParseNodeType.String)) {
                        continue;
                    }
                } else if (node.nodeType === ParseNodeType.Tuple || node.nodeType === ParseNodeType.List) {
                    if (node.d.items.length > remaining) {
                        identityBudgetExceeded = true;
                        pureOperands = false;
                        break;
                    }
                    pending.push(...node.d.items);
                    continue;
                }
                pureOperands = false;
                break;
            }
        }
        return pureOperands;
    };

    // Built-in containers use their declared sequence semantics; explicit
    // subclass types use their declared methods without callee-body analysis.
    const canOrderResolvedPair = (
        left: Type,
        right: Type,
        recursionCount: number,
        isConditional: boolean,
        leftUnexpanded: Type,
        rightUnexpanded: Type
    ): boolean => {
        if (isAnyOrUnknown(left) || isAnyOrUnknown(right)) {
            // Opaque shape facts use the old contract, not an additional Unknown result.
            if (!hasUnknownShape) {
                resultTypes.push(isAnyOrUnknown(left) ? left : right);
            }
            return true;
        }
        if (isClassInstance(left) && isClassInstance(right)) {
            if (isTupleClass(left) && isTupleClass(right) && left.priv.tupleTypeArgs && right.priv.tupleTypeArgs) {
                return canOrderArgs(left.priv.tupleTypeArgs, right.priv.tupleTypeArgs, recursionCount, isConditional);
            }
            if (ClassType.isBuiltIn(left, 'list') && ClassType.isBuiltIn(right, 'list')) {
                resultTypes.push(boolType);
                const leftElement = left.priv.typeArgs?.[0] ?? UnknownType.create();
                const rightElement = right.priv.typeArgs?.[0] ?? UnknownType.create();
                return canOrderElements(leftElement, rightElement, recursionCount + 1, isConditional);
            }
        }
        if (hasRecursiveAlias) {
            const args = [left, right].flatMap((type) => (isClassInstance(type) ? type.priv.typeArgs ?? [] : []));
            if (!getTupleLiteralTypeComplexity(args)) {
                recursiveBudgetExceeded = true;
                return false;
            }
        }
        const values = getOrderingResult(left, right, leftUnexpanded, rightUnexpanded);
        if (!values) {
            // Types alone cannot determine whether equal objects skip this call.
            // Discard optional precision instead of recovering source identities.
            if (
                isClassInstance(left) &&
                isClassInstance(right) &&
                (ClassType.isSameGenericClass(left, right) ||
                    ClassType.isBuiltIn(left, 'object') ||
                    ClassType.isBuiltIn(right, 'object'))
            ) {
                requiresDeclaredContract = true;
                return true;
            }
            return false;
        }
        resultTypes.push(...values);
        return true;
    };

    const canOrderElementsUncached = (
        left: Type,
        right: Type,
        recursionCount: number,
        isConditional: boolean
    ): boolean => {
        if (exceedsInferredTupleLiteralProduct(left, right)) {
            left = getInferredTupleLiteralBase(left);
            right = getInferredTupleLiteralBase(right);
        }
        // Primitive literals affect equality and custom overload selection,
        // but not ordering between built-in scalar families. Collapse these
        // operation-local views before expanding a large literal union.
        const subtypes = (type: Type): Type[] => (isUnion(type) ? type.priv.subtypes : [type]);
        const primitivesOnly = (type: Type): boolean =>
            subtypes(type).every(
                (subtype) =>
                    isClassInstance(subtype) &&
                    ClassType.isBuiltIn(subtype, ['int', 'bool', 'float', 'complex', 'str', 'bytes'])
            );
        if (primitivesOnly(left) && primitivesOnly(right)) {
            left = evaluator.stripLiteralValue(left);
            right = evaluator.stripLiteralValue(right);
        }

        // A common bool contract proves an entire union without a Cartesian
        // product. Require valid calls for the whole opposing union, inspect
        // both declared dispatch directions, and retain NotImplemented fallback.
        if (isUnion(left) || isUnion(right)) {
            const summarize = (receiver: Type, argument: Type, method: string) => {
                let completes = true;
                for (const subtype of subtypes(receiver)) {
                    evaluator.checkForCancellation();
                    if (!runtimeClass(subtype)) return undefined;
                    const member = lookupMethod(subtype, method, MemberAccessFlags.SkipInstanceMembers);
                    // Built-in container annotations do not describe the
                    // element comparison's actual return type. Recurse below.
                    if (member && isClass(member.classType) && ClassType.isBuiltIn(member.classType, ['tuple', 'list']))
                        return undefined;
                    const call = callMethod(subtype, method, argument);
                    if (call.kind !== 'success') {
                        if (call.kind === 'invalid') return undefined;
                        completes = false;
                        continue;
                    }
                    const result = classifyResult(call.result.type, subtype, argument);
                    if (!result.values.every((type) => isClassInstance(type) && ClassType.isBuiltIn(type, 'bool')))
                        return undefined;
                    completes &&= !result.declines;
                }
                return { completes };
            };
            const methods = comparisonMethods[operator];
            const forward = summarize(left, right, methods[0]);
            const reflected = forward ? summarize(right, left, methods[1]) : undefined;
            if (forward && reflected && (forward.completes || reflected.completes)) {
                resultTypes.push(boolType);
                return true;
            }
        }

        // Use expanded views for dispatch and original operands for method binding.
        // Keep the evaluator's conditions so correlated constraints are not crossed.
        let valid = true;
        evaluator.mapSubtypesExpandTypeVars(left, undefined, (leftSubtype, leftUnexpanded) => {
            evaluator.mapSubtypesExpandTypeVars(
                right,
                { conditionFilter: getTypeCondition(leftSubtype) },
                (rightSubtype, rightUnexpanded) => {
                    if (!valid && !isConditional) {
                        return rightSubtype;
                    }
                    hasRecursiveAlias ||=
                        (isTypeVar(leftUnexpanded) && !!leftUnexpanded.shared.recursiveAlias) ||
                        (isTypeVar(rightUnexpanded) && !!rightUnexpanded.shared.recursiveAlias);
                    valid =
                        canOrderResolvedPair(
                            leftSubtype,
                            rightSubtype,
                            recursionCount,
                            isConditional,
                            leftUnexpanded,
                            rightUnexpanded
                        ) && valid;
                    return rightSubtype;
                }
            );
            return leftSubtype;
        });
        return valid;
    };

    // Recursive specialization can clone placeholders and expanded classes.
    // Limit new obligations instead of equating different alias arguments.
    const aliasSpecializations = new Map<TypeAliasSharedInfo, number>();

    const canOrderElements = (left: Type, right: Type, depth: number, isConditional: boolean): boolean => {
        let rights = comparedPairs.get(left);
        if (!rights) {
            rights = new Map();
            comparedPairs.set(left, rights);
        }
        const previous = rights.get(right);
        if (previous === false || (previous === true && isConditional)) return true;
        rights.set(right, isConditional);

        const leftAlias = getTypeAliasInfo(left);
        const rightAlias = getTypeAliasInfo(right);
        hasRecursiveAlias ||=
            (isTypeVar(left) && !!left.shared.recursiveAlias) || (isTypeVar(right) && !!right.shared.recursiveAlias);
        const aliases =
            leftAlias?.shared === rightAlias?.shared ? [leftAlias?.shared] : [leftAlias?.shared, rightAlias?.shared];
        for (const alias of aliases) {
            if (!alias) continue;
            const count = aliasSpecializations.get(alias) ?? 0;
            if (count >= maxSubtypesForInferredType) {
                recursiveBudgetExceeded = true;
                return false;
            }
            aliasSpecializations.set(alias, count + 1);
        }
        pendingPairs.push({ left, right, depth, isConditional });
        return true;
    };

    // Literal type identity differs from Python value equality: True and 1
    // have distinct literal types, but compare equal inside a tuple.
    const literalEquality = (left: Type, right: Type): boolean | undefined => {
        if (!isClassInstance(left) || !isClassInstance(right) || !isLiteralType(left) || !isLiteralType(right)) {
            return undefined;
        }
        if (ClassType.isBuiltIn(left, ['int', 'bool']) && ClassType.isBuiltIn(right, ['int', 'bool'])) {
            const a = left.priv.literalValue;
            const b = right.priv.literalValue;
            if (
                (typeof a === 'number' || typeof a === 'bigint' || typeof a === 'boolean') &&
                (typeof b === 'number' || typeof b === 'bigint' || typeof b === 'boolean')
            ) {
                return BigInt(a) === BigInt(b);
            }
        }
        if (
            !ClassType.isSameGenericClass(left, right) &&
            ClassType.isBuiltIn(left, ['int', 'bool', 'str', 'bytes']) &&
            ClassType.isBuiltIn(right, ['int', 'bool', 'str', 'bytes'])
        ) {
            return false;
        }
        return undefined;
    };

    const getNumericRepresentation = (type: Type): 'literal' | 'unrepresented' | undefined => {
        if (isTypeVar(type) && type.shared.recursiveAlias) return undefined;
        const concrete = isTypeVar(type) ? evaluator.makeTopLevelTypeVarsConcrete(type) : type;
        const subtypes = isUnion(concrete) ? concrete.priv.subtypes : [concrete];
        if (subtypes.length > maxSubtypesForInferredType) return undefined;
        let representation: 'literal' | 'unrepresented' = 'literal';
        for (const subtype of subtypes) {
            if (!isClassInstance(subtype) || !ClassType.isBuiltIn(subtype, ['int', 'bool', 'float', 'complex'])) {
                return undefined;
            }
            if (ClassType.isBuiltIn(subtype, ['float', 'complex'])) representation = 'unrepresented';
        }
        return representation;
    };

    // float and complex values have no Literal representation. Propagate that
    // distinction through nesting without reconstructing initializer values.
    // Other unknown equality still requires each reachable element contract.
    type Equality = boolean | 'unrepresented' | undefined;
    const equalityResults = new Map<Type, Map<Type, { depth: number; value: Equality }>>();
    const getEquality = (left: Type, right: Type, depth: number): Equality => {
        if (depth > maxTypeRecursionCount) return undefined;
        let rights = equalityResults.get(left);
        if (!rights) {
            rights = new Map();
            equalityResults.set(left, rights);
        }
        const cached = rights.get(right);
        if (cached && cached.depth <= depth) return cached.value;
        // An active cycle is unknown; a depth-limited result must not replace
        // the more complete result of a shallower visit.
        const entry: { depth: number; value: Equality } = { depth, value: undefined };
        rights.set(right, entry);
        entry.value = getEqualityUncached(left, right, depth);
        return entry.value;
    };
    const getEqualityUncached = (left: Type, right: Type, depth: number): Equality => {
        const equal = literalEquality(left, right);
        if (equal !== undefined) return equal;
        // Compare singleton types directly, but keep tuple graphs on the
        // memoized element path rather than unfolding them in isTypeSame.
        if (
            (isNoneInstance(left) ||
                (isClassInstance(left) &&
                    (isLiteralType(left) ||
                        ['types.EllipsisType', 'types.NotImplementedType'].includes(left.shared.fullName)))) &&
            isTypeSame(left, right)
        )
            return true;
        const leftNumeric = getNumericRepresentation(left);
        const rightNumeric = leftNumeric ? getNumericRepresentation(right) : undefined;
        if (leftNumeric && rightNumeric && (leftNumeric === 'unrepresented' || rightNumeric === 'unrepresented')) {
            return 'unrepresented';
        }
        if (!isClassInstance(left) || !isClassInstance(right)) return undefined;
        if (isTupleClass(left) && isTupleClass(right)) {
            const leftArgs = left.priv.tupleTypeArgs;
            const rightArgs = right.priv.tupleTypeArgs;
            if (
                !leftArgs ||
                !rightArgs ||
                leftArgs.some((arg) => arg.isUnbounded || arg.isOptional) ||
                rightArgs.some((arg) => arg.isUnbounded || arg.isOptional)
            ) {
                return undefined;
            }
            if (leftArgs.length !== rightArgs.length) return false;
            let allEqual = true;
            let unrepresentedEquality = false;
            for (let index = 0; index < leftArgs.length; index++) {
                const equality = getEquality(leftArgs[index].type, rightArgs[index].type, depth + 1);
                if (equality === false) return false;
                allEqual &&= equality === true;
                unrepresentedEquality ||= equality === 'unrepresented';
            }
            return allEqual ? true : unrepresentedEquality ? 'unrepresented' : undefined;
        }
        if (
            isLiteralType(left) &&
            isLiteralType(right) &&
            ClassType.isSameGenericClass(left, right) &&
            (typeof left.priv.literalValue === 'string' ||
                typeof left.priv.literalValue === 'number' ||
                typeof left.priv.literalValue === 'bigint' ||
                typeof left.priv.literalValue === 'boolean') &&
            left.priv.literalValue !== right.priv.literalValue
        )
            return false;
        return undefined;
    };

    const getTupleLiteralItems = (
        expression: ExpressionNode | undefined,
        args: TupleTypeArg[]
    ): ExpressionNode[] | undefined => {
        if (
            expression?.nodeType !== ParseNodeType.Tuple ||
            args.length > maxSubtypesForInferredType ||
            expression.d.items.length !== args.length ||
            // Earlier comparisons can expose a chained middle operand to user code.
            (errorNode.nodeType === ParseNodeType.BinaryOperation &&
                !errorNode.d.hasParens &&
                errorNode.parent?.nodeType === ParseNodeType.BinaryOperation &&
                errorNode.parent.d.rightExpr === errorNode &&
                operatorSupportsChaining(errorNode.parent.d.operator)) ||
            expression.d.items.some(
                (item, index) =>
                    item.nodeType === ParseNodeType.Unpack || args[index].isUnbounded || args[index].isOptional
            )
        ) {
            return undefined;
        }
        return expression.d.items;
    };

    const canOrderArgs = (
        leftArgs: TupleTypeArg[],
        rightArgs: TupleTypeArg[],
        recursionCount: number,
        isConditional: boolean
    ): boolean => {
        // When both tuples begin with an arbitrary run of the same literal,
        // a fixed run of that literal immediately afterward only changes the
        // minimum lengths. Both relative run lengths are still unbounded, so
        // the set of reachable suffix alignments is unchanged. This does not
        // apply when only one operand has an unbounded prefix.
        if (
            leftArgs[0]?.isUnbounded &&
            rightArgs[0]?.isUnbounded &&
            getEquality(leftArgs[0].type, rightArgs[0].type, 0) === true
        ) {
            const collapse = (args: TupleTypeArg[]): TupleTypeArg[] => {
                let index = 1;
                while (
                    index < args.length &&
                    !args[index].isUnbounded &&
                    !args[index].isOptional &&
                    getEquality(args[0].type, args[index].type, 0) === true
                )
                    index++;
                return index > 1 ? [args[0], ...args.slice(index)] : args;
            };
            leftArgs = collapse(leftArgs);
            rightArgs = collapse(rightArgs);
        }
        // If every possible element pair has a bool contract, alignment cannot
        // change validity or the result. Prove this before expanding a large
        // variadic suffix into a quadratic number of positions. Only flat
        // declared classes enter this proof, so it cannot queue nested work.
        const flat = (type: Type): boolean =>
            isUnion(type)
                ? type.priv.subtypes.every(flat)
                : isClassInstance(type) && !isTupleClass(type) && !ClassType.isBuiltIn(type, 'list');
        if (
            leftArgs.length &&
            rightArgs.length &&
            leftArgs.every((arg) => flat(arg.type)) &&
            rightArgs.every((arg) => flat(arg.type))
        ) {
            const start = resultTypes.length;
            const valid = canOrderElementsUncached(
                combineTypes(leftArgs.map((arg) => arg.type)),
                combineTypes(rightArgs.map((arg) => arg.type)),
                recursionCount + 1,
                isConditional
            );
            if (valid && resultTypes.length > start) {
                if (
                    resultTypes.slice(start).every((type) => isClassInstance(type) && ClassType.isBuiltIn(type, 'bool'))
                ) {
                    resultTypes.length = start;
                    resultTypes.push(boolType);
                    return true;
                }
                const homogeneous = (args: TupleTypeArg[]): boolean =>
                    args.every(
                        (arg) =>
                            isClassInstance(arg.type) &&
                            !arg.type.shared.typeParams.length &&
                            !arg.type.priv.typeArgs?.length &&
                            !arg.type.priv.tupleTypeArgs &&
                            arg.type.priv.literalValue === undefined &&
                            !ClassType.isTypedDictClass(arg.type) &&
                            !getTypeAliasInfo(arg.type) &&
                            !getTypeCondition(arg.type)?.length &&
                            !arg.type.props?.inferredTupleLiteral &&
                            isTypeSame(args[0].type, arg.type, { honorCallBehavior: true })
                    );
                if (
                    leftArgs[0].isUnbounded &&
                    rightArgs[0].isUnbounded &&
                    homogeneous(leftArgs) &&
                    homogeneous(rightArgs) &&
                    getEquality(leftArgs[0].type, rightArgs[0].type, recursionCount + 1) === undefined
                ) {
                    // Every reachable pair has this same closed contract. The
                    // unbounded prefixes can also be equal or differ in length.
                    resultTypes.push(boolType);
                    return true;
                }
            }
            resultTypes.length = start;
        }
        // An unbounded argument can consume zero or more positions.
        // Check every reachable alignment before accepting tuple ordering.
        const leftItems = recursionCount === 0 ? getTupleLiteralItems(leftExpression, leftArgs) : undefined;
        const rightItems = recursionCount === 0 ? getTupleLiteralItems(rightExpression, rightArgs) : undefined;
        const pending: [number, number, boolean][] = [[0, 0, isConditional]];
        const visited = new Set<string>();

        while (pending.length > 0) {
            evaluator.checkForCancellation();
            const [leftIndex, rightIndex, conditional] = pending.pop()!;
            const position = `${leftIndex},${rightIndex},${conditional}`;
            if (visited.has(position)) {
                continue;
            }
            visited.add(position);

            if (leftIndex === leftArgs.length || rightIndex === rightArgs.length) {
                resultTypes.push(boolType);
                continue;
            }

            const leftArg = leftArgs[leftIndex];
            const rightArg = rightArgs[rightIndex];
            if (leftArg.isUnbounded || leftArg.isOptional) {
                pending.push([leftIndex + 1, rightIndex, conditional]);
            }
            if (rightArg.isUnbounded || rightArg.isOptional) {
                pending.push([leftIndex, rightIndex + 1, conditional]);
            }

            let equality = getEquality(leftArg.type, rightArg.type, recursionCount + 1);
            const leftItem = equality !== true ? leftItems?.[leftIndex] : undefined;
            const rightItem = equality !== true ? rightItems?.[rightIndex] : undefined;
            const leftList = leftItem?.nodeType === ParseNodeType.List ? leftItem : undefined;
            const rightList = rightItem?.nodeType === ParseNodeType.List ? rightItem : undefined;
            const emptyListPair =
                leftList &&
                rightList &&
                (!leftList.d.items.length || !rightList.d.items.length) &&
                isClassInstance(leftArg.type) &&
                isClassInstance(rightArg.type) &&
                ClassType.isBuiltIn(leftArg.type, 'list') &&
                ClassType.isBuiltIn(rightArg.type, 'list');
            if (emptyListPair) {
                // An unpack or comprehension can still produce an empty list.
                const firstKind = (leftList.d.items[0] ?? rightList.d.items[0])?.nodeType;
                if (firstKind === undefined) {
                    equality = true;
                } else if (firstKind !== ParseNodeType.Unpack && firstKind !== ParseNodeType.Comprehension) {
                    equality = false;
                }
            }
            if (
                equality !== true &&
                !leftList &&
                !rightList &&
                !leftArg.isUnbounded &&
                !rightArg.isUnbounded &&
                !leftArg.isOptional &&
                !rightArg.isOptional &&
                sameReferenceAt(leftIndex, rightIndex, recursionCount)
            ) {
                equality = true;
            }
            const unrepresented = equality === 'unrepresented';
            if (equality !== true) {
                if (emptyListPair) {
                    // A nominal list can be a subclass whose __eq__ mutates the other operand.
                    resultTypes.push(boolType);
                } else if (
                    !canOrderElements(
                        leftArg.type,
                        rightArg.type,
                        recursionCount + 1,
                        conditional || (unrepresented && !!getNumericRepresentation(leftArg.type))
                    )
                ) {
                    return false;
                }
            }
            if (equality === false) continue;

            // Unrepresented numeric equality can still reach a custom suffix.
            // Preserve its results, using the old contract if a conditional call fails.
            const nextConditional = conditional || unrepresented;
            pending.push([leftIndex + 1, rightIndex + 1, nextConditional]);
            if (leftArg.isUnbounded) {
                pending.push([leftIndex, rightIndex + 1, nextConditional]);
            }
            if (rightArg.isUnbounded) {
                pending.push([leftIndex + 1, rightIndex, nextConditional]);
            }
        }
        return true;
    };

    const ordered = canOrderArgs(
        leftType.priv.tupleTypeArgs!,
        rightType.priv.tupleTypeArgs!,
        0,
        /* isConditional */ false
    );
    if (!ordered) return recursiveBudgetExceeded ? getRecursiveBudgetFallback() : undefined;
    if (identityBudgetExceeded) {
        return getDeclaredContractResult();
    }
    // Reach seed elements before expanding another recursive tail.
    for (let index = 0; index < pendingPairs.length; index++) {
        evaluator.checkForCancellation();
        const pair = pendingPairs[index];
        const valid = canOrderElementsUncached(pair.left, pair.right, pair.depth, pair.isConditional);
        if (recursiveBudgetExceeded) return getRecursiveBudgetFallback();
        if (!valid) {
            if (!pair.isConditional) return undefined;
            requiresDeclaredContract = true;
        }
    }
    if (requiresDeclaredContract) {
        const declaredResult = getDeclaredContractResult();
        return declaredResult ? combineTypes([...resultTypes, declaredResult]) : undefined;
    }
    // A length comparison contributes an unconditional bool. It also covers
    // conditional bool results from constrained receiver types.
    if (resultTypes.some((type) => isTypeSame(type, boolType))) {
        return combineTypes([
            ...resultTypes.filter((type) => !(isClassInstance(type) && ClassType.isBuiltIn(type, 'bool'))),
            boolType,
        ]);
    }
    return combineTypes(resultTypes);
}
