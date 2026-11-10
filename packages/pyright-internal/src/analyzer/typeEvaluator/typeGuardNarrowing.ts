/*
 * typeGuardNarrowing.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper logic shared by type narrowing entry points.
 */

import { assert } from '../../common/debug';
import { ArgCategory, ExpressionNode, NameNode, ParamCategory, ParseNodeType } from '../../parser/parseNodes';
import { KeywordType, OperatorType } from '../../parser/tokenizerTypes';
import { AnalyzerNodeInfoAccessor, getInfoReader } from '../analyzerNodeInfo';
import { ConstraintTracker } from '../constraintTracker';
import { hasStandardEnumConstruction, transformTypeForEnumMember } from '../enums';
import { customMetaclassSupportsMethod } from '../operations';
import { isScopeContainedWithin } from '../scopeUtils';
import { getTypedDictMembersForClass } from '../typedDicts';
import { AssignTypeFlags, EvalFlags, TypeEvaluator } from '../typeEvaluatorTypes';
import {
    AnyType,
    ClassDetailsShared,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    EnumLiteral,
    FunctionType,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isNever,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isUnion,
    isUnpackedTypeVarTuple,
    maxTypeRecursionCount,
    TupleTypeArg,
    Type,
    TypeBase,
    TypedDictEntry,
    TypeVarType,
    UnknownType,
} from '../types';
import {
    addConditionToType,
    ClassMember,
    containsAnyRecursive,
    convertToInstance,
    convertToInstantiable,
    derivesFromStdlibClass,
    doForEachSubtype,
    getSpecializedTupleType,
    getTypeCondition,
    getTypeVarScopeIds,
    getUnknownTypeForCallable,
    isLiteralLikeType,
    isLiteralType,
    isLiteralTypeOrUnion,
    isMaybeDescriptorClass,
    isMaybeDescriptorInstance,
    MemberAccessFlags,
    isNoneInstance,
    isNoneTypeClass,
    isProperty,
    isSentinelLiteral,
    isTupleClass,
    isUnboundedTupleClass,
    lookUpClassMember,
    lookUpObjectMember,
    mapSubtypes,
    selfSpecializeClass,
    someSubtypes,
    specializeTupleClass,
    specializeWithUnknownTypeArgs,
    stripTypeForm,
    transformPossibleRecursiveTypeAlias,
} from '../typeUtils';

export interface EqualsNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode) => { type: Type; isIncomplete?: boolean };
    isMatchingExpression: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
    isMatchingExpressionOrWalrusRhs: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export type EqualsNarrowingInfo = {
    adjIsPositiveTest: boolean;
    isIncomplete: boolean;
} & (
    | { kind: 'literal'; rightType: ClassType }
    | { kind: 'class'; rightType: ClassType }
    | { kind: 'index'; indexType: ClassType; rightType: Type }
);

export interface MemberAccessNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode) => { type: Type; isIncomplete?: boolean };
    isMatchingExpression: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export interface MemberAccessNarrowingInfo {
    kind: 'none' | 'literal';
    adjIsPositiveTest: boolean;
    isIncomplete: boolean;
    memberName: string;
    rightType?: ClassType;
}

export interface LenComparisonNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode, flags?: EvalFlags) => { type: Type; isIncomplete?: boolean };
    isMatchingExpression: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export interface LenComparisonNarrowingInfo {
    tupleLength: number;
    adjIsPositiveTest: boolean;
    isLessThanCheck: boolean;
    isIncomplete: boolean;
}

export interface InOperatorNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode, flags?: EvalFlags) => { type: Type; isIncomplete?: boolean };
    isMatchingExpression: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
    isMatchingExpressionOrWalrusRhs: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export interface InOperatorNarrowingInfo {
    kind: 'container' | 'typedDictKey';
    adjIsPositiveTest: boolean;
    isIncomplete: boolean;
    containerType?: Type;
    typedDictKeyType?: ClassType;
}

export interface NoneEllipsisNarrowingContext {
    isMatchingExpression: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
    isMatchingExpressionOrWalrusRhs: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export interface NoneEllipsisNarrowingInfo {
    kind: 'none' | 'tuple-none' | 'ellipsis';
    adjIsPositiveTest: boolean;
    tupleIndex?: number;
}

export interface TypeIsCallNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode, flags?: EvalFlags) => { type: Type; isIncomplete?: boolean };
    isMatchingExpressionOrWalrusRhs: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
    mapSubtypesExpandTypeVars: (type: Type, callback: (expandedSubtype: Type) => undefined) => void;
}

export interface TypeIsCallNarrowingInfo {
    classTypes: ClassType[];
    adjIsPositiveTest: boolean;
    classTypeVar?: TypeVarType;
    isOrIsNotOperator: boolean;
    allowLegacyEquality: boolean;
    isIncomplete: boolean;
}

export interface IsLiteralOrClassNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode) => { type: Type; isIncomplete?: boolean };
    isMatchingExpressionOrWalrusRhs: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export interface IsLiteralOrClassNarrowingInfo {
    kind: 'literal' | 'class';
    rightType: ClassType;
    adjIsPositiveTest: boolean;
    isIncomplete: boolean;
}

export interface IndexedLiteralNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode) => { type: Type; isIncomplete?: boolean };
    isMatchingExpression: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export interface IndexedLiteralNarrowingInfo {
    kind: 'dict' | 'tuple';
    indexType: ClassType;
    rightType: ClassType;
    adjIsPositiveTest: boolean;
    isIncomplete: boolean;
}

export interface IsInstanceClassTypeInfo {
    classTypes: (ClassType | TypeVarType | FunctionType)[];
    negativeClassTypes: (ClassType | TypeVarType | FunctionType)[];
}

export interface IsInstanceCallNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode, flags?: EvalFlags) => { type: Type; isIncomplete?: boolean };
    getIsInstanceClassTypes: (argType: Type, argExpr: ExpressionNode) => IsInstanceClassTypeInfo | undefined;
    isMatchingExpressionOrWalrusRhs: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export interface IsInstanceCallNarrowingInfo {
    kind: 'narrow' | 'incomplete';
    classTypeList?: (ClassType | TypeVarType | FunctionType)[];
    isInstanceCheck?: boolean;
    isIncomplete: boolean;
}

export interface BoolCallNarrowingContext {
    getTypeOfExpression: (expression: ExpressionNode, flags?: EvalFlags) => { type: Type; isIncomplete?: boolean };
    isMatchingExpressionOrWalrusRhs: (reference: ExpressionNode, expression: ExpressionNode) => boolean;
}

export interface BoolCallNarrowingInfo {
    isIncomplete: boolean;
}

export interface NotExpressionNarrowingInfo {
    innerExpression: ExpressionNode;
    adjIsPositiveTest: boolean;
}

export function getNoneEllipsisNarrowingInfo(
    ctx: NoneEllipsisNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): NoneEllipsisNarrowingInfo | undefined {
    if (testExpression.nodeType !== ParseNodeType.BinaryOperation) {
        return undefined;
    }

    const isOrIsNotOperator =
        testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.IsNot;
    const equalsOrNotEqualsOperator =
        testExpression.d.operator === OperatorType.Equals || testExpression.d.operator === OperatorType.NotEquals;
    if (!isOrIsNotOperator && !equalsOrNotEqualsOperator) {
        return undefined;
    }

    const adjIsPositiveTest =
        testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.Equals
            ? isPositiveTest
            : !isPositiveTest;

    if (
        testExpression.d.rightExpr.nodeType === ParseNodeType.Constant &&
        testExpression.d.rightExpr.d.constType === KeywordType.None
    ) {
        if (ctx.isMatchingExpressionOrWalrusRhs(reference, testExpression.d.leftExpr)) {
            return { kind: 'none', adjIsPositiveTest };
        }

        const leftExpression = testExpression.d.leftExpr;
        if (
            leftExpression.nodeType === ParseNodeType.Index &&
            ctx.isMatchingExpression(reference, leftExpression.d.leftExpr) &&
            leftExpression.d.items.length === 1 &&
            !leftExpression.d.trailingComma &&
            leftExpression.d.items[0].d.argCategory === ArgCategory.Simple &&
            !leftExpression.d.items[0].d.name &&
            leftExpression.d.items[0].d.valueExpr.nodeType === ParseNodeType.Number &&
            leftExpression.d.items[0].d.valueExpr.d.isInteger &&
            !leftExpression.d.items[0].d.valueExpr.d.isImaginary
        ) {
            const indexValue = leftExpression.d.items[0].d.valueExpr.d.value;
            if (typeof indexValue === 'number') {
                return { kind: 'tuple-none', adjIsPositiveTest, tupleIndex: indexValue };
            }
        }
    }

    if (
        testExpression.d.rightExpr.nodeType === ParseNodeType.Ellipsis &&
        ctx.isMatchingExpressionOrWalrusRhs(reference, testExpression.d.leftExpr)
    ) {
        return { kind: 'ellipsis', adjIsPositiveTest };
    }

    return undefined;
}

function isTypeCallBase(callType: Type): boolean {
    return isInstantiableClass(callType) && ClassType.isBuiltIn(callType, 'type');
}

export function getTypeIsCallNarrowingInfo(
    ctx: TypeIsCallNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): TypeIsCallNarrowingInfo | undefined {
    if (testExpression.nodeType !== ParseNodeType.BinaryOperation) {
        return undefined;
    }

    const isOrIsNotOperator =
        testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.IsNot;
    const equalsOrNotEqualsOperator =
        testExpression.d.operator === OperatorType.Equals || testExpression.d.operator === OperatorType.NotEquals;
    if (!isOrIsNotOperator && !equalsOrNotEqualsOperator) {
        return undefined;
    }

    const adjIsPositiveTest =
        testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.Equals
            ? isPositiveTest
            : !isPositiveTest;

    let typeCallNode: ExpressionNode | undefined;
    let otherExpr: ExpressionNode | undefined;
    const isTypeCall = (expr: ExpressionNode, referenceExpr?: ExpressionNode): boolean =>
        expr.nodeType === ParseNodeType.Call &&
        expr.d.args.length === 1 &&
        expr.d.args[0].d.argCategory === ArgCategory.Simple &&
        (!referenceExpr || ctx.isMatchingExpressionOrWalrusRhs(referenceExpr, expr.d.args[0].d.valueExpr)) &&
        isTypeCallBase(ctx.getTypeOfExpression(expr.d.leftExpr, EvalFlags.CallBaseDefaults).type);

    if (isTypeCall(testExpression.d.leftExpr, reference)) {
        typeCallNode = testExpression.d.leftExpr;
        otherExpr = testExpression.d.rightExpr;
    } else if (isTypeCall(testExpression.d.rightExpr, reference)) {
        typeCallNode = testExpression.d.rightExpr;
        otherExpr = testExpression.d.leftExpr;
    }

    if (!typeCallNode || !otherExpr) {
        return undefined;
    }

    const otherResult = ctx.getTypeOfExpression(otherExpr);
    const classTypes: ClassType[] = [];
    let isClassType = true;
    let classTypeVar: TypeVarType | undefined;

    if (isTypeVar(otherResult.type) && TypeBase.isInstantiable(otherResult.type)) {
        classTypeVar = convertToInstance(otherResult.type);
    } else if (
        isClassInstance(otherResult.type) &&
        ClassType.isBuiltIn(otherResult.type, 'type') &&
        otherResult.type.priv.typeArgs?.length === 1 &&
        isTypeVar(otherResult.type.priv.typeArgs[0])
    ) {
        classTypeVar = otherResult.type.priv.typeArgs[0];
    }

    ctx.mapSubtypesExpandTypeVars(otherResult.type, (expandedSubtype) => {
        let instantiable: ClassType | undefined;

        if (isClass(expandedSubtype)) {
            if (
                isClassInstance(expandedSubtype) &&
                ClassType.isBuiltIn(expandedSubtype, 'type') &&
                expandedSubtype.priv.typeArgs &&
                expandedSubtype.priv.typeArgs.length > 0
            ) {
                const extracted = expandedSubtype.priv.typeArgs[0];
                if (isInstantiableClass(extracted)) {
                    instantiable = extracted;
                }
            } else if (isInstantiableClass(expandedSubtype)) {
                instantiable = expandedSubtype;
            }
        }

        if (instantiable) {
            classTypes.push(instantiable);
        } else {
            isClassType = false;
        }
        return undefined;
    });

    if (!isClassType || classTypes.length === 0) {
        return undefined;
    }

    const allowLegacyEquality =
        !isOrIsNotOperator &&
        typeCallNode === testExpression.d.leftExpr &&
        ((isInstantiableClass(otherResult.type) &&
            !otherResult.type.priv.includeSubclasses &&
            !otherResult.type.priv.isTypeArgExplicit) ||
            isTypeCall(otherExpr));

    return {
        classTypes,
        classTypeVar,
        adjIsPositiveTest,
        isOrIsNotOperator,
        allowLegacyEquality,
        isIncomplete: !!otherResult.isIncomplete,
    };
}

