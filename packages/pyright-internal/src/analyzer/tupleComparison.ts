/*
 * tupleComparison.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Operation-local views for lexicographic tuple comparison.
 */

import { ExpressionNode, NameNode, ParseNodeType } from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { getFlowNode, getInfoReader } from './analyzerNodeInfo';
import { FlowAssignment, FlowFlags, FlowLabel, FlowNode, FlowWildcardImport } from './codeFlowTypes';
import { operatorSupportsChaining } from './parseTreeUtils';
import { ScopeType } from './scope';
import { TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    MemberAccessFlags,
    convertToInstance,
    getTypeCondition,
    isLiteralType,
    isNoneInstance,
    isTupleClass,
    lookUpClassMember,
    specializeTupleClass,
} from './typeUtils';
import {
    ClassType,
    combineTypes,
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
    const leftExpression = errorNode.nodeType === ParseNodeType.BinaryOperation ? errorNode.d.leftExpr : undefined;
    let rightExpression = errorNode.nodeType === ParseNodeType.BinaryOperation ? errorNode.d.rightExpr : undefined;
    if (
        rightExpression?.nodeType === ParseNodeType.BinaryOperation &&
        !rightExpression.d.hasParens &&
        operatorSupportsChaining(rightExpression.d.operator)
    ) {
        rightExpression = rightExpression.d.leftExpr;
    }
    const type = inferTupleComparison(
        evaluator,
        leftType,
        rightType,
        operator,
        errorNode,
        leftExpression,
        rightExpression
    );
    return type ? { type } : undefined;
}