export function getIsLiteralOrClassNarrowingInfo(
    ctx: IsLiteralOrClassNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): IsLiteralOrClassNarrowingInfo | undefined {
    if (testExpression.nodeType !== ParseNodeType.BinaryOperation) {
        return undefined;
    }

    if (testExpression.d.operator !== OperatorType.Is && testExpression.d.operator !== OperatorType.IsNot) {
        return undefined;
    }

    if (!ctx.isMatchingExpressionOrWalrusRhs(reference, testExpression.d.leftExpr)) {
        return undefined;
    }

    const adjIsPositiveTest = testExpression.d.operator === OperatorType.Is ? isPositiveTest : !isPositiveTest;
    const rightTypeResult = ctx.getTypeOfExpression(testExpression.d.rightExpr);
    const rightType = rightTypeResult.type;

    if (isClassInstance(rightType) && rightType.priv.literalValue !== undefined) {
        return {
            kind: 'literal',
            rightType,
            adjIsPositiveTest,
            isIncomplete: !!rightTypeResult.isIncomplete,
        };
    }

    if (isInstantiableClass(rightType)) {
        return {
            kind: 'class',
            rightType,
            adjIsPositiveTest,
            isIncomplete: !!rightTypeResult.isIncomplete,
        };
    }

    return undefined;
}

export function getIndexedLiteralNarrowingInfo(
    ctx: IndexedLiteralNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): IndexedLiteralNarrowingInfo | undefined {
    if (testExpression.nodeType !== ParseNodeType.BinaryOperation) {
        return undefined;
    }

    if (testExpression.d.operator !== OperatorType.Is && testExpression.d.operator !== OperatorType.IsNot) {
        return undefined;
    }

    if (
        testExpression.d.leftExpr.nodeType !== ParseNodeType.Index ||
        testExpression.d.leftExpr.d.items.length !== 1 ||
        testExpression.d.leftExpr.d.trailingComma ||
        testExpression.d.leftExpr.d.items[0].d.argCategory !== ArgCategory.Simple ||
        !ctx.isMatchingExpression(reference, testExpression.d.leftExpr.d.leftExpr)
    ) {
        return undefined;
    }

    const indexTypeResult = ctx.getTypeOfExpression(testExpression.d.leftExpr.d.items[0].d.valueExpr);
    const indexType = indexTypeResult.type;
    if (!isClassInstance(indexType) || !isLiteralType(indexType)) {
        return undefined;
    }

    const rightTypeResult = ctx.getTypeOfExpression(testExpression.d.rightExpr);
    const rightType = rightTypeResult.type;
    if (!isClassInstance(rightType) || rightType.priv.literalValue === undefined) {
        return undefined;
    }

    const adjIsPositiveTest = testExpression.d.operator === OperatorType.Is ? isPositiveTest : !isPositiveTest;

    if (ClassType.isBuiltIn(indexType, 'str')) {
        return {
            kind: 'dict',
            indexType,
            rightType,
            adjIsPositiveTest,
            isIncomplete: !!indexTypeResult.isIncomplete,
        };
    }

    if (ClassType.isBuiltIn(indexType, 'int')) {
        let canNarrow = false;
        if (ClassType.isBuiltIn(rightType, 'bool')) {
            canNarrow = true;
        } else if (rightType.priv.literalValue instanceof EnumLiteral) {
            canNarrow = true;
        }

        if (canNarrow) {
            return {
                kind: 'tuple',
                indexType,
                rightType,
                adjIsPositiveTest,
                isIncomplete: !!rightTypeResult.isIncomplete,
            };
        }
    }

    return undefined;
}

export function getIsInstanceCallNarrowingInfo(
    ctx: IsInstanceCallNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): IsInstanceCallNarrowingInfo | undefined {
    if (testExpression.nodeType !== ParseNodeType.Call || testExpression.d.args.length !== 2) {
        return undefined;
    }

    const arg0Expr = testExpression.d.args[0].d.valueExpr;
    const arg1Expr = testExpression.d.args[1].d.valueExpr;

    if (!ctx.isMatchingExpressionOrWalrusRhs(reference, arg0Expr)) {
        return undefined;
    }

    const callTypeResult = ctx.getTypeOfExpression(testExpression.d.leftExpr, EvalFlags.CallBaseDefaults);
    const callType = callTypeResult.type;
    if (!isFunction(callType) || !FunctionType.isBuiltIn(callType, ['isinstance', 'issubclass'])) {
        return undefined;
    }

    const isInstanceCheck = FunctionType.isBuiltIn(callType, 'isinstance');
    const arg1TypeResult = ctx.getTypeOfExpression(arg1Expr, EvalFlags.IsInstanceArgDefaults);
    const classTypeInfo = ctx.getIsInstanceClassTypes(arg1TypeResult.type, arg1Expr);
    const isIncomplete = !!callTypeResult.isIncomplete || !!arg1TypeResult.isIncomplete;

    if (classTypeInfo) {
        return {
            kind: 'narrow',
            classTypeList: isPositiveTest ? classTypeInfo.classTypes : classTypeInfo.negativeClassTypes,
            isInstanceCheck,
            isIncomplete,
        };
    }

    if (isIncomplete) {
        return { kind: 'incomplete', isIncomplete: true };
    }

    return undefined;
}

export function getBoolCallNarrowingInfo(
    ctx: BoolCallNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode
): BoolCallNarrowingInfo | undefined {
    if (
        testExpression.nodeType !== ParseNodeType.Call ||
        testExpression.d.args.length !== 1 ||
        testExpression.d.args[0].d.name
    ) {
        return undefined;
    }

    if (!ctx.isMatchingExpressionOrWalrusRhs(reference, testExpression.d.args[0].d.valueExpr)) {
        return undefined;
    }

    const callTypeResult = ctx.getTypeOfExpression(testExpression.d.leftExpr, EvalFlags.CallBaseDefaults);
    const callType = callTypeResult.type;
    if (isInstantiableClass(callType) && ClassType.isBuiltIn(callType, 'bool')) {
        return { isIncomplete: !!callTypeResult.isIncomplete };
    }

    return undefined;
}

export function getNotExpressionNarrowingInfo(
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): NotExpressionNarrowingInfo | undefined {
    if (
        testExpression.nodeType === ParseNodeType.UnaryOperation &&
        testExpression.d.operator === OperatorType.Not &&
        reference !== testExpression
    ) {
        return {
            innerExpression: testExpression.d.expr,
            adjIsPositiveTest: !isPositiveTest,
        };
    }

    return undefined;
}

export function getEqualsNarrowingInfo(
    ctx: EqualsNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): EqualsNarrowingInfo | undefined {
    if (testExpression.nodeType !== ParseNodeType.BinaryOperation) {
        return undefined;
    }

    const equalsOrNotEqualsOperator =
        testExpression.d.operator === OperatorType.Equals || testExpression.d.operator === OperatorType.NotEquals;
    if (!equalsOrNotEqualsOperator) {
        return undefined;
    }

    const adjIsPositiveTest = testExpression.d.operator === OperatorType.Equals ? isPositiveTest : !isPositiveTest;

    if (ctx.isMatchingExpressionOrWalrusRhs(reference, testExpression.d.leftExpr)) {
        const rightTypeResult = ctx.getTypeOfExpression(testExpression.d.rightExpr);
        const rightType = rightTypeResult.type;

        if (isClassInstance(rightType) && rightType.priv.literalValue !== undefined) {
            return {
                kind: 'literal',
                rightType,
                adjIsPositiveTest,
                isIncomplete: !!rightTypeResult.isIncomplete,
            };
        }

        if (isInstantiableClass(rightType)) {
            return {
                kind: 'class',
                rightType,
                adjIsPositiveTest,
                isIncomplete: !!rightTypeResult.isIncomplete,
            };
        }
    }

    if (
        testExpression.d.leftExpr.nodeType === ParseNodeType.Index &&
        testExpression.d.leftExpr.d.items.length === 1 &&
        !testExpression.d.leftExpr.d.trailingComma &&
        testExpression.d.leftExpr.d.items[0].d.argCategory === ArgCategory.Simple &&
        ctx.isMatchingExpression(reference, testExpression.d.leftExpr.d.leftExpr)
    ) {
        const indexTypeResult = ctx.getTypeOfExpression(testExpression.d.leftExpr.d.items[0].d.valueExpr);
        const indexType = indexTypeResult.type;

        if (isClassInstance(indexType) && isLiteralType(indexType) && ClassType.isBuiltIn(indexType, ['str', 'int'])) {
            const rightTypeResult = ctx.getTypeOfExpression(testExpression.d.rightExpr);
            const rightType = rightTypeResult.type;

            if (isLiteralTypeOrUnion(rightType)) {
                return {
                    kind: 'index',
                    indexType,
                    rightType,
                    adjIsPositiveTest,
                    isIncomplete: !!indexTypeResult.isIncomplete || !!rightTypeResult.isIncomplete,
                };
            }
        }
    }

    return undefined;
}

export function getMemberAccessNarrowingInfo(
    ctx: MemberAccessNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): MemberAccessNarrowingInfo | undefined {
    if (testExpression.nodeType !== ParseNodeType.BinaryOperation) {
        return undefined;
    }

    const isOrIsNotOperator =
        testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.IsNot;
    const equalsOrNotEqualsOperator =
        testExpression.d.operator === OperatorType.Equals || testExpression.d.operator === OperatorType.NotEquals;
    if (!isOrIsNotOperator && !equalsOrNotEqualsOperator) {
        return undefined;
    }

    if (
        testExpression.d.leftExpr.nodeType !== ParseNodeType.MemberAccess ||
        !ctx.isMatchingExpression(reference, testExpression.d.leftExpr.d.leftExpr)
    ) {
        return undefined;
    }

    const adjIsPositiveTest =
        testExpression.d.operator === OperatorType.Is || testExpression.d.operator === OperatorType.Equals
            ? isPositiveTest
            : !isPositiveTest;

    if (
        isOrIsNotOperator &&
        testExpression.d.rightExpr.nodeType === ParseNodeType.Constant &&
        testExpression.d.rightExpr.d.constType === KeywordType.None
    ) {
        return {
            kind: 'none',
            memberName: testExpression.d.leftExpr.d.member.d.value,
            adjIsPositiveTest,
            isIncomplete: false,
        };
    }

    const rightTypeResult = ctx.getTypeOfExpression(testExpression.d.rightExpr);
    const rightType = rightTypeResult.type;

    if (isClassInstance(rightType)) {
        const isLiteralEqualsCase =
            equalsOrNotEqualsOperator && (rightType.priv.literalValue !== undefined || isNoneInstance(rightType));
        const isLiteralIdentityCase =
            isOrIsNotOperator &&
            (ClassType.isEnumClass(rightType) || ClassType.isBuiltIn(rightType, 'bool')) &&
            rightType.priv.literalValue !== undefined;

        if (isLiteralEqualsCase || isLiteralIdentityCase) {
            return {
                kind: 'literal',
                memberName: testExpression.d.leftExpr.d.member.d.value,
                rightType,
                adjIsPositiveTest,
                isIncomplete: !!rightTypeResult.isIncomplete,
            };
        }
    }

    return undefined;
}

export function getLenComparisonNarrowingInfo(
    ctx: LenComparisonNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): LenComparisonNarrowingInfo | undefined {
    if (testExpression.nodeType !== ParseNodeType.BinaryOperation) {
        return undefined;
    }

    const comparisonOperator =
        testExpression.d.operator === OperatorType.Equals ||
        testExpression.d.operator === OperatorType.NotEquals ||
        testExpression.d.operator === OperatorType.LessThan ||
        testExpression.d.operator === OperatorType.LessThanOrEqual ||
        testExpression.d.operator === OperatorType.GreaterThan ||
        testExpression.d.operator === OperatorType.GreaterThanOrEqual;
    if (
        !comparisonOperator ||
        testExpression.d.leftExpr.nodeType !== ParseNodeType.Call ||
        testExpression.d.leftExpr.d.args.length !== 1
    ) {
        return undefined;
    }

    const arg0Expr = testExpression.d.leftExpr.d.args[0].d.valueExpr;
    if (!ctx.isMatchingExpression(reference, arg0Expr)) {
        return undefined;
    }

    const callTypeResult = ctx.getTypeOfExpression(testExpression.d.leftExpr.d.leftExpr, EvalFlags.CallBaseDefaults);
    const callType = callTypeResult.type;

    if (!isFunction(callType) || callType.shared.fullName !== 'builtins.len') {
        return undefined;
    }

    const rightTypeResult = ctx.getTypeOfExpression(testExpression.d.rightExpr);
    const rightType = rightTypeResult.type;

    if (
        !isClassInstance(rightType) ||
        typeof rightType.priv.literalValue !== 'number' ||
        rightType.priv.literalValue < 0
    ) {
        return undefined;
    }

    let tupleLength = rightType.priv.literalValue;

    const isLessOrEqual =
        testExpression.d.operator === OperatorType.Equals ||
        testExpression.d.operator === OperatorType.LessThan ||
        testExpression.d.operator === OperatorType.LessThanOrEqual;
    const adjIsPositiveTest = isLessOrEqual ? isPositiveTest : !isPositiveTest;

    if (
        testExpression.d.operator === OperatorType.LessThanOrEqual ||
        testExpression.d.operator === OperatorType.GreaterThan
    ) {
        tupleLength++;
    }

    const isEqualityCheck =
        testExpression.d.operator === OperatorType.Equals || testExpression.d.operator === OperatorType.NotEquals;

    return {
        tupleLength,
        adjIsPositiveTest,
        isLessThanCheck: !isEqualityCheck,
        isIncomplete: !!callTypeResult.isIncomplete || !!rightTypeResult.isIncomplete,
    };
}

export function getInOperatorNarrowingInfo(
    ctx: InOperatorNarrowingContext,
    reference: ExpressionNode,
    testExpression: ExpressionNode,
    isPositiveTest: boolean
): InOperatorNarrowingInfo | undefined {
    if (
        testExpression.nodeType !== ParseNodeType.BinaryOperation ||
        (testExpression.d.operator !== OperatorType.In && testExpression.d.operator !== OperatorType.NotIn)
    ) {
        return undefined;
    }

    const adjIsPositiveTest = testExpression.d.operator === OperatorType.In ? isPositiveTest : !isPositiveTest;

    if (ctx.isMatchingExpressionOrWalrusRhs(reference, testExpression.d.leftExpr)) {
        const rightTypeResult = ctx.getTypeOfExpression(testExpression.d.rightExpr);
        return {
            kind: 'container',
            containerType: rightTypeResult.type,
            adjIsPositiveTest,
            isIncomplete: !!rightTypeResult.isIncomplete,
        };
    }

    if (ctx.isMatchingExpression(reference, testExpression.d.rightExpr)) {
        const leftTypeResult = ctx.getTypeOfExpression(testExpression.d.leftExpr);
        const leftType = leftTypeResult.type;

        if (isClassInstance(leftType) && ClassType.isBuiltIn(leftType, 'str') && isLiteralType(leftType)) {
            return {
                kind: 'typedDictKey',
                typedDictKeyType: ClassType.cloneAsInstantiable(leftType),
                adjIsPositiveTest,
                isIncomplete: !!leftTypeResult.isIncomplete,
            };
        }
    }

    return undefined;
    return undefined;
}
export function narrowTypeForTruthiness(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean) {
    return mapSubtypes(type, (subtype) => {
        if (isPositiveTest) {
            if (evaluator.canBeTruthy(subtype)) {
                return evaluator.removeFalsinessFromType(subtype);
            }
        } else {
            if (evaluator.canBeFalsy(subtype)) {
                return evaluator.removeTruthinessFromType(subtype);
            }
        }
        return undefined;
    });
}

export function narrowTupleTypeForIsNone(
    evaluator: TypeEvaluator,
    type: Type,
    isPositiveTest: boolean,
    indexValue: number
) {
    return evaluator.mapSubtypesExpandTypeVars(type, /* options */ undefined, (subtype) => {
        const tupleType = getSpecializedTupleType(subtype);
        if (!tupleType || isUnboundedTupleClass(tupleType) || !tupleType.priv.tupleTypeArgs) {
            return subtype;
        }

        const tupleLength = tupleType.priv.tupleTypeArgs.length;
        if (indexValue < 0 || indexValue >= tupleLength) {
            return subtype;
        }

        const typeOfEntry = evaluator.makeTopLevelTypeVarsConcrete(tupleType.priv.tupleTypeArgs[indexValue].type);

        if (isPositiveTest) {
            if (!evaluator.assignType(typeOfEntry, evaluator.getNoneType())) {
                return undefined;
            }
        } else {
            if (isNoneInstance(typeOfEntry)) {
                return undefined;
            }
        }

        return subtype;
    });
}

export function narrowTypeForIsNone(evaluator: TypeEvaluator, type: Type, isPositiveTest: boolean) {
    const expandedType = mapSubtypes(type, (subtype) => {
        return transformPossibleRecursiveTypeAlias(subtype);
    });

    let resultIncludesNoneSubtype = false;

    const result = evaluator.mapSubtypesExpandTypeVars(
        expandedType,
        /* options */ undefined,
        (subtype, unexpandedSubtype) => {
            if (isAnyOrUnknown(subtype)) {
                if (isPositiveTest) {
                    resultIncludesNoneSubtype = true;
                    return addConditionToType(evaluator.getNoneType(), subtype.props?.condition);
                }
                return subtype;
            }

            let useExpandedSubtype = false;
            if (isTypeVar(unexpandedSubtype) && !TypeVarType.isSelf(unexpandedSubtype)) {
                if (
                    unexpandedSubtype.shared.constraints.some((constraint) => {
                        return evaluator.assignType(constraint, evaluator.getNoneType());
                    })
                ) {
                    useExpandedSubtype = true;
                }

                if (
                    unexpandedSubtype.shared.boundType &&
                    evaluator.assignType(unexpandedSubtype.shared.boundType, evaluator.getNoneType())
                ) {
                    useExpandedSubtype = true;
                }
            }

            const adjustedSubtype = useExpandedSubtype ? subtype : unexpandedSubtype;
            const newTypeBaseInstance = getInnermostNewTypeBaseInstance(adjustedSubtype);
            if (newTypeBaseInstance && isNoneInstance(newTypeBaseInstance)) {
                resultIncludesNoneSubtype = true;
                return isPositiveTest ? adjustedSubtype : undefined;
            }

            if (isNoneInstance(subtype)) {
                resultIncludesNoneSubtype = true;
                return isPositiveTest ? adjustedSubtype : undefined;
            }

            if (evaluator.assignType(subtype, evaluator.getNoneType())) {
                resultIncludesNoneSubtype = true;
                return isPositiveTest
                    ? addConditionToType(evaluator.getNoneType(), subtype.props?.condition)
                    : adjustedSubtype;
            }

            return isPositiveTest ? undefined : adjustedSubtype;
        }
    );

    if (isPositiveTest && resultIncludesNoneSubtype) {
        return mapSubtypes(result, (subtype) => {
            const baseInstance = getInnermostNewTypeBaseInstance(subtype);
            return isNoneInstance(subtype) || (baseInstance && isNoneInstance(baseInstance)) ? subtype : undefined;
        });
    }

    return result;
}

export function narrowTypeForIsEllipsis(
    evaluator: TypeEvaluator,
    node: ExpressionNode,
    type: Type,
    isPositiveTest: boolean
) {
    const expandedType = mapSubtypes(type, (subtype) => {
        return transformPossibleRecursiveTypeAlias(subtype);
    });

    let resultIncludesEllipsisSubtype = false;

    const ellipsisType =
        evaluator.getBuiltInObject(node, 'EllipsisType') ??
        evaluator.getBuiltInObject(node, 'ellipsis') ??
        AnyType.create();

    const isEllipsisInstance = (subtype: Type) => {
        return isClassInstance(subtype) && ClassType.isBuiltIn(subtype, ['EllipsisType', 'ellipsis']);
    };

    const result = evaluator.mapSubtypesExpandTypeVars(
        expandedType,
        /* options */ undefined,
        (subtype, unexpandedSubtype) => {
            if (isAnyOrUnknown(subtype)) {
                return subtype;
            }

            const adjustedSubtype =
                isTypeVar(unexpandedSubtype) && !TypeVarType.hasConstraints(unexpandedSubtype)
                    ? unexpandedSubtype
                    : subtype;

            const newTypeBaseInstance = getInnermostNewTypeBaseInstance(adjustedSubtype);
            if (newTypeBaseInstance && isEllipsisInstance(newTypeBaseInstance)) {
                resultIncludesEllipsisSubtype = true;
                return isPositiveTest ? adjustedSubtype : undefined;
            }

            if (isEllipsisInstance(subtype)) {
                resultIncludesEllipsisSubtype = true;
                return isPositiveTest ? adjustedSubtype : undefined;
            }

            if (evaluator.assignType(subtype, ellipsisType)) {
                resultIncludesEllipsisSubtype = true;
                return isPositiveTest ? addConditionToType(ellipsisType, subtype.props?.condition) : adjustedSubtype;
            }

            return isPositiveTest ? undefined : adjustedSubtype;
        }
    );

    if (isPositiveTest && resultIncludesEllipsisSubtype) {
        return mapSubtypes(result, (subtype) => {
            const baseInstance = getInnermostNewTypeBaseInstance(subtype);
            return isEllipsisInstance(subtype) || (baseInstance && isEllipsisInstance(baseInstance))
                ? subtype
                : undefined;
        });
    }

    return result;
}