// Validate lexicographic ordering without changing either operand's narrowed
// type. Memoize repeated type pairs and visit each alignment only once.
function inferTupleComparison(
    evaluator: TypeEvaluator,
    leftType: ClassType,
    rightType: ClassType,
    operator: OperatorType,
    errorNode: ExpressionNode,
    leftExpression?: ExpressionNode,
    rightExpression?: ExpressionNode
): Type | undefined {
    // Presence and successful binding are separate facts. A failed call to a
    // present user method does not mean Python will try the reflected method.
    const callMethod = (
        receiver: Type,
        name: string,
        args: TypeResult[],
        node: ExpressionNode,
        _context: undefined
    ): { kind: 'success'; result: TypeResult } | { kind: 'missing' | 'invalid' } => {
        const result = evaluator.getTypeOfMagicMethodCall(receiver, name, args, node, undefined);
        if (result) return { kind: 'success', result };
        const cls = isClass(receiver)
            ? TypeBase.isInstance(receiver)
                ? ClassType.cloneAsInstantiable(receiver)
                : receiver.shared.effectiveMetaclass
            : undefined;
        const member =
            cls && isInstantiableClass(cls)
                ? lookUpClassMember(cls, name, MemberAccessFlags.SkipInstanceMembers)
                : undefined;
        return { kind: member ? 'invalid' : 'missing' };
    };
    const resultTypes: Type[] = [];
    const reflectionOrder = new Map<ClassType['shared'], Map<ClassType['shared'], boolean>>();
    const boolType = evaluator.getBuiltInObject(errorNode, 'bool');
    const comparedPairs = new Map<Type, Set<Type>>();
    const pendingPairs: { left: Type; right: Type; depth: number; leftSources: Sources; rightSources: Sources }[] = [];

    // Keep value provenance local to this operation. It must not participate in
    // nominal type equivalence, generic specialization or assignment narrowing.
    type Sources = ExpressionNode[] | undefined;
    const nameSourceCache = new Map<NameNode, Sources>();
    const nameSources = (node: NameNode): Sources => {
        if (nameSourceCache.has(node)) return nameSourceCache.get(node);
        nameSourceCache.set(node, undefined);
        const symbol = evaluator.lookUpSymbolRecursive(node, node.d.value, false);
        const initial = getFlowNode(node, getInfoReader(evaluator));
        if (!symbol || symbol.isBeyondExecutionScope || symbol.scope.type === ScopeType.Class || !initial)
            return undefined;
        // A name written through global/nonlocal declarations is shared with
        // another execution scope. Its initializer is not a local value fact.
        // This uses the binder's declarations, without evaluating any callee.
        if (
            symbol.symbol.getDeclarations().some((decl) => {
                if (decl.node.nodeType !== ParseNodeType.Name) return false;
                const binding = evaluator.lookUpSymbolRecursive(decl.node, decl.node.d.value, false);
                return binding?.usesGlobalBinding || binding?.usesNonlocalBinding;
            })
        )
            return undefined;
        const pending = [initial];
        const visited = new Set<number>();
        const values = new Set<ExpressionNode>();
        while (pending.length) {
            evaluator.checkForCancellation();
            const current = pending.pop()!;
            if (visited.has(current.id)) continue;
            visited.add(current.id);
            if (current.flags & (FlowFlags.UnreachableStructural | FlowFlags.UnreachableStaticCondition)) continue;
            if (current.flags & FlowFlags.Start) return undefined;
            if (current.flags & FlowFlags.Assignment) {
                const assignment = current as FlowAssignment;
                const reference = assignment.node;
                if (
                    assignment.targetSymbolId === symbol.symbol.id &&
                    (reference.nodeType === ParseNodeType.Name ||
                        reference.nodeType === ParseNodeType.AssignmentExpression)
                ) {
                    if (current.flags & FlowFlags.Unbind) return undefined;
                    if (reference.nodeType === ParseNodeType.AssignmentExpression) {
                        values.add(reference.d.rightExpr);
                        continue;
                    }
                    const target =
                        reference.parent?.nodeType === ParseNodeType.TypeAnnotation ? reference.parent : reference;
                    const parent = target.parent;
                    if (parent?.nodeType === ParseNodeType.Assignment && parent.d.leftExpr === target)
                        values.add(parent.d.rightExpr);
                    else if (parent?.nodeType === ParseNodeType.AssignmentExpression && parent.d.name === target)
                        values.add(parent.d.rightExpr);
                    else return undefined;
                    continue;
                }
            }
            if (
                current.flags & FlowFlags.WildcardImport &&
                (current as FlowWildcardImport).names.includes(node.d.value)
            )
                return undefined;
            if (current.flags & (FlowFlags.BranchLabel | FlowFlags.LoopLabel | FlowFlags.PostContextManager)) {
                pending.push(...(current as FlowLabel).antecedents);
                continue;
            }
            // Calls retain the checker's ordinary name-binding assumptions.
            // This walk does not inspect callees or change call invalidation.
            if ('antecedent' in current) pending.push((current as FlowNode & { antecedent: FlowNode }).antecedent);
            else return undefined;
        }
        const result = values.size ? [...values] : undefined;
        nameSourceCache.set(node, result);
        return result;
    };
    const sourceCache = new Map<ExpressionNode, Sources>();
    const valueSources = (sources: Sources): Sources => {
        if (!sources) return undefined;
        const result = new Set<ExpressionNode>();
        for (const source of sources) {
            const pending: { node: ExpressionNode; children?: ExpressionNode[] }[] = [{ node: source }];
            while (pending.length) {
                evaluator.checkForCancellation();
                const { node, children } = pending.pop()!;
                if (children) {
                    const values = new Set<ExpressionNode>();
                    for (const child of children) {
                        const resolved = sourceCache.get(child);
                        if (!resolved) return undefined;
                        resolved.forEach((value) => values.add(value));
                    }
                    sourceCache.set(node, [...values]);
                    continue;
                }
                if (sourceCache.has(node)) {
                    if (!sourceCache.get(node)) return undefined;
                    continue;
                }
                // Mark pending nodes before following dependencies. Encountering
                // one again detects a cycle without recursion or a size quota.
                sourceCache.set(node, undefined);
                if (node.nodeType === ParseNodeType.Ternary || node.nodeType === ParseNodeType.AssignmentExpression) {
                    const children =
                        node.nodeType === ParseNodeType.Ternary ? [node.d.ifExpr, node.d.elseExpr] : [node.d.rightExpr];
                    pending.push({ node, children });
                    for (const child of children) pending.push({ node: child });
                    continue;
                }
                if (node.nodeType !== ParseNodeType.Name) {
                    sourceCache.set(node, [node]);
                    continue;
                }
                const dependencies = nameSources(node);
                if (!dependencies) return undefined;
                pending.push({ node, children: dependencies });
                for (let i = dependencies.length - 1; i >= 0; i--) pending.push({ node: dependencies[i] });
            }
            const resolved = sourceCache.get(source);
            if (!resolved) return undefined;
            resolved.forEach((node) => result.add(node));
        }
        return [...result];
    };
    const containerSources = (sources: Sources, nodeType: ParseNodeType.Tuple | ParseNodeType.List): Sources => {
        const values = valueSources(sources);
        return values?.length && values.every((node) => node.nodeType === nodeType) ? values : undefined;
    };
    const tupleSources = (sources: Sources): Sources => containerSources(sources, ParseNodeType.Tuple);
    // Nested tuple inference can widen a scalar initializer even though its
    // immutable slot still contains that literal value. Recover only constant
    // origins here; the declared type remains untouched for other consumers.
    const literalValueType = (type: Type, sources: Sources): Type => {
        if (isClassInstance(type) && isTupleClass(type) && type.priv.tupleTypeArgs) {
            const args = literalArgs(type.priv.tupleTypeArgs, sources);
            if (args !== type.priv.tupleTypeArgs) {
                const precise = ClassType.cloneAsInstance(specializeTupleClass(type, args));
                if (evaluator.assignType(type, precise)) return precise;
            }
        }
        if ((isClassInstance(type) && isLiteralType(type)) || isNoneInstance(type)) return type;
        const values = valueSources(sources);
        if (
            !values?.length ||
            !values.every(
                (node) =>
                    node.nodeType === ParseNodeType.Number ||
                    node.nodeType === ParseNodeType.Constant ||
                    (node.nodeType === ParseNodeType.StringList &&
                        node.d.strings.every((part) => part.nodeType === ParseNodeType.String))
            )
        )
            return type;
        const types = values
            .map((node) => evaluator.getTypeOfExpression(node).type)
            .filter((value) => evaluator.assignType(type, value));
        return types.length &&
            types.every((value) => (isClassInstance(value) && isLiteralType(value)) || isNoneInstance(value))
            ? combineTypes(types)
            : type;
    };
    const elementSources = (sources: Sources, index: number): Sources => {
        if (!sources?.length) return undefined;
        const result: ExpressionNode[] = [];
        for (const source of sources) {
            if (
                source.nodeType !== ParseNodeType.Tuple ||
                source.d.items.some((item) => item.nodeType === ParseNodeType.Unpack)
            )
                return undefined;
            const node = source.d.items[index];
            if (!node) return undefined;
            result.push(node);
        }
        return result;
    };
    // NotImplemented is a dispatch signal; all other return types are values
    // of the comparison expression, including non-boolean values.
    const classifyResult = (type: Type, left: Type, right: Type) => {
        const values: Type[] = [];
        let declines = false;
        evaluator.mapSubtypesExpandTypeVars(
            type,
            { conditionFilter: [...(getTypeCondition(left) ?? []), ...(getTypeCondition(right) ?? [])] },
            (subtype) => {
                if (isClassInstance(subtype) && subtype.shared.fullName === 'types.NotImplementedType') {
                    declines = true;
                } else {
                    values.push(subtype);
                }
                return subtype;
            }
        );
        return { values, declines };
    };

    // Built-in tuple/list annotations use their declared sequence semantics.
    // Explicit subclass types still use their declared methods below. Do not
    // invent hidden overrides or effects that the static operand types omit.
    // Resolve the possible declared-method dispatch results. No callee body
    // or surrounding calls are inspected.
    const cannotOrderResolvedPair = (
        left: Type,
        right: Type,
        recursionCount: number,
        leftSources: Sources,
        rightSources: Sources
    ): boolean => {
        if (isAnyOrUnknown(left) || isAnyOrUnknown(right)) {
            resultTypes.push(isAnyOrUnknown(left) ? left : right);
            return false;
        }
        if (isClassInstance(left) && isClassInstance(right)) {
            if (isTupleClass(left) && isTupleClass(right) && left.priv.tupleTypeArgs && right.priv.tupleTypeArgs) {
                const leftOrigins = tupleSources(leftSources);
                const rightOrigins = tupleSources(rightSources);
                return !canOrderArgs(
                    left.priv.tupleTypeArgs,
                    right.priv.tupleTypeArgs,
                    recursionCount,
                    leftOrigins,
                    rightOrigins
                );
            }
            if (ClassType.isBuiltIn(left, 'list') && ClassType.isBuiltIn(right, 'list')) {
                resultTypes.push(boolType);
                return !canOrderElements(
                    left.priv.typeArgs?.[0] ?? UnknownType.create(),
                    right.priv.typeArgs?.[0] ?? UnknownType.create(),
                    recursionCount + 1
                );
            }
        }
        const runtimeClass = (type: Type) =>
            isClass(type)
                ? TypeBase.isInstance(type)
                    ? ClassType.cloneAsInstantiable(type)
                    : type.shared.effectiveMetaclass
                : undefined;
        const leftClass = runtimeClass(left);
        const rightClass = runtimeClass(right);
        let reflectedFirst = false;
        if (
            leftClass &&
            rightClass &&
            isInstantiableClass(leftClass) &&
            isInstantiableClass(rightClass) &&
            !ClassType.isSameGenericClass(leftClass, rightClass)
        ) {
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
        const inferOrder = (reflected: boolean): Type[] | undefined => {
            const receiver = reflected ? right : left;
            const argument = reflected ? left : right;
            const methods = comparisonMethods[operator];
            const firstName = methods[reflected ? 1 : 0];
            const first = callMethod(receiver, firstName, [{ type: argument }], errorNode, undefined);
            const receiverClass = runtimeClass(receiver);
            const slot =
                receiverClass && isInstantiableClass(receiverClass)
                    ? lookUpClassMember(receiverClass, firstName)
                    : undefined;
            const builtinRefusal =
                first.kind === 'invalid' &&
                slot &&
                isClass(slot.classType) &&
                ClassType.isBuiltIn(slot.classType, ['int', 'float', 'str', 'bytes', 'bytearray', 'tuple', 'list']);
            if (first.kind === 'invalid' && !builtinRefusal) return undefined;
            const values: Type[] = [];
            if (first.kind === 'success') {
                const result = classifyResult(first.result.type, left, right);
                values.push(...result.values);
                if (!result.declines) return values;
            }
            const second = callMethod(argument, methods[reflected ? 0 : 1], [{ type: receiver }], errorNode, undefined);
            if (second.kind !== 'success') {
                // A missing fallback can raise, but it does not erase values
                // returned by a valid first method. Invalid declared argument
                // contracts remain errors rather than dispatch refusals.
                const otherClass = runtimeClass(argument);
                const otherSlot =
                    otherClass && isInstantiableClass(otherClass)
                        ? lookUpClassMember(otherClass, methods[reflected ? 0 : 1])
                        : undefined;
                const builtinFallback =
                    otherSlot &&
                    isClass(otherSlot.classType) &&
                    ClassType.isBuiltIn(otherSlot.classType, [
                        'int',
                        'float',
                        'str',
                        'bytes',
                        'bytearray',
                        'tuple',
                        'list',
                    ]);
                return (second.kind === 'missing' || builtinFallback) && values.length ? values : undefined;
            }
            const result = classifyResult(second.result.type, left, right);
            values.push(...result.values);
            // NotImplemented is never an expression result. If both methods
            // can refuse, the operator can raise; its successful results still
            // have the declared value types. Reject only an all-refusal pair.
            return result.declines && !values.length ? undefined : values;
        };
        const first = inferOrder(reflectedFirst);
        if (!first) return true;
        resultTypes.push(...first);
        return false;
    };

    const canOrderElementsUncached = (
        left: Type,
        right: Type,
        recursionCount: number,
        leftSources?: Sources,
        rightSources?: Sources
    ): boolean => {
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
                    if (!isClass(subtype)) return undefined;
                    const runtime = TypeBase.isInstance(subtype)
                        ? ClassType.cloneAsInstantiable(subtype)
                        : subtype.shared.effectiveMetaclass;
                    if (!runtime || !isInstantiableClass(runtime)) return undefined;
                    const member = lookUpClassMember(runtime, method, MemberAccessFlags.SkipInstanceMembers);
                    // Built-in container annotations do not describe the
                    // element comparison's actual return type. Recurse below.
                    if (member && isClass(member.classType) && ClassType.isBuiltIn(member.classType, ['tuple', 'list']))
                        return undefined;
                    const call = callMethod(subtype, method, [{ type: argument }], errorNode, undefined);
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

        // Expand bounds and constraints before both dispatch and lookup. Keep
        // the evaluator's conditions so correlated constraints are not crossed.
        let valid = true;
        evaluator.mapSubtypesExpandTypeVars(left, undefined, (leftSubtype) => {
            evaluator.mapSubtypesExpandTypeVars(
                right,
                { conditionFilter: getTypeCondition(leftSubtype) },
                (rightSubtype) => {
                    if (!valid) {
                        return rightSubtype;
                    }
                    valid = !cannotOrderResolvedPair(
                        leftSubtype,
                        rightSubtype,
                        recursionCount,
                        leftSources,
                        rightSources
                    );
                    return rightSubtype;
                }
            );
            return leftSubtype;
        });
        return valid;
    };

    // Some recursive aliases grow a type argument at each step, for example
    // Tree[T] = tuple[T, tuple[Tree[list[T]], ...]]. Identity-based memoization
    // alone cannot close that graph. For a structural, single-parameter alias,
    // homogeneous container wrapping preserves its element-order obligations.
    // Check the alias skeleton once and queue each substituted parameter pair.
    const aliasPairs = new Map<
        TypeAliasSharedInfo,
        Map<TypeAliasSharedInfo, { left: TypeVarType; right: TypeVarType }[]>
    >();
    const structuralAliases = new Map<TypeVarType['shared'], boolean>();
    const visitedAliases = new Set<TypeVarType['shared']>();
    const isStructuralAlias = (alias: TypeVarType): boolean => {
        const cached = structuralAliases.get(alias.shared);
        if (cached !== undefined) return cached;
        structuralAliases.set(alias.shared, false);
        const params = alias.shared.recursiveAlias?.typeParams;
        if (params?.length !== 1 || !alias.shared.boundType) return false;
        const parameter = params[0];
        const wrapsParameter = (type: Type): boolean => {
            if (isTypeVar(type)) return isTypeSame(type, parameter);
            if (!isClassInstance(type)) return false;
            if (ClassType.isBuiltIn(type, 'list')) {
                return type.priv.typeArgs?.length === 1 && wrapsParameter(type.priv.typeArgs[0]);
            }
            if (isTupleClass(type)) {
                const args = type.priv.tupleTypeArgs;
                return args?.length === 1 && !args[0].isOptional && wrapsParameter(args[0].type);
            }
            return false;
        };
        const visit = (type: Type): boolean => {
            if (isTypeVar(type)) {
                if (isTypeSame(type, parameter)) return true;
                if (type.shared.recursiveAlias !== alias.shared.recursiveAlias) return false;
                const args = type.props?.typeAliasInfo?.typeArgs;
                return args?.length === 1 && wrapsParameter(args[0]);
            }
            if (!isClassInstance(type)) return false;
            if (isTupleClass(type)) {
                const args = type.priv.tupleTypeArgs;
                return (
                    !!args &&
                    (args.length === 1 || args.every((arg) => !arg.isUnbounded && !arg.isOptional)) &&
                    args.every((arg) => !arg.isOptional && visit(arg.type))
                );
            }
            if (ClassType.isBuiltIn(type, 'list')) {
                return type.priv.typeArgs?.length === 1 && visit(type.priv.typeArgs[0]);
            }
            // Fixed leaf types can contribute their declared comparison result.
            // Generic custom classes could inspect T in a method signature;
            // they are not structural container wrappers.
            return !type.priv.typeArgs?.length;
        };
        const valid = visit(convertToInstance(alias.shared.boundType));
        structuralAliases.set(alias.shared, valid);
        return valid;
    };

    const canOrderElements = (
        left: Type,
        right: Type,
        depth: number,
        leftSources?: Sources,
        rightSources?: Sources
    ): boolean => {
        if (
            !leftSources &&
            !rightSources &&
            isTypeVar(left) &&
            isTypeVar(right) &&
            left.shared.recursiveAlias &&
            right.shared.recursiveAlias
        ) {
            // Recursive specialization can clone equivalent placeholder types.
            // Reuse the evaluator's type equivalence, including alias arguments
            // and conditions, rather than relying only on object identity.
            let byRight = aliasPairs.get(left.shared.recursiveAlias);
            if (!byRight) {
                byRight = new Map();
                aliasPairs.set(left.shared.recursiveAlias, byRight);
            }
            let pairs = byRight.get(right.shared.recursiveAlias);
            if (!pairs) {
                pairs = [];
                byRight.set(right.shared.recursiveAlias, pairs);
            }
            if (pairs.some((pair) => isTypeSame(pair.left, left) && isTypeSame(pair.right, right))) return true;
            pairs.push({ left, right });
        }
        if (
            isTypeVar(left) &&
            isTypeVar(right) &&
            left.shared === right.shared &&
            left.shared.recursiveAlias &&
            isStructuralAlias(left)
        ) {
            const leftArgs = left.props?.typeAliasInfo?.typeArgs;
            const rightArgs = right.props?.typeAliasInfo?.typeArgs;
            if (leftArgs?.length === 1 && rightArgs?.length === 1) {
                canOrderElements(leftArgs[0], rightArgs[0], depth + 1);
                if (visitedAliases.has(left.shared)) return true;
                visitedAliases.add(left.shared);
            }
        }
        // Every reachable pair is checked by the worklist before accepting
        // the operation. Repeated type pairs share that obligation. Recursive
        // container aliases need no arbitrary depth limit or duplicate results.
        if (!leftSources && !rightSources) {
            let rights = comparedPairs.get(left);
            if (!rights) {
                rights = new Set();
                comparedPairs.set(left, rights);
            }
            if (rights.has(right)) return true;
            rights.add(right);
        }
        pendingPairs.push({ left, right, depth, leftSources, rightSources });
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
        return undefined;
    };

    // Python has numeric constants without Literal types (notably complex).
    // Recover equality of immutable tuple-slot constants without widening their
    // types or evaluating calls. Compare int/float values without rounding ints.
    type NumericConstant = [number | bigint, number | bigint];
    const equalNumber = (a: number | bigint, b: number | bigint): boolean => {
        if (typeof a === typeof b) return a === b;
        const integer = typeof a === 'bigint' ? a : (b as bigint);
        const number = typeof a === 'number' ? a : (b as number);
        return Number.isFinite(number) && Number.isInteger(number) && BigInt(number) === integer;
    };
    const equalConstant = (a: NumericConstant, b: NumericConstant) =>
        equalNumber(a[0], b[0]) && equalNumber(a[1], b[1]);
    const numericConstant = (sources: Sources): NumericConstant | undefined => {
        const origins = valueSources(sources);
        if (!origins?.length) return undefined;
        let result: NumericConstant | undefined;
        for (let node of origins) {
            let negative = false;
            while (
                node.nodeType === ParseNodeType.UnaryOperation &&
                (node.d.operator === OperatorType.Add || node.d.operator === OperatorType.Subtract)
            ) {
                negative = negative !== (node.d.operator === OperatorType.Subtract);
                node = node.d.expr;
            }
            let value: NumericConstant;
            if (node.nodeType === ParseNodeType.Number) {
                const number = negative ? -node.d.value : node.d.value;
                value = node.d.isImaginary ? [0, number] : [number, 0];
            } else if (
                node.nodeType === ParseNodeType.Constant &&
                (node.d.constType === KeywordType.True || node.d.constType === KeywordType.False)
            ) {
                value = [node.d.constType === KeywordType.True ? (negative ? -1 : 1) : 0, 0];
            } else return undefined;
            if (result && !equalConstant(result, value)) return undefined;
            result = value;
        }
        return result;
    };
    const numericEquality = (left: Type, right: Type, leftSources: Sources, rightSources: Sources) => {
        if (
            isClassInstance(left) &&
            isClassInstance(right) &&
            ClassType.isBuiltIn(left, ['int', 'bool', 'float', 'complex']) &&
            ClassType.isBuiltIn(right, ['int', 'bool', 'float', 'complex'])
        ) {
            const a = numericConstant(leftSources);
            const b = numericConstant(rightSources);
            if (a && b) return equalConstant(a, b);
        }
        return undefined;
    };

    const definitelyEqual = (
        left: Type,
        right: Type,
        depth: number,
        leftSources: Sources,
        rightSources: Sources
    ): boolean => {
        left = literalValueType(left, leftSources);
        right = literalValueType(right, rightSources);
        if (depth > maxTypeRecursionCount) return false;
        const equal = literalEquality(left, right);
        if (equal !== undefined) return equal;
        const numeric = numericEquality(left, right, leftSources, rightSources);
        if (numeric !== undefined) return numeric;
        if (!isTypeSame(left, right)) return false;
        if ((isClassInstance(left) && isLiteralType(left)) || isNoneInstance(left)) return true;
        if (isClassInstance(left) && ['types.EllipsisType', 'types.NotImplementedType'].includes(left.shared.fullName))
            return true;
        if (!isClassInstance(left) || !isTupleClass(left) || !left.priv.tupleTypeArgs) return false;
        const leftOrigins = tupleSources(leftSources);
        const rightOrigins = tupleSources(rightSources);
        return left.priv.tupleTypeArgs.every(
            (arg, index) =>
                !arg.isUnbounded &&
                !arg.isOptional &&
                definitelyEqual(
                    arg.type,
                    arg.type,
                    depth + 1,
                    elementSources(leftOrigins, index),
                    elementSources(rightOrigins, index)
                )
        );
    };

    // A nested fixed tuple can decide ordering before the outer suffix too.
    // This is an equality fact, independent of which ordering operator is used.
    const definitelyUnequal = (
        left: Type,
        right: Type,
        depth: number,
        leftSources: Sources,
        rightSources: Sources
    ): boolean => {
        if (depth > maxTypeRecursionCount) {
            return false;
        }
        const equal = literalEquality(left, right);
        if (equal !== undefined) return !equal;
        const numeric = numericEquality(left, right, leftSources, rightSources);
        if (numeric !== undefined) return !numeric;
        if (!isClassInstance(left) || !isClassInstance(right)) {
            return false;
        }
        if (isTupleClass(left) && isTupleClass(right)) {
            const leftOrigins = tupleSources(leftSources);
            const rightOrigins = tupleSources(rightSources);
            const leftArgs = left.priv.tupleTypeArgs;
            const rightArgs = right.priv.tupleTypeArgs;
            if (
                !leftArgs ||
                !rightArgs ||
                leftArgs.some((arg) => arg.isUnbounded || arg.isOptional) ||
                rightArgs.some((arg) => arg.isUnbounded || arg.isOptional)
            ) {
                return false;
            }
            return (
                leftArgs.length !== rightArgs.length ||
                leftArgs.some((arg, index) =>
                    definitelyUnequal(
                        arg.type,
                        rightArgs[index].type,
                        depth + 1,
                        elementSources(leftOrigins, index),
                        elementSources(rightOrigins, index)
                    )
                )
            );
        }
        return (
            isLiteralType(left) &&
            isLiteralType(right) &&
            ClassType.isSameGenericClass(left, right) &&
            (typeof left.priv.literalValue === 'string' ||
                typeof left.priv.literalValue === 'number' ||
                typeof left.priv.literalValue === 'bigint' ||
                typeof left.priv.literalValue === 'boolean') &&
            left.priv.literalValue !== right.priv.literalValue
        );
    };

    const pureExpression = (node: ExpressionNode): boolean => {
        if (
            node.nodeType === ParseNodeType.Name ||
            node.nodeType === ParseNodeType.Number ||
            node.nodeType === ParseNodeType.Constant
        ) {
            return true;
        }
        if (node.nodeType === ParseNodeType.StringList) {
            return node.d.strings.every((item) => item.nodeType === ParseNodeType.String);
        }
        if (node.nodeType === ParseNodeType.Tuple || node.nodeType === ParseNodeType.List) {
            return node.d.items.every(pureExpression);
        }
        return false;
    };
    const pureOperands =
        !!leftExpression && !!rightExpression && pureExpression(leftExpression) && pureExpression(rightExpression);
    const sameReferenceAt = (leftIndex: number, rightIndex: number, depth: number): boolean => {
        if (
            !pureOperands ||
            depth !== 0 ||
            leftExpression?.nodeType !== ParseNodeType.Tuple ||
            rightExpression?.nodeType !== ParseNodeType.Tuple
        ) {
            return false;
        }
        const left = leftExpression.d.items[leftIndex];
        const right = rightExpression.d.items[rightIndex];
        if (!left || !right || left.nodeType !== ParseNodeType.Name || right.nodeType !== ParseNodeType.Name) {
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

    // Nested tuple inference can erase literals, and large tuples can lose
    // their shape. Recover immutable scalar initializer values for this
    // operation only; preserve the stored type for other consumers.
    const literalArgs = (args: TupleTypeArg[], sources: Sources): TupleTypeArg[] => {
        if (
            args.every(
                (arg) =>
                    !arg.isUnbounded &&
                    !arg.isOptional &&
                    ((isClassInstance(arg.type) && isLiteralType(arg.type)) || isNoneInstance(arg.type))
            )
        )
            return args;
        const origins = tupleSources(sources);
        if (!origins?.length || origins.some((node) => node.nodeType !== ParseNodeType.Tuple)) return args;
        const tuples = origins.filter((node) => node.nodeType === ParseNodeType.Tuple);
        const length = tuples[0].d.items.length;
        if (
            tuples.some(
                (node) =>
                    node.d.items.length !== length ||
                    node.d.items.some(
                        (item) =>
                            item.nodeType !== ParseNodeType.Number &&
                            item.nodeType !== ParseNodeType.Constant &&
                            item.nodeType !== ParseNodeType.StringList
                    )
            )
        )
            return args;
        const recovered: TupleTypeArg[] = [];
        for (let index = 0; index < length; index++) {
            evaluator.checkForCancellation();
            const types = tuples.map((node) => evaluator.getTypeOfExpression(node.d.items[index]).type);
            if (
                types.some(
                    (type) =>
                        !isNoneInstance(type) &&
                        !(
                            isClassInstance(type) &&
                            ClassType.isBuiltIn(type, ['int', 'float', 'complex', 'bool', 'str', 'bytes'])
                        )
                )
            )
                return args;
            recovered.push({ type: combineTypes(types), isUnbounded: false });
        }
        return recovered;
    };

    const canOrderArgs = (
        leftArgs: TupleTypeArg[],
        rightArgs: TupleTypeArg[],
        recursionCount: number,
        leftSources?: Sources,
        rightSources?: Sources
    ): boolean => {
        leftArgs = literalArgs(leftArgs, leftSources);
        rightArgs = literalArgs(rightArgs, rightSources);
        // A variadic position has no fixed correspondence with initializer
        // syntax. Continue with the type-level alignment proof only.
        if (leftArgs.some((arg) => arg.isUnbounded || arg.isOptional)) leftSources = undefined;
        if (rightArgs.some((arg) => arg.isUnbounded || arg.isOptional)) rightSources = undefined;
        // When both tuples begin with an arbitrary run of the same literal,
        // a fixed run of that literal immediately afterward only changes the
        // minimum lengths. Both relative run lengths are still unbounded, so
        // the set of reachable suffix alignments is unchanged. This does not
        // apply when only one operand has an unbounded prefix.
        if (
            leftArgs[0]?.isUnbounded &&
            rightArgs[0]?.isUnbounded &&
            definitelyEqual(leftArgs[0].type, rightArgs[0].type, 0, undefined, undefined)
        ) {
            const collapse = (args: TupleTypeArg[]): TupleTypeArg[] => {
                let index = 1;
                while (
                    index < args.length &&
                    !args[index].isUnbounded &&
                    !args[index].isOptional &&
                    definitelyEqual(args[0].type, args[index].type, 0, undefined, undefined)
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
                recursionCount + 1
            );
            if (
                valid &&
                resultTypes.length > start &&
                resultTypes.slice(start).every((type) => isClassInstance(type) && ClassType.isBuiltIn(type, 'bool'))
            ) {
                resultTypes.length = start;
                resultTypes.push(boolType);
                return true;
            }
            resultTypes.length = start;
        }
        // An unbounded argument can consume zero or more positions.
        // Check every reachable alignment before accepting tuple ordering.
        const pending = [[0, 0]];
        const visited = new Set<string>();

        while (pending.length > 0) {
            evaluator.checkForCancellation();
            const [leftIndex, rightIndex] = pending.pop()!;
            const position = `${leftIndex},${rightIndex}`;
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
                pending.push([leftIndex + 1, rightIndex]);
            }
            if (rightArg.isUnbounded || rightArg.isOptional) {
                pending.push([leftIndex, rightIndex + 1]);
            }

            const leftOrigins =
                !leftArg.isUnbounded && !leftArg.isOptional ? elementSources(leftSources, leftIndex) : undefined;
            const rightOrigins =
                !rightArg.isUnbounded && !rightArg.isOptional ? elementSources(rightSources, rightIndex) : undefined;
            const leftElement = literalValueType(leftArg.type, leftOrigins);
            const rightElement = literalValueType(rightArg.type, rightOrigins);

            const sameValue =
                definitelyEqual(leftElement, rightElement, recursionCount + 1, leftOrigins, rightOrigins) ||
                (!leftArg.isUnbounded &&
                    !rightArg.isUnbounded &&
                    !leftArg.isOptional &&
                    !rightArg.isOptional &&
                    sameReferenceAt(leftIndex, rightIndex, recursionCount));
            if (
                !sameValue &&
                !canOrderElements(leftElement, rightElement, recursionCount + 1, leftOrigins, rightOrigins)
            ) {
                return false;
            }

            if (
                !sameValue &&
                definitelyUnequal(leftElement, rightElement, recursionCount + 1, leftOrigins, rightOrigins)
            ) {
                continue;
            }

            pending.push([leftIndex + 1, rightIndex + 1]);
            if (leftArg.isUnbounded) {
                pending.push([leftIndex, rightIndex + 1]);
            }
            if (rightArg.isUnbounded) {
                pending.push([leftIndex + 1, rightIndex]);
            }
        }
        return true;
    };

    const leftOrigins = tupleSources(leftExpression ? [leftExpression] : undefined);
    const rightOrigins = tupleSources(rightExpression ? [rightExpression] : undefined);
    const ordered = canOrderArgs(
        leftType.priv.tupleTypeArgs!,
        rightType.priv.tupleTypeArgs!,
        0,
        leftOrigins,
        rightOrigins
    );
    if (!ordered) return undefined;
    while (pendingPairs.length) {
        evaluator.checkForCancellation();
        const pair = pendingPairs.pop()!;
        if (!canOrderElementsUncached(pair.left, pair.right, pair.depth, pair.leftSources, pair.rightSources)) {
            return undefined;
        }
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