export type NarrowTypeForInstanceOrSubclassInternalCallback = (
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isInstanceCheck: boolean,
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    allowIntersections: boolean,
    errorNode: ExpressionNode,
    nodeInfo: AnalyzerNodeInfoAccessor
) => Type;

export type NarrowTypeForInstanceOrSubclassCallback = (
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isInstanceCheck: boolean,
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    errorNode: ExpressionNode,
    nodeInfo: AnalyzerNodeInfoAccessor
) => Type;

export function getIsInstanceClassTypes(
    evaluator: TypeEvaluator,
    argType: Type,
    argExpr: ExpressionNode
): IsInstanceClassTypeInfo | undefined {
    let foundNonClassType = false;
    const classTypes: (ClassType | TypeVarType | FunctionType)[] = [];
    const negativeClassTypes: (ClassType | TypeVarType | FunctionType)[] = [];

    // Create a helper function that returns a list of class types or
    // undefined if any of the types are not valid.
    const addClassTypesToList = (types: Type[], isAmbiguous: boolean, isUnboundedEntry: boolean) => {
        types.forEach((subtype) => {
            if (isClass(subtype)) {
                subtype = specializeWithUnknownTypeArgs(subtype, evaluator.getTupleClassType());

                if (isInstantiableClass(subtype) && ClassType.isBuiltIn(subtype, 'Callable')) {
                    subtype = convertToInstantiable(getUnknownTypeForCallable());
                } else if (TypeBase.isInstance(subtype) && ClassType.isBuiltIn(subtype, 'type')) {
                    if (subtype.priv.typeArgs && subtype.priv.typeArgs.length > 0) {
                        const typeArg = subtype.priv.typeArgs[0];
                        if (isAnyOrUnknown(typeArg)) {
                            foundNonClassType = true;
                            return;
                        }
                        if (isInstantiableClass(typeArg)) {
                            subtype = ClassType.cloneIncludeSubclasses(typeArg);
                        } else if (isClassInstance(typeArg)) {
                            subtype = ClassType.cloneAsInstantiable(typeArg);
                        }
                    }
                }
            }

            let classType: ClassType | TypeVarType | FunctionType;
            if (isInstantiableClass(subtype)) {
                // If this is a reference to a class that has type promotions (e.g.
                // float or complex), remove the promotions for purposes of the
                // isinstance check).
                if (!subtype.priv.includeSubclasses && subtype.priv.includePromotions) {
                    subtype = ClassType.cloneRemoveTypePromotions(subtype);
                }

                classType = subtype;
            } else if (isTypeVar(subtype) && TypeBase.isInstantiable(subtype)) {
                classType = subtype;
            } else if (isNoneTypeClass(subtype)) {
                assert(isInstantiableClass(subtype));
                classType = subtype;
            } else if (
                isFunction(subtype) &&
                subtype.shared.parameters.length === 2 &&
                subtype.shared.parameters[0].category === ParamCategory.ArgsList &&
                subtype.shared.parameters[1].category === ParamCategory.KwargsDict
            ) {
                classType = subtype;
            } else {
                foundNonClassType = true;
                return;
            }

            classTypes.push(classType);

            // Unbounded entries may be absent, and alternative class objects
            // are not all guaranteed to participate in the runtime check.
            if (!isUnboundedEntry && !isAmbiguous) {
                negativeClassTypes.push(classType);
            }
        });
    };

    const addClassTypesRecursive = (
        type: Type,
        isAmbiguous: boolean,
        isUnboundedEntry: boolean,
        recursionCount: number,
        expression?: ExpressionNode
    ) => {
        if (recursionCount > maxTypeRecursionCount) {
            return;
        }

        // A runtime union checks both operands, but either operand can itself
        // be an alternative class object. Keep their certainty separate.
        if (
            isUnion(type) &&
            expression?.nodeType === ParseNodeType.BinaryOperation &&
            expression.d.operator === OperatorType.BitwiseOr
        ) {
            const leftType = evaluator.getCachedType(expression.d.leftExpr);
            const rightType = evaluator.getCachedType(expression.d.rightExpr);
            if (
                leftType &&
                rightType &&
                !customMetaclassSupportsMethod(leftType, '__or__') &&
                !customMetaclassSupportsMethod(rightType, '__ror__')
            ) {
                // Match the union evaluator's normalization of None operands to NoneType.
                const adjustedLeftType = isNoneInstance(leftType)
                    ? convertToInstantiable(evaluator.getNoneType())
                    : leftType;
                const adjustedRightType = isNoneInstance(rightType)
                    ? convertToInstantiable(evaluator.getNoneType())
                    : rightType;
                addClassTypesRecursive(
                    adjustedLeftType,
                    isAmbiguous,
                    isUnboundedEntry,
                    recursionCount,
                    expression.d.leftExpr
                );
                addClassTypesRecursive(
                    adjustedRightType,
                    isAmbiguous,
                    isUnboundedEntry,
                    recursionCount,
                    expression.d.rightExpr
                );
                return;
            }
        }

        const isRuntimeUnion = type.props?.specialForm && ClassType.isBuiltIn(type.props.specialForm, 'UnionType');
        const isAmbiguousType = isAmbiguous || (isUnion(type) && !isRuntimeUnion);

        doForEachSubtype(type, (subtype) => {
            if (isClassInstance(subtype) && isTupleClass(subtype)) {
                if (subtype.priv.tupleTypeArgs) {
                    let entryExpressions: (ExpressionNode | undefined)[] | undefined;
                    if (expression?.nodeType === ParseNodeType.Tuple) {
                        const expressions: (ExpressionNode | undefined)[] = [];
                        expression.d.items.forEach((item) => {
                            if (item.nodeType !== ParseNodeType.Unpack) {
                                expressions.push(item);
                                return;
                            }
                            const unpackedType = evaluator.getCachedType(item.d.expr);
                            const entryCount =
                                unpackedType && isClassInstance(unpackedType) && isTupleClass(unpackedType)
                                    ? unpackedType.priv.tupleTypeArgs?.length ?? 1
                                    : 1;
                            for (let index = 0; index < entryCount; index++) {
                                expressions.push(undefined);
                            }
                        });
                        if (expressions.length === subtype.priv.tupleTypeArgs.length) {
                            entryExpressions = expressions;
                        }
                    }
                    subtype.priv.tupleTypeArgs.forEach((tupleEntry, index) => {
                        addClassTypesRecursive(
                            tupleEntry.type,
                            isAmbiguousType,
                            isUnboundedEntry || tupleEntry.isUnbounded,
                            recursionCount + 1,
                            entryExpressions?.[index]
                        );
                    });
                }
            } else {
                addClassTypesToList([subtype], isAmbiguousType, isUnboundedEntry);
            }
        });
    };

    addClassTypesRecursive(argType, /* isAmbiguous */ false, /* isUnboundedEntry */ false, 0, argExpr);

    return foundNonClassType ? undefined : { classTypes, negativeClassTypes };
}

export function narrowTypeForInstanceOrSubclass(
    evaluator: TypeEvaluator,
    type: Type,
    filterTypes: Type[],
    isInstanceCheck: boolean,
    isTypeIsCheck: boolean,
    isPositiveTest: boolean,
    errorNode: ExpressionNode,
    nodeInfo: AnalyzerNodeInfoAccessor,
    narrowTypeForInstanceOrSubclassInternalCallback: NarrowTypeForInstanceOrSubclassInternalCallback
) {
    if (!isInstanceCheck && !isTypeIsCheck && !isPositiveTest) {
        filterTypes = filterTypes.filter((filterType) => {
            const concreteFilterType = evaluator.makeTopLevelTypeVarsConcrete(filterType);
            return (
                !isInstantiableClass(concreteFilterType) ||
                !ClassType.isFinal(concreteFilterType) ||
                !customMetaclassSupportsMethod(concreteFilterType, '__subclasscheck__')
            );
        });
    }

    if (!isPositiveTest && filterTypes.length === 0) {
        return type;
    }

    const narrowedType = narrowTypeForInstanceOrSubclassInternalCallback(
        evaluator,
        type,
        filterTypes,
        isInstanceCheck,
        isTypeIsCheck,
        isPositiveTest,
        /* allowIntersections */ false,
        errorNode,
        nodeInfo
    );

    if (!isNever(narrowedType)) {
        return narrowedType;
    }

    return narrowTypeForInstanceOrSubclassInternalCallback(
        evaluator,
        type,
        filterTypes,
        isInstanceCheck,
        isTypeIsCheck,
        isPositiveTest,
        /* allowIntersections */ true,
        errorNode,
        nodeInfo
    );
}

export function narrowTypeForTupleLength(
    evaluator: TypeEvaluator,
    referenceType: Type,
    lengthValue: number,
    isPositiveTest: boolean,
    isLessThanCheck: boolean
) {
    return mapSubtypes(referenceType, (subtype) => {
        const concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        // If it's not a tuple, we can't narrow it.
        if (
            !isClassInstance(concreteSubtype) ||
            !isTupleClass(concreteSubtype) ||
            !concreteSubtype.priv.tupleTypeArgs
        ) {
            return subtype;
        }

        // If the tuple contains a TypeVarTuple, we can't narrow it.
        if (concreteSubtype.priv.tupleTypeArgs.some((typeArg) => isUnpackedTypeVarTuple(typeArg.type))) {
            return subtype;
        }

        // If the tuple contains no unbounded elements, then we know its length exactly.
        if (!concreteSubtype.priv.tupleTypeArgs.some((typeArg) => typeArg.isUnbounded)) {
            const tupleLengthMatches = isLessThanCheck
                ? concreteSubtype.priv.tupleTypeArgs.length < lengthValue
                : concreteSubtype.priv.tupleTypeArgs.length === lengthValue;

            return tupleLengthMatches === isPositiveTest ? subtype : undefined;
        }

        // The tuple contains a "...". We'll expand this into as many elements as
        // necessary to match the lengthValue.
        const elementsToAdd = lengthValue - concreteSubtype.priv.tupleTypeArgs.length + 1;

        if (!isLessThanCheck) {
            // If the specified length is smaller than the minimum length of this tuple,
            // we can rule it out for a positive test and rule it in for a negative test.
            if (elementsToAdd < 0) {
                return isPositiveTest ? undefined : subtype;
            }

            if (!isPositiveTest) {
                // If this is an equality check for the minimum length (e.g.
                // "len(x) == 0"), we can expand the minimum length by one).
                const minLen = concreteSubtype.priv.tupleTypeArgs.length - 1;
                if (lengthValue === minLen) {
                    return expandUnboundedTupleElement(concreteSubtype, 1, /* keepUnbounded */ true);
                }
                return subtype;
            }

            return expandUnboundedTupleElement(concreteSubtype, elementsToAdd, /* keepUnbounded */ false);
        }

        // If this is a tuple related to an "*args: P.args" parameter, don't expand it.
        if (isParamSpec(subtype) && subtype.priv.paramSpecAccess) {
            return subtype;
        }

        // Place an upper limit on the number of union subtypes we
        // will expand the tuple to.
        const maxTupleUnionExpansion = 32;
        if (elementsToAdd > maxTupleUnionExpansion) {
            return subtype;
        }

        if (isPositiveTest) {
            if (elementsToAdd < 1) {
                return undefined;
            }

            const typesToCombine: Type[] = [];

            for (let i = 0; i < elementsToAdd; i++) {
                typesToCombine.push(expandUnboundedTupleElement(concreteSubtype, i, /* keepUnbounded */ false));
            }

            return combineTypes(typesToCombine);
        }

        return expandUnboundedTupleElement(concreteSubtype, elementsToAdd, /* keepUnbounded */ true);
    });
}

function expandUnboundedTupleElement(tupleType: ClassType, elementsToAdd: number, keepUnbounded: boolean) {
    const tupleTypeArgs: TupleTypeArg[] = [];

    tupleType.priv.tupleTypeArgs!.forEach((typeArg) => {
        if (!typeArg.isUnbounded) {
            tupleTypeArgs.push(typeArg);
        } else {
            for (let i = 0; i < elementsToAdd; i++) {
                tupleTypeArgs.push({ isUnbounded: false, type: typeArg.type });
            }

            if (keepUnbounded) {
                tupleTypeArgs.push(typeArg);
            }
        }
    });

    return specializeTupleClass(tupleType, tupleTypeArgs);
}

export function narrowTypeForContainerType(
    evaluator: TypeEvaluator,
    referenceType: Type,
    containerType: Type,
    isPositiveTest: boolean
) {
    if (isPositiveTest) {
        const elementType = getElementTypeForContainerNarrowing(containerType);
        if (!elementType) {
            return referenceType;
        }

        return narrowTypeForContainerElementType(
            evaluator,
            referenceType,
            evaluator.makeTopLevelTypeVarsConcrete(elementType)
        );
    }

    // Narrowing in the negative case is possible only with tuples
    // with a known length.
    if (
        !isClassInstance(containerType) ||
        !ClassType.isBuiltIn(containerType, 'tuple') ||
        !containerType.priv.tupleTypeArgs
    ) {
        return referenceType;
    }

    // Determine which tuple types can be eliminated. Only "None",
    // literal types, and final instantiable classes can be handled here.
    // Non-final instantiable classes (type[A]) cannot be eliminated in negative
    // tests because a subclass SubA(A) reaches the negative branch at runtime
    // (since SubA != A). Generic classes are also excluded because a
    // specialized class object like Box[int] is not the same runtime object
    // as Box. Classes that define or inherit __class_getitem__ are excluded
    // for the same reason.
    const typesToEliminate: Type[] = [];
    containerType.priv.tupleTypeArgs.forEach((tupleEntry) => {
        if (!tupleEntry.isUnbounded) {
            if (isNoneInstance(tupleEntry.type)) {
                typesToEliminate.push(tupleEntry.type);
            } else if (isClassInstance(tupleEntry.type) && isLiteralType(tupleEntry.type)) {
                typesToEliminate.push(tupleEntry.type);
            } else if (
                isInstantiableClass(tupleEntry.type) &&
                ClassType.isFinal(tupleEntry.type) &&
                tupleEntry.type.shared.typeParams.length === 0 &&
                !lookUpClassMember(tupleEntry.type, '__class_getitem__')
            ) {
                typesToEliminate.push(tupleEntry.type);
            }
        }
    });

    if (typesToEliminate.length === 0) {
        return referenceType;
    }

    const canNarrowLiterals = typesToEliminate.some(isClassInstance);

    return mapSubtypes(referenceType, (unexpandedSubtype) => {
        const referenceSubtype = evaluator.makeTopLevelTypeVarsConcrete(unexpandedSubtype);
        if (
            canNarrowLiterals &&
            isClassInstance(referenceSubtype) &&
            referenceSubtype.priv.literalValue === undefined
        ) {
            // If we're able to enumerate all possible literal values
            // (for bool or enum), we can eliminate all others in a negative test.
            const allLiteralTypes = enumerateLiteralsForType(evaluator, referenceSubtype);
            if (allLiteralTypes && allLiteralTypes.length > 0) {
                return combineTypes(
                    allLiteralTypes.filter((type) => !typesToEliminate.some((t) => isTypeSame(t, type)))
                );
            }
        }

        if (typesToEliminate.some((t) => isTypeSame(t, referenceSubtype))) {
            return undefined;
        }

        return unexpandedSubtype;
    });
}

export function getElementTypeForContainerNarrowing(containerType: Type): Type | undefined {
    if (isUnion(containerType)) {
        const elementTypes: Type[] = [];
        for (const subtype of containerType.priv.subtypes) {
            const elemType = getElementTypeForContainerNarrowing(subtype);
            // Don't narrow if any subtype's element type is unknown or includes an
            // unpacked TypeVarTuple (e.g. tuple[*Ts]), whose elements could be anything.
            if (!elemType || someSubtypes(elemType, (t) => isAnyOrUnknown(t) || isUnpackedTypeVarTuple(t))) {
                return undefined;
            }
            elementTypes.push(elemType);
        }
        return combineTypes(elementTypes);
    }

    if (!isClassInstance(containerType)) {
        return undefined;
    }

    // We support contains narrowing only for certain built-in types that have been specialized.
    // Abstract collection types (e.g. Sequence, Container, KeysView) are intentionally excluded
    // because their __contains__ implementations are not constrained to the element type.
    const supportedContainers = ['list', 'set', 'frozenset', 'deque', 'tuple', 'dict', 'defaultdict', 'OrderedDict'];

    // The concrete dict view types returned by dict.keys() and dict.values().
    const supportedDictViews = ['_collections_abc.dict_keys', '_collections_abc.dict_values'];

    const isSupported =
        ClassType.isBuiltIn(containerType, supportedContainers) ||
        supportedDictViews.includes(containerType.shared.fullName);

    if (!isSupported) {
        return undefined;
    }

    if (!containerType.priv.typeArgs || containerType.priv.typeArgs.length < 1) {
        return undefined;
    }

    if (containerType.shared.fullName === '_collections_abc.dict_values') {
        return containerType.priv.typeArgs.length > 1 ? containerType.priv.typeArgs[1] : undefined;
    }

    if (isTupleClass(containerType) && containerType.priv.tupleTypeArgs) {
        return combineTypes(containerType.priv.tupleTypeArgs.map((t) => t.type));
    }

    return containerType.priv.typeArgs[0];
}

function getStringLiteralForStrEnumMember(enumMember: ClassType): ClassType | undefined {
    const literalValue = enumMember.priv.literalValue;
    if (
        !(literalValue instanceof EnumLiteral) ||
        !ClassType.isEnumClass(enumMember) ||
        !derivesFromStdlibClass(enumMember, 'str') ||
        ClassType.isEnumMemberSetMayBeIncomplete(enumMember) ||
        !hasStandardEnumConstruction(enumMember)
    ) {
        return undefined;
    }

    const equalityMember = lookUpObjectMember(
        enumMember,
        '__eq__',
        MemberAccessFlags.SkipObjectBaseClass | MemberAccessFlags.SkipInstanceMembers
    );
    if (
        !equalityMember ||
        !isClass(equalityMember.classType) ||
        !ClassType.isBuiltIn(equalityMember.classType, 'str')
    ) {
        return undefined;
    }

    const valueType = literalValue.itemType;
    if (isClassInstance(valueType) && isLiteralType(valueType) && ClassType.isBuiltIn(valueType, 'str')) {
        return valueType;
    }

    return undefined;
}

export function narrowTypeForContainerElementType(evaluator: TypeEvaluator, referenceType: Type, elementType: Type) {
    return evaluator.mapSubtypesExpandTypeVars(referenceType, /* options */ undefined, (referenceSubtype) => {
        return mapSubtypes(elementType, (elementSubtype) => {
            if (isAnyOrUnknown(elementSubtype)) {
                return referenceSubtype;
            }

            // If the two types are disjoint (i.e. are not comparable), eliminate this subtype.
            if (!evaluator.isTypeComparable(elementSubtype, referenceSubtype)) {
                return undefined;
            }

            if (
                isClassInstance(referenceSubtype) &&
                ClassType.isBuiltIn(referenceSubtype, ['str', 'LiteralString']) &&
                // A plain str type includes subclasses such as StrEnum; only an exact str can become a primitive literal.
                (!referenceSubtype.priv.includeSubclasses || isLiteralType(referenceSubtype)) &&
                isClassInstance(elementSubtype)
            ) {
                const stringLiteral = getStringLiteralForStrEnumMember(elementSubtype);
                // A broad string type can admit the enum member or another equal string subtype,
                // so convert to the primitive literal only when the reference is an exact str.
                if (stringLiteral && evaluator.assignType(referenceSubtype, stringLiteral)) {
                    return stripTypeForm(addConditionToType(stringLiteral, referenceSubtype.props?.condition));
                }
            }

            // If one of the two types is a literal, we can narrow to that type.
            if (
                isClassInstance(elementSubtype) &&
                (isLiteralLikeType(elementSubtype) || isNoneInstance(elementSubtype)) &&
                evaluator.assignType(referenceSubtype, elementSubtype)
            ) {
                // Cross-type equality does not give a primitive the literal's runtime type.
                if (
                    isClassInstance(referenceSubtype) &&
                    ClassType.isBuiltIn(referenceSubtype) &&
                    !ClassType.isBuiltIn(referenceSubtype, ['object', 'LiteralString']) &&
                    isLiteralType(elementSubtype) &&
                    !ClassType.isSameGenericClass(referenceSubtype, elementSubtype)
                ) {
                    return referenceSubtype;
                }

                return stripTypeForm(addConditionToType(elementSubtype, referenceSubtype.props?.condition));
            }

            if (
                isClassInstance(referenceSubtype) &&
                (isLiteralLikeType(referenceSubtype) || isNoneInstance(referenceSubtype)) &&
                evaluator.assignType(elementSubtype, referenceSubtype)
            ) {
                return stripTypeForm(addConditionToType(referenceSubtype, elementSubtype.props?.condition));
            }

            // If the element type is a known class object that is assignable to
            // the reference type, we can narrow to that class object.
            if (
                isInstantiableClass(elementSubtype) &&
                !elementSubtype.priv.includeSubclasses &&
                evaluator.assignType(referenceSubtype, elementSubtype)
            ) {
                return stripTypeForm(addConditionToType(elementSubtype, referenceSubtype.props?.condition));
            }

            // It's not safe to narrow.
            return referenceSubtype;
        });
    });
}

export function narrowTypeForTypedDictKey(
    evaluator: TypeEvaluator,
    referenceType: Type,
    literalKey: ClassType,
    isPositiveTest: boolean
): Type {
    const narrowedType = evaluator.mapSubtypesExpandTypeVars(
        referenceType,
        /* options */ undefined,
        (subtype, unexpandedSubtype) => {
            if (isParamSpec(unexpandedSubtype)) {
                return unexpandedSubtype;
            }

            if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
                const entries = getTypedDictMembersForClass(evaluator, subtype, /* allowNarrowed */ true);
                const knownEntry = entries.knownItems.get(literalKey.priv.literalValue as string);
                const tdEntry = knownEntry ?? entries.extraItems;

                if (isPositiveTest) {
                    // The code that is commented out below implements the behavior that is technically
                    // correct, but until we PEP 728 is ratified and we have a way to express "extra items"
                    // and closed TypedDicts, we'll preserve the older (less correct) behavior to enable
                    // narrowing of TypedDicts based on checks for specific keys.
                    // TODO - remove this behavior once PEP 728 is accepted and the feature is no
                    // longer experimental.
                    if (!tdEntry) {
                        return undefined;
                    }

                    // if (!tdEntry) {
                    //     // If there is no TD entry for this key and no "extra items" defined,
                    //     // we have to assume that the TypedDict may contain extra items, so
                    //     // narrowing it isn't possible in this case.
                    //     return subtype;
                    // }

                    if (isNever(tdEntry.valueType)) {
                        // If the entry is typed as Never or the "extra items" is typed as Never,
                        // then this key cannot be present in the TypedDict, and we can eliminate it.
                        // A closed TypedDict has an "extra items" of Never, so this is what allows
                        // a key check to discriminate between closed TypedDicts.
                        return undefined;
                    }

                    // If the entry is currently not required and not marked provided, we can mark
                    // it as provided after this guard expression confirms it is.
                    if (tdEntry.isRequired || tdEntry.isProvided) {
                        return subtype;
                    }

                    const newNarrowedEntriesMap = new Map<string, TypedDictEntry>(
                        subtype.priv.typedDictNarrowedEntries ?? []
                    );

                    // Add the new entry.
                    newNarrowedEntriesMap.set(literalKey.priv.literalValue as string, {
                        valueType: tdEntry.valueType,
                        isReadOnly: tdEntry.isReadOnly,
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
                    if (!knownEntry) {
                        // The key is not one of the known items, so it can be supplied
                        // only through an "extra items" entry, which says nothing about
                        // whether this particular key is present. Its absence is therefore
                        // consistent with the type, and the subtype cannot be eliminated.
                        return subtype;
                    }

                    return knownEntry.isRequired || knownEntry.isProvided ? undefined : subtype;
                }
            }

            return subtype;
        }
    );

    return narrowedType;
}

export function narrowTypeForDiscriminatedDictEntryComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    indexLiteralType: ClassType,
    literalType: Type,
    isPositiveTest: boolean
): Type {
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
            const symbolMap = getTypedDictMembersForClass(evaluator, subtype);
            const tdEntry = symbolMap.knownItems.get(indexLiteralType.priv.literalValue as string);

            if (tdEntry && isLiteralTypeOrUnion(tdEntry.valueType)) {
                if (isPositiveTest) {
                    let foundMatch = false;

                    doForEachSubtype(literalType, (literalSubtype) => {
                        if (evaluator.assignType(tdEntry.valueType, literalSubtype)) {
                            foundMatch = true;
                        }
                    });

                    return foundMatch ? subtype : undefined;
                } else {
                    let foundNonMatch = false;

                    doForEachSubtype(literalType, (literalSubtype) => {
                        if (!evaluator.assignType(literalSubtype, tdEntry.valueType)) {
                            foundNonMatch = true;
                        }
                    });

                    return foundNonMatch ? subtype : undefined;
                }
            }
        }

        canNarrow = false;
        return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
}

export function narrowTypeForDiscriminatedTupleComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    indexLiteralType: ClassType,
    literalType: Type,
    isPositiveTest: boolean
): Type {
    let canNarrow = true;

    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        if (
            isClassInstance(subtype) &&
            ClassType.isTupleClass(subtype) &&
            !isUnboundedTupleClass(subtype) &&
            typeof indexLiteralType.priv.literalValue === 'number' &&
            isClassInstance(literalType)
        ) {
            const indexValue = indexLiteralType.priv.literalValue;
            if (subtype.priv.tupleTypeArgs && indexValue >= 0 && indexValue < subtype.priv.tupleTypeArgs.length) {
                const tupleEntryType = subtype.priv.tupleTypeArgs[indexValue]?.type;
                if (tupleEntryType && isLiteralTypeOrUnion(tupleEntryType)) {
                    if (isPositiveTest) {
                        return evaluator.assignType(tupleEntryType, literalType) ? subtype : undefined;
                    } else {
                        return evaluator.assignType(literalType, tupleEntryType) ? undefined : subtype;
                    }
                }
            }
        }

        canNarrow = false;
        return subtype;
    });

    return canNarrow ? narrowedType : referenceType;
}

export function narrowTypeForDiscriminatedLiteralFieldComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    memberName: string,
    literalType: ClassType,
    isPositiveTest: boolean
): Type {
    const narrowedType = mapSubtypes(referenceType, (subtype) => {
        let memberInfo: ClassMember | undefined;

        if (isClassInstance(subtype)) {
            memberInfo = lookUpObjectMember(subtype, memberName);
        } else if (isInstantiableClass(subtype)) {
            memberInfo = lookUpClassMember(subtype, memberName);
        }

        if (memberInfo && memberInfo.isTypeDeclared) {
            let memberType = evaluator.getTypeOfMember(memberInfo);

            // Handle the case where the field is a property
            // that has a declared literal return type for its getter.
            if (isClassInstance(subtype) && isClassInstance(memberType) && isProperty(memberType)) {
                const getterType = memberType.priv.fgetInfo?.methodType;
                if (getterType && isFunction(getterType) && getterType.shared.declaredReturnType) {
                    const getterReturnType = FunctionType.getEffectiveReturnType(getterType);
                    if (getterReturnType) {
                        memberType = getterReturnType;
                    }
                }
            }

            if (isLiteralTypeOrUnion(memberType, /* allowNone */ true)) {
                if (isPositiveTest) {
                    return evaluator.assignType(memberType, literalType) ? subtype : undefined;
                } else {
                    return evaluator.assignType(literalType, memberType) ? undefined : subtype;
                }
            }
        }

        return subtype;
    });

    return narrowedType;
}

export function narrowTypeForDiscriminatedFieldNoneComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    memberName: string,
    isPositiveTest: boolean
): Type {
    return mapSubtypes(referenceType, (subtype) => {
        let memberInfo: ClassMember | undefined;
        if (isClassInstance(subtype)) {
            memberInfo = lookUpObjectMember(subtype, memberName);
        } else if (isInstantiableClass(subtype)) {
            memberInfo = lookUpClassMember(subtype, memberName);
        }

        if (memberInfo && memberInfo.isTypeDeclared) {
            // Check the declared type before narrowing, since the member type
            // below will be concretized and lose descriptor identity.
            const declaredType = evaluator.getDeclaredTypeOfSymbol(memberInfo.symbol)?.type;
            if (!declaredType) {
                // isTypeDeclared is true but the type couldn't be resolved (e.g. an
                // unresolvable stub).  Conservatively skip narrowing rather than risk
                // incorrectly eliminating a descriptor-typed member.
                return subtype;
            }
            // Check if any subtype of the declared type is a descriptor or property.
            // isMaybeDescriptorInstance handles declared types in instance form (ClassInstance),
            // while isMaybeDescriptorClass handles declared types in instantiable form
            // (InstantiableClass), which occurs when the annotation refers to the class object itself.
            // This check applies to both positive and negative test paths: descriptor __get__
            // return values don't reflect stored values regardless of test polarity.
            const isDescriptorOrProperty = someSubtypes(
                declaredType,
                (declaredSubtype) =>
                    isProperty(declaredSubtype) ||
                    isMaybeDescriptorInstance(declaredSubtype) ||
                    isMaybeDescriptorClass(declaredSubtype)
            );

            if (isDescriptorOrProperty) {
                return subtype;
            }

            const memberType = evaluator.makeTopLevelTypeVarsConcrete(evaluator.getTypeOfMember(memberInfo));
            let canNarrow = true;

            if (isPositiveTest) {
                doForEachSubtype(memberType, (memberSubtype) => {
                    memberSubtype = evaluator.makeTopLevelTypeVarsConcrete(memberSubtype);

                    if (isAnyOrUnknown(memberSubtype) || isNoneInstance(memberSubtype) || isNever(memberSubtype)) {
                        canNarrow = false;
                    }
                });
            } else {
                canNarrow = isNoneInstance(memberType);
            }

            if (canNarrow) {
                return undefined;
            }
        }

        return subtype;
    });
}

export function narrowTypeForTypeIs(
    evaluator: TypeEvaluator,
    type: Type,
    classTypes: ClassType[],
    isPositiveTest: boolean,
    isIsOperator: boolean,
    classTypeVar: TypeVarType | undefined,
    allowLegacyEquality: boolean
) {
    const metaclassEqualityResults = isIsOperator ? undefined : new Map<ClassDetailsShared, boolean>();
    const hasEqualitySemantics = allowLegacyEquality
        ? hasDeclaredIdentityEqualitySemantics
        : hasIdentityEqualitySemantics;
    if (
        metaclassEqualityResults &&
        classTypes.some((classType) => !hasEqualitySemantics(classType, metaclassEqualityResults))
    ) {
        return type;
    }

    // We currently don't support narrowing in the negative direction
    // when there are more than one class types.
    if (!isPositiveTest && classTypes.length > 1) {
        return type;
    }

    // Retain the TypeVar rather than its expanded constraints so assignments and loop joins preserve correlation.
    if (isIsOperator && isPositiveTest && classTypeVar && isAnyOrUnknown(type)) {
        return classTypeVar;
    }

    let gradualArgResults: Map<Type, Map<Type, Type>> | undefined;
    const typesToCombine = classTypes.map((classType) => {
        return evaluator.mapSubtypesExpandTypeVars(
            type,
            /* options */ undefined,
            (subtype: Type, unexpandedSubtype: Type) => {
                if (isClassInstance(subtype)) {
                    const isLiteral = subtype.priv.literalValue !== undefined;
                    const instantiableSubtype = isLiteral
                        ? ClassType.cloneIncludeSubclasses(
                              ClassType.cloneAsInstantiable(ClassType.cloneWithLiteral(subtype, undefined)),
                              /* includeSubclasses */ false
                          )
                        : ClassType.cloneAsInstantiable(subtype);
                    if (
                        metaclassEqualityResults &&
                        !hasEqualitySemantics(instantiableSubtype, metaclassEqualityResults)
                    ) {
                        return unexpandedSubtype;
                    }

                    const matches = ClassType.isDerivedFrom(classType, instantiableSubtype);

                    // A literal has an exact runtime class, not an arbitrary subclass.
                    if (matches && isLiteral && !ClassType.isSameGenericClass(instantiableSubtype, classType)) {
                        return isPositiveTest ? undefined : subtype;
                    }

                    if (isPositiveTest) {
                        if (matches) {
                            if (ClassType.isSameGenericClass(instantiableSubtype, classType)) {
                                // Keep exact-str information for a later string-literal membership check.
                                const narrowedSubtype =
                                    isIsOperator && ClassType.isBuiltIn(classType, 'str')
                                        ? ClassType.cloneIncludeSubclasses(subtype, /* includeSubclasses */ false)
                                        : subtype;
                                return addConditionToType(narrowedSubtype, getTypeCondition(classType));
                            }

                            let narrowedClass = classType;

                            if (subtype.priv.typeArgs || subtype.priv.tupleTypeArgs) {
                                if (classType.shared.typeParams.length > 0) {
                                    if (
                                        containsAnyRecursive(classType) ||
                                        !evaluator.assignType(subtype, ClassType.cloneAsInstance(classType))
                                    ) {
                                        const genericClass = selfSpecializeClass(
                                            ClassType.specialize(classType, undefined)
                                        );
                                        const constraints = new ConstraintTracker();
                                        if (
                                            !evaluator.assignType(
                                                subtype,
                                                ClassType.cloneAsInstance(genericClass),
                                                undefined,
                                                constraints,
                                                AssignTypeFlags.Contravariant |
                                                    AssignTypeFlags.PopulateExpectedType |
                                                    AssignTypeFlags.SkipPopulateUnknownExpectedType
                                            )
                                        ) {
                                            return addConditionToType(subtype, getTypeCondition(classType));
                                        }

                                        const specializedClass = evaluator.solveAndApplyConstraints(
                                            genericClass,
                                            constraints,
                                            {
                                                replaceUnsolved: {
                                                    scopeIds: getTypeVarScopeIds(classType),
                                                    useUnknown: true,
                                                    tupleClassType: evaluator.getTupleClassType(),
                                                },
                                            }
                                        );
                                        if (!isInstantiableClass(specializedClass)) {
                                            return addConditionToType(subtype, getTypeCondition(classType));
                                        }

                                        const results = (gradualArgResults ??= new Map<Type, Map<Type, Type>>());
                                        narrowedClass = ClassType.specialize(
                                            specializedClass,
                                            specializedClass.priv.typeArgs?.map((arg, index) =>
                                                fillTypeGuardGradualArgs(arg, classType.priv.typeArgs?.[index], results)
                                            )
                                        );
                                    }
                                } else if (!evaluator.assignType(subtype, ClassType.cloneAsInstance(classType))) {
                                    return classType.priv.includeSubclasses && !ClassType.isFinal(classType)
                                        ? addConditionToType(subtype, getTypeCondition(classType))
                                        : undefined;
                                }
                            }

                            return addConditionToType(
                                ClassType.cloneAsInstance(
                                    narrowedClass,
                                    /* includeSubclasses */ !isIsOperator || !ClassType.isBuiltIn(classType, 'str')
                                ),
                                subtype.props?.condition
                            );
                        }

                        if (!classType.priv.includeSubclasses) {
                            if (evaluator.assignType(subtype, ClassType.cloneAsInstance(classType))) {
                                return addConditionToType(
                                    ClassType.cloneAsInstance(classType),
                                    getTypeCondition(subtype)
                                );
                            }
                            return undefined;
                        }

                        // A subclass of both the subtype and the class could satisfy the
                        // comparison, so eliminate the subtype only if no such class can exist.
                        if (
                            (ClassType.isFinal(classType) ||
                                isLiteral ||
                                ClassType.isFinal(instantiableSubtype) ||
                                areDisjointBasesIncompatible(instantiableSubtype, classType)) &&
                            !evaluator.assignType(ClassType.cloneAsInstance(classType), subtype) &&
                            !evaluator.assignType(subtype, ClassType.cloneAsInstance(classType))
                        ) {
                            return undefined;
                        }

                        if (!isTypeVar(unexpandedSubtype) || !TypeVarType.isSelf(unexpandedSubtype)) {
                            return addConditionToType(subtype, classType.props?.condition);
                        }
                    }

                    // A final class has no subclasses, so it is treated as an exact class.
                    if (!classType.priv.includeSubclasses || ClassType.isFinal(classType)) {
                        // If the runtime class is exact and it matches, then
                        // we can eliminate it in the negative case.
                        if (matches && (isLiteral || ClassType.isFinal(instantiableSubtype))) {
                            return undefined;
                        }

                        // We can't eliminate the subtype in the negative
                        // case because it could be a subclass of the type,
                        // in which case `type(x) is y` would fail.
                        return subtype;
                    }
                }

                if (isAnyOrUnknown(subtype)) {
                    if (metaclassEqualityResults && !allowLegacyEquality) {
                        return subtype;
                    }
                    return isPositiveTest
                        ? ClassType.cloneAsInstance(addConditionToType(classType, getTypeCondition(subtype)))
                        : subtype;
                }

                return unexpandedSubtype;
            }
        );
    });

    return combineTypes(typesToCombine);
}

function hasUnresolvedMetaclassInMro(classType: ClassType): boolean {
    return classType.shared.mro.some(
        (baseClass) =>
            !isInstantiableClass(baseClass) || !!(baseClass.shared.flags & ClassTypeFlags.HasUnresolvedMetaclass)
    );
}

function hasIdentityEqualitySemantics(
    classType: ClassType,
    metaclassEqualityResults: Map<ClassDetailsShared, boolean>
): boolean {
    if (classType.priv.includeSubclasses && !ClassType.isFinal(classType)) {
        return false;
    }

    if (classType.shared.typeParams.length > 0) {
        return false;
    }

    return hasDeclaredIdentityEqualitySemantics(classType, metaclassEqualityResults);
}

function hasDeclaredIdentityEqualitySemantics(
    classType: ClassType,
    metaclassEqualityResults: Map<ClassDetailsShared, boolean>
): boolean {
    const metaclass = classType.shared.effectiveMetaclass;
    if (
        !metaclass ||
        !isInstantiableClass(metaclass) ||
        hasUnresolvedMetaclassInMro(classType) ||
        hasUnresolvedMetaclassInMro(metaclass)
    ) {
        return false;
    }

    if (ClassType.isBuiltIn(metaclass, 'type')) {
        return true;
    }

    // Cloned metaclasses share method definitions, but the class-specific checks above cannot be shared.
    const cachedResult = metaclassEqualityResults.get(metaclass.shared);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    const result =
        !customMetaclassSupportsMethod(classType, '__eq__') && !customMetaclassSupportsMethod(classType, '__ne__');
    metaclassEqualityResults.set(metaclass.shared, result);
    return result;
}

export function narrowTypeForClassComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    classType: ClassType,
    isPositiveTest: boolean,
    isIsOperator = true
): Type {
    // Limit reuse to this invocation so results cannot outlive the evaluation that established them.
    const metaclassEqualityResults = isIsOperator ? undefined : new Map<ClassDetailsShared, boolean>();
    if (metaclassEqualityResults && !hasIdentityEqualitySemantics(classType, metaclassEqualityResults)) {
        return referenceType;
    }

    return mapSubtypes(referenceType, (subtype) => {
        // Multiple class constraints expand to a union with distinct conditions, which equality cannot narrow.
        if (
            metaclassEqualityResults &&
            isTypeVar(subtype) &&
            !subtype.shared.recursiveAlias &&
            subtype.shared.constraints.length > 1 &&
            subtype.shared.constraints.every(isClassInstance)
        ) {
            return subtype;
        }

        let concreteSubtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        if (
            metaclassEqualityResults &&
            (!isInstantiableClass(concreteSubtype) ||
                !hasIdentityEqualitySemantics(concreteSubtype, metaclassEqualityResults))
        ) {
            return subtype;
        }

        if (isPositiveTest) {
            if (
                isClassInstance(concreteSubtype) &&
                TypeBase.isInstance(subtype) &&
                ClassType.isBuiltIn(concreteSubtype, 'type')
            ) {
                concreteSubtype =
                    concreteSubtype.priv.typeArgs && concreteSubtype.priv.typeArgs.length > 0
                        ? convertToInstantiable(concreteSubtype.priv.typeArgs[0])
                        : UnknownType.create();
            }

            if (isAnyOrUnknown(concreteSubtype)) {
                return addConditionToType(classType, getTypeCondition(concreteSubtype));
            }

            if (isClass(concreteSubtype)) {
                if (TypeBase.isInstance(concreteSubtype)) {
                    if (!isIsOperator) {
                        return subtype;
                    }
                    return ClassType.isBuiltIn(concreteSubtype, 'object') ? classType : undefined;
                }

                const isSuperType = isFilterSuperclass(subtype, concreteSubtype, classType, classType);

                if (!classType.priv.includeSubclasses) {
                    // Handle the case where the LHS and RHS operands are specific
                    // classes, as opposed to types that represent classes and their
                    // subclasses.
                    if (!concreteSubtype.priv.includeSubclasses) {
                        return ClassType.isSameGenericClass(concreteSubtype, classType) ? classType : undefined;
                    }

                    if (isSuperType) {
                        return addConditionToType(classType, getTypeCondition(concreteSubtype));
                    }

                    const isSubType = ClassType.isDerivedFrom(classType, concreteSubtype);
                    if (isSubType) {
                        return addConditionToType(classType, getTypeCondition(concreteSubtype));
                    }

                    return undefined;
                }

                if (ClassType.isFinal(concreteSubtype) && !isSuperType) {
                    return undefined;
                }
            }
        } else {
            if (
                isInstantiableClass(concreteSubtype) &&
                ClassType.isSameGenericClass(classType, concreteSubtype) &&
                ClassType.isFinal(classType)
            ) {
                return undefined;
            }
        }

        return subtype;
    });
}

function isFilterSuperclass(
    varType: Type,
    concreteVarType: ClassType,
    filterType: Type,
    concreteFilterType: ClassType
) {
    if (isTypeVar(filterType) || concreteFilterType.priv.literalValue !== undefined) {
        return isTypeSame(convertToInstance(filterType), varType);
    }

    // If the filter type represents all possible subclasses
    // of a type, we can't make any statements about its superclass
    // relationship with concreteVarType.
    if (concreteFilterType.priv.includeSubclasses) {
        return false;
    }

    if (ClassType.isDerivedFrom(concreteVarType, concreteFilterType)) {
        return true;
    }

    // Handle the special case where the variable type is a TypedDict and
    // we're filtering against 'dict'. TypedDict isn't derived from dict,
    // but at runtime, isinstance returns True.
    if (ClassType.isBuiltIn(concreteFilterType, 'dict') && ClassType.isTypedDictClass(concreteVarType)) {
        return true;
    }

    return false;
}

function isPrimitiveBackedEnumClass(classType: ClassType): boolean {
    if (!ClassType.isEnumClass(classType)) {
        return false;
    }

    return derivesFromStdlibClass(classType, 'int') || derivesFromStdlibClass(classType, 'str');
}

function isPrimitiveBackedEnumAndPrimitive(enumType: ClassType, primitiveType: ClassType): boolean {
    if (ClassType.isEnumClass(primitiveType) || !isPrimitiveBackedEnumClass(enumType)) {
        return false;
    }

    // Exclude bool, which derives from int but whose literal values are distinct
    // from the corresponding int literals.
    if (ClassType.isBuiltIn(primitiveType, 'int')) {
        return derivesFromStdlibClass(enumType, 'int');
    }

    if (ClassType.isBuiltIn(primitiveType, 'str')) {
        return derivesFromStdlibClass(enumType, 'str');
    }

    return false;
}

function unwrapPrimitiveBackedEnumLiteral(classType: ClassType): ClassType {
    const literalValue = classType.priv.literalValue;
    if (!(literalValue instanceof EnumLiteral) || !isPrimitiveBackedEnumClass(classType)) {
        return classType;
    }

    const itemType = literalValue.itemType;
    if (isClassInstance(itemType) && itemType.priv.literalValue !== undefined) {
        return itemType;
    }

    return classType;
}

function isLiteralValueEqualAtRuntime(type1: ClassType, type2: ClassType): boolean {
    return ClassType.isLiteralValueSame(
        unwrapPrimitiveBackedEnumLiteral(type1),
        unwrapPrimitiveBackedEnumLiteral(type2)
    );
}

function getInnermostNewTypeBaseInstance(subtype: Type): Type | undefined {
    if (!isClassInstance(subtype) || !ClassType.isNewTypeClass(subtype)) {
        return undefined;
    }

    let currentType: Type = subtype;
    while (isClassInstance(currentType) && ClassType.isNewTypeClass(currentType)) {
        if (currentType.shared.baseClasses.length === 0) {
            return undefined;
        }

        const baseClass = currentType.shared.baseClasses[0];
        if (!isClass(baseClass)) {
            return undefined;
        }

        currentType = ClassType.cloneAsInstance(baseClass);
    }

    return currentType;
}

export function narrowTypeForLiteralComparison(
    evaluator: TypeEvaluator,
    referenceType: Type,
    literalType: ClassType,
    isPositiveTest: boolean,
    isIsOperator: boolean
): Type {
    return evaluator.mapSubtypesExpandTypeVars(referenceType, /* options */ undefined, (subtype) => {
        subtype = evaluator.makeTopLevelTypeVarsConcrete(subtype);

        if (isAnyOrUnknown(subtype)) {
            if (isPositiveTest) {
                return literalType;
            }

            return subtype;
        }

        // Determine whether this is a comparison between a primitive-backed enum
        // (e.g. IntEnum or StrEnum) and its underlying primitive type. Such a
        // comparison can be used for narrowing because the enum member compares
        // equal to its underlying primitive value at runtime.
        const isPrimitiveBackedEnumComparison =
            !isIsOperator &&
            isClassInstance(subtype) &&
            (isPrimitiveBackedEnumAndPrimitive(subtype, literalType) ||
                isPrimitiveBackedEnumAndPrimitive(literalType, subtype));

        if (
            isClassInstance(subtype) &&
            (ClassType.isSameGenericClass(literalType, subtype) || isPrimitiveBackedEnumComparison)
        ) {
            if (subtype.priv.literalValue !== undefined) {
                const literalValueMatches = isPrimitiveBackedEnumComparison
                    ? isLiteralValueEqualAtRuntime(subtype, literalType)
                    : ClassType.isLiteralValueSame(subtype, literalType);
                if (isPositiveTest) {
                    return literalValueMatches ? subtype : undefined;
                }

                const isSingleton =
                    ClassType.isEnumClass(literalType) ||
                    isSentinelLiteral(subtype) ||
                    ClassType.isBuiltIn(literalType, 'bool');

                // For negative tests, we can eliminate the literal value if it doesn't match,
                // but only for equality tests or for 'is' tests that involve enums, bools, or sentinels.
                return literalValueMatches && (isSingleton || !isIsOperator) ? undefined : subtype;
            }

            if (isPositiveTest) {
                if (isPrimitiveBackedEnumComparison) {
                    // If the reference type is the enum, attempt to find the member
                    // whose value matches the primitive literal. If no member can be
                    // identified (e.g. for an IntFlag class, whose members cannot be
                    // enumerated), retain the reference type rather than narrowing it
                    // to the primitive literal type.
                    if (ClassType.isEnumClass(subtype)) {
                        const allLiteralTypes = enumerateLiteralsForType(evaluator, subtype);
                        const match = allLiteralTypes?.find((type) => isLiteralValueEqualAtRuntime(type, literalType));
                        return match ?? subtype;
                    }

                    // The reference type is the primitive type, so narrowing it to the
                    // enum literal would lose its (potentially derived) class. Retain
                    // the reference type instead.
                    return subtype;
                }

                return literalType;
            }

            // If we're able to enumerate all possible literal values
            // (for bool or enum), we can eliminate all others in a negative test.
            const allLiteralTypes = enumerateLiteralsForType(evaluator, subtype);
            if (allLiteralTypes && allLiteralTypes.length > 0) {
                return combineTypes(
                    allLiteralTypes.filter((type) =>
                        isPrimitiveBackedEnumComparison
                            ? !isLiteralValueEqualAtRuntime(type, literalType)
                            : !ClassType.isLiteralValueSame(type, literalType)
                    )
                );
            }

            return subtype;
        }

        if (isPositiveTest) {
            if (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'LiteralString')) {
                return literalType;
            }

            if (isIsOperator || isNoneInstance(subtype)) {
                const compareType = getInnermostNewTypeBaseInstance(subtype) ?? subtype;

                const isSubtype = evaluator.assignType(compareType, literalType);
                if (isSubtype) {
                    return isClassInstance(subtype) && ClassType.isNewTypeClass(subtype) ? subtype : literalType;
                }
                return undefined;
            }
        }

        return subtype;
    });
}

export function enumerateLiteralsForType(evaluator: TypeEvaluator, type: ClassType): ClassType[] | undefined {
    if (ClassType.isBuiltIn(type, 'bool')) {
        // Booleans have only two types: True and False.
        return [
            ClassType.cloneWithLiteral(type, /* value */ true),
            ClassType.cloneWithLiteral(type, /* value */ false),
        ];
    }

    if (ClassType.isEnumClass(type)) {
        // Enum expansion doesn't apply if the member set cannot be statically
        // enumerated or if the class derives from enum.Flag.
        if (
            ClassType.isEnumMemberSetMayBeDynamicallyModified(type) ||
            type.shared.mro.some((mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, 'Flag'))
        ) {
            return undefined;
        }

        // Enumerate all of the values in this enumeration.
        const enumList: ClassType[] = [];
        const fields = ClassType.getSymbolTable(type);
        fields.forEach((symbol, name) => {
            if (!symbol.isIgnoredForProtocolMatch()) {
                let symbolType = evaluator.getEffectiveTypeOfSymbol(symbol);
                symbolType = transformTypeForEnumMember(evaluator, type, name, getInfoReader(evaluator)) ?? symbolType;

                if (
                    isClassInstance(symbolType) &&
                    ClassType.isSameGenericClass(type, symbolType) &&
                    symbolType.priv.literalValue !== undefined
                ) {
                    enumList.push(symbolType);
                }
            }
        });

        return enumList;
    }

    return undefined;
}

export function isNameSameScope(evaluator: TypeEvaluator, reference: NameNode, expression: NameNode): boolean {
    const refSymbol = evaluator.lookUpSymbolRecursive(reference, reference.d.value, /* honorCodeFlow */ false);
    const exprSymbol = evaluator.lookUpSymbolRecursive(expression, expression.d.value, /* honorCodeFlow */ false);

    if (!refSymbol || !exprSymbol) {
        // This shouldn't happen, but just to be safe...
        return true;
    }

    const refScope = refSymbol.scope;
    const exprScope = exprSymbol.scope;

    if (refScope === exprScope) {
        return true;
    }

    return isScopeContainedWithin(refScope, exprScope);
}

function areDisjointBasesIncompatible(classType1: ClassType, classType2: ClassType): boolean {
    const base1 = ClassType.getDisjointBase(classType1);
    const base2 = ClassType.getDisjointBase(classType2);
    return !!base1 && !!base2 && !ClassType.getMostDerivedDisjointBase([base1, base2]);
}

function fillTypeGuardGradualArgs(
    input: Type,
    hint: Type | undefined,
    results: Map<Type, Map<Type, Type>>,
    recursionCount = 0
): Type {
    if (!hint || input === hint || recursionCount > maxTypeRecursionCount) {
        return input;
    }

    if (isAnyOrUnknown(input)) {
        return isAnyOrUnknown(hint) ? (isAny(hint) ? hint : input) : hint;
    }

    if (!isClass(input) || !isClass(hint) || !ClassType.isSameGenericClass(input, hint)) {
        return input;
    }

    let inputResults = results.get(input);
    const cachedResult = inputResults?.get(hint);
    if (cachedResult !== undefined) {
        return cachedResult;
    }

    if (!inputResults) {
        inputResults = new Map<Type, Type>();
        results.set(input, inputResults);
    }

    // Bound recursive aliases and reuse shared argument graphs within this narrowing operation.
    inputResults.set(hint, input);

    const inputTuple = input.priv.tupleTypeArgs;
    const hintTuple = hint.priv.tupleTypeArgs;
    if (inputTuple || hintTuple) {
        if (
            !inputTuple ||
            !hintTuple ||
            inputTuple.length !== hintTuple.length ||
            inputTuple.some(
                (arg, index) =>
                    arg.isUnbounded !== hintTuple[index].isUnbounded ||
                    !!arg.isOptional !== !!hintTuple[index].isOptional
            )
        ) {
            return input;
        }

        const tupleArgs = inputTuple.map((arg, index) => ({
            ...arg,
            type: fillTypeGuardGradualArgs(arg.type, hintTuple[index].type, results, recursionCount + 1),
        }));
        const result = tupleArgs.every((arg, index) => arg.type === inputTuple[index].type)
            ? input
            : specializeTupleClass(input, tupleArgs, input.priv.isTypeArgExplicit, input.priv.isUnpacked);
        inputResults.set(hint, result);
        return result;
    }

    const inputArgs = input.priv.typeArgs;
    const hintArgs = hint.priv.typeArgs;
    if (!inputArgs || !hintArgs || inputArgs.length !== hintArgs.length) {
        return input;
    }

    const typeArgs = inputArgs.map((arg, index) =>
        fillTypeGuardGradualArgs(arg, hintArgs[index], results, recursionCount + 1)
    );
    const result = typeArgs.every((arg, index) => arg === inputArgs[index])
        ? input
        : ClassType.specialize(input, typeArgs, input.priv.isTypeArgExplicit);
    inputResults.set(hint, result);
    return result;
}

export function narrowTypeForUserDefinedTypeGuard(
    evaluator: TypeEvaluator,
    type: Type,
    typeGuardType: Type,
    isPositiveTest: boolean,
    isStrictTypeGuard: boolean,
    errorNode: ExpressionNode,
    nodeInfo: AnalyzerNodeInfoAccessor,
    narrowTypeForInstanceOrSubclassCallback: NarrowTypeForInstanceOrSubclassCallback
): Type {
    // For non-strict type guards, always narrow to the typeGuardType
    // in the positive case and don't narrow in the negative case.
    if (!isStrictTypeGuard) {
        let result = type;

        if (isPositiveTest) {
            result = typeGuardType;

            // If the type guard is a non-constrained TypeVar, add a
            // condition to the resulting type.
            if (isTypeVar(type) && !isParamSpec(type) && !TypeVarType.hasConstraints(type)) {
                result = addConditionToType(result, [{ typeVar: type, constraintIndex: 0 }]);
            }
            return result;
        }

        return result;
    }

    const filterTypes: Type[] = [];
    doForEachSubtype(typeGuardType, (typeGuardSubtype) => {
        filterTypes.push(convertToInstantiable(typeGuardSubtype));
    });

    return narrowTypeForInstanceOrSubclassCallback(
        evaluator,
        type,
        filterTypes,
        /* isInstanceCheck */ true,
        /* isTypeIsCheck */ true,
        isPositiveTest,
        errorNode,
        nodeInfo
    );
}
