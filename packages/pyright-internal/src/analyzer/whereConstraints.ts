/*
 * whereConstraints.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Functions that determine whether constrains specified with a "where"
 * clause are met.
 */

import { partition } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { LocAddendum } from '../localization/localize';
import { ConstraintTracker } from './constraintTracker';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isTypeSame,
    isTypeVar,
    isUnpacked,
    TupleTypeArg,
    Type,
    TypeVarType,
    UnknownType,
    WhereConstraint,
} from './types';
import { isLiteralIntType, isTupleClass, specializeTupleClass } from './typeUtils';

const intComparisonOperators = ['IntEq', 'IntNe', 'IntLt', 'IntLe', 'IntGt', 'IntGe'];
const intMathOperators = ['IntAdd', 'IntDiv', 'IntMod', 'IntMul', 'IntSub'];
const intTupleOperators = [
    'TupleBroadcast',
    'TupleConcat',
    'TupleIndex',
    'TupleLen',
    'TupleMultiIndex',
    'TuplePermute',
    'TupleReshape',
    'TupleSplice',
    'TupleSwap',
];

interface SummableTerm {
    isPositive: boolean;
    type: Type;
}

export function validateWhereConstraints(
    evaluator: TypeEvaluator,
    whereConstraints: WhereConstraint[],
    diag: DiagnosticAddendum | undefined,
    constraints: ConstraintTracker
): boolean {
    let isSatisfied = true;

    for (const whereConstraint of whereConstraints) {
        const solvedConstraint = evaluator.solveAndApplyConstraints(whereConstraint, constraints);

        if (isClass(solvedConstraint)) {
            const subDiag = diag?.createAddendum();
            if (!evalWhereConstraint(evaluator, solvedConstraint, subDiag)) {
                isSatisfied = false;

                subDiag?.addMessage(
                    LocAddendum.whereConstraintNotSatisfied().format({ type: evaluator.printType(whereConstraint) })
                );
            }
        }
    }

    return isSatisfied;
}

export function evalWhereConstraint(
    evaluator: TypeEvaluator,
    whereConstraint: WhereConstraint,
    diag: DiagnosticAddendum | undefined
): boolean {
    const evalType = evalWhereConstraintType(evaluator, whereConstraint, diag);

    if (!evalType) {
        return false;
    }

    if (isClassInstance(evalType) && ClassType.isBuiltIn(evalType, 'bool') && evalType.priv.literalValue === false) {
        return false;
    }

    return true;
}

export function evalWhereConstraintType(
    evaluator: TypeEvaluator,
    whereConstraint: Type,
    diag: DiagnosticAddendum | undefined
): Type | undefined {
    if (!isClassInstance(whereConstraint) || !ClassType.isBuiltIn(whereConstraint)) {
        return whereConstraint;
    }

    const className = whereConstraint.shared.name;
    if (intComparisonOperators.includes(className)) {
        return evalIntConditionalType(evaluator, whereConstraint, diag);
    }

    if (intMathOperators.includes(className)) {
        return evalIntMathType(evaluator, whereConstraint, diag);
    }

    if (intTupleOperators.includes(className)) {
        return evalIntTupleType(evaluator, whereConstraint, diag);
    }

    return whereConstraint;
}

function evalIntMathType(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): Type | undefined {
    assert(isClassInstance(whereConstraint));
    assert(ClassType.isBuiltIn(whereConstraint));

    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length < 2) {
        diag?.addMessage(
            LocAddendum.whereConstraintInvalidType().format({ type: evaluator.printType(whereConstraint) })
        );
        return undefined;
    }

    const arg0 = getIntLiteralType(typeArgs[0]);
    const arg1 = getIntLiteralType(typeArgs[1]);

    if (!arg0 || !arg1) {
        return whereConstraint;
    }

    let value0 = isClassInstance(arg0) ? (arg0.priv.literalValue as number | bigint | undefined) : undefined;
    let value1 = isClassInstance(arg1) ? (arg1.priv.literalValue as number | bigint | undefined) : undefined;

    if (value0 !== undefined) {
        value0 = Number(value0 as number | bigint);
    }
    if (value1 !== undefined) {
        value1 = Number(value1 as number | bigint);
    }

    // See if we can simplify the expression by performing literal math.
    let result: Type | undefined;

    switch (whereConstraint.shared.name) {
        case 'IntAdd':
            if (value0 !== undefined && value1 !== undefined) {
                result = createIntLiteral(evaluator, value0 + value1);
            } else if (value0 === 0) {
                result = arg1;
            } else if (value1 === 0) {
                result = arg0;
            }
            break;

        case 'IntDiv':
            if (value1 !== 0) {
                if (value0 !== undefined && value1 !== undefined) {
                    result = createIntLiteral(evaluator, Math.floor(value0 / value1));
                } else if (value1 === 1) {
                    result = arg0;
                }
            }
            break;

        case 'IntMod':
            if (value1 !== 0) {
                if (value0 !== undefined && value1 !== undefined) {
                    result = createIntLiteral(evaluator, value0 % value1);
                } else if (value1 === 1) {
                    result = arg0;
                }
            }
            break;

        case 'IntMul':
            if (value0 !== undefined && value1 !== undefined) {
                result = createIntLiteral(evaluator, value0 * value1);
            } else if (value0 === 1) {
                result = arg1;
            } else if (value1 === 1) {
                result = arg0;
            }
            break;

        case 'IntSub':
            if (value0 !== undefined && value1 !== undefined) {
                result = createIntLiteral(evaluator, value0 - value1);
            } else if (value1 === 0) {
                result = arg0;
            }
            break;
    }

    if (result) {
        result = simplifyNumericSum(evaluator, result);
    }

    return result ?? whereConstraint;
}

function createIntLiteral(evaluator: TypeEvaluator, value: number | bigint): ClassType | undefined {
    const intClass = evaluator.getIntClassType();
    if (!intClass || !isInstantiableClass(intClass)) {
        return undefined;
    }

    // Convert back to a simple number if it fits. Leave as a bigint
    // if it doesn't.
    if (value >= Number.MIN_SAFE_INTEGER && value <= Number.MAX_SAFE_INTEGER) {
        value = Number(value);
    }

    return ClassType.cloneWithLiteral(ClassType.cloneAsInstance(intClass), value);
}

function evalIntConditionalType(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): ClassType | undefined {
    assert(isClassInstance(whereConstraint));
    assert(ClassType.isBuiltIn(whereConstraint));

    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length < 2) {
        diag?.addMessage(
            LocAddendum.whereConstraintInvalidType().format({ type: evaluator.printType(whereConstraint) })
        );
        return undefined;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    const arg1 = evalWhereConstraintType(evaluator, typeArgs[1], diag);

    if (!arg0 || !arg1) {
        return undefined;
    }

    // If one or more of the arguments are Any, assume true.
    if (containsAnyOrUnknown([arg0, arg1])) {
        return createBoolLiteral(evaluator, true) ?? whereConstraint;
    }

    // If one or more arguments are unbound type vars, we can't
    // evaluate them until we have more information.
    if (containsUnboundTypeVar([arg0, arg1])) {
        return whereConstraint;
    }

    if (
        !isClassInstance(arg0) ||
        !ClassType.isBuiltIn(arg0, 'int') ||
        !isClassInstance(arg1) ||
        !ClassType.isBuiltIn(arg1, 'int')
    ) {
        if (whereConstraint.shared.name === 'IntEq') {
            return createBoolLiteral(evaluator, isTypeSame(arg0, arg1)) ?? whereConstraint;
        }

        return createBoolLiteral(evaluator, false) ?? whereConstraint;
    }

    const value0 = arg0.priv.literalValue;
    const value1 = arg1.priv.literalValue;
    if (value0 === undefined || value1 === undefined) {
        return createBoolLiteral(evaluator, false) ?? whereConstraint;
    }

    // See if we can simplify the expression to a Literal[True] or Literal[False].
    switch (whereConstraint.shared.name) {
        case 'IntEq':
            return createBoolLiteral(evaluator, value0 === value1) ?? whereConstraint;

        case 'IntNe':
            return createBoolLiteral(evaluator, value0 !== value1) ?? whereConstraint;

        case 'IntLt':
            return createBoolLiteral(evaluator, value0 < value1) ?? whereConstraint;

        case 'IntLe':
            return createBoolLiteral(evaluator, value0 <= value1) ?? whereConstraint;

        case 'IntGt':
            return createBoolLiteral(evaluator, value0 > value1) ?? whereConstraint;

        case 'IntGe':
            return createBoolLiteral(evaluator, value0 >= value1) ?? whereConstraint;

        default:
            return whereConstraint;
    }
}

function containsUnboundTypeVar(types: Type[]): boolean {
    for (const t of types) {
        if (isTypeVar(t) && !TypeVarType.isBound(t)) {
            return true;
        }
    }

    return false;
}

function containsAnyOrUnknown(types: Type[]): boolean {
    for (const t of types) {
        if (isAnyOrUnknown(t)) {
            return true;
        }
    }

    return false;
}

function getTupleTypeArgs(type: Type): TupleTypeArg[] | undefined {
    if (!isClassInstance(type) || !isTupleClass(type)) {
        return undefined;
    }

    return type.priv.tupleTypeArgs;
}

function getIntLiteralValue(type: Type): number | undefined {
    if (!isClassInstance(type) || !ClassType.isBuiltIn(type, 'int') || type.priv.literalValue === undefined) {
        return undefined;
    }

    return Number(type.priv.literalValue);
}

function getIntLiteralType(type: Type): Type | undefined {
    if (isClassInstance(type) && isLiteralIntType(type)) {
        return type;
    }

    if (isTypeVar(type) && TypeVarType.isBound(type)) {
        return type;
    }

    return undefined;
}

function createBoolLiteral(evaluator: TypeEvaluator, value: boolean): ClassType | undefined {
    const boolClass = evaluator.getBoolClassType();
    if (!boolClass || !isInstantiableClass(boolClass)) {
        return undefined;
    }

    return ClassType.cloneWithLiteral(ClassType.cloneAsInstance(boolClass), value);
}

function createIntAddType(evaluator: TypeEvaluator, op1: Type, op2: Type): ClassType | undefined {
    const intAddClass = evaluator.getIntAddClassType();
    if (!intAddClass || !isInstantiableClass(intAddClass)) {
        return undefined;
    }

    return ClassType.specialize(ClassType.cloneAsInstance(intAddClass), [op1, op2]);
}

function createIntSubType(evaluator: TypeEvaluator, op1: Type, op2: Type): ClassType | undefined {
    const intSubClass = evaluator.getIntSubClassType();
    if (!intSubClass || !isInstantiableClass(intSubClass)) {
        return undefined;
    }

    return ClassType.specialize(ClassType.cloneAsInstance(intSubClass), [op1, op2]);
}

function createIntMulType(evaluator: TypeEvaluator, op1: Type, op2: Type): ClassType | undefined {
    const intMulClass = evaluator.getIntMulClassType();
    if (!intMulClass || !isInstantiableClass(intMulClass)) {
        return undefined;
    }

    return ClassType.specialize(ClassType.cloneAsInstance(intMulClass), [op1, op2]);
}

function containsUnboundedEntry(typeArgs: TupleTypeArg[]): boolean {
    return typeArgs.some((entry) => entry.isUnbounded || isUnpacked(entry.type));
}

// Returns the index of the specified tuple expression. Returns
// undefined if the index cannot be determined. Logs an error if
// the index is definitely out of range and returns a negative number.
function getTupleIndex(
    typeArgs: TupleTypeArg[],
    index: number,
    diag: DiagnosticAddendum | undefined,
    allowFullLength = false
): number | undefined {
    const reportOutOfRange = () => {
        diag?.addMessage(
            LocAddendum.whereConstraintIndexOutOfRange().format({
                value: index,
            })
        );
    };

    let adjIndex = index;

    if (adjIndex >= 0) {
        if (adjIndex > typeArgs.length || (!allowFullLength && adjIndex === typeArgs.length)) {
            if (containsUnboundedEntry(typeArgs)) {
                return undefined;
            }

            reportOutOfRange();
            return -1;
        }

        if (containsUnboundedEntry(typeArgs.slice(0, adjIndex + 1))) {
            return undefined;
        }
    } else {
        adjIndex = typeArgs.length + adjIndex;
        if (adjIndex < 0) {
            if (containsUnboundedEntry(typeArgs)) {
                return undefined;
            }

            reportOutOfRange();
            return -1;
        }

        if (containsUnboundedEntry(typeArgs.slice(adjIndex))) {
            return undefined;
        }
    }

    return adjIndex;
}

function evalIntTupleType(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): Type | undefined {
    assert(isClassInstance(whereConstraint));
    assert(ClassType.isBuiltIn(whereConstraint));

    switch (whereConstraint.shared.name) {
        case 'TupleBroadcast':
            return evalBroadcast(evaluator, whereConstraint, diag);

        case 'TupleConcat':
            return evalConcat(evaluator, whereConstraint, diag);

        case 'TupleIndex':
            return evalIndex(evaluator, whereConstraint, diag);

        case 'TupleLen':
            return evalLen(evaluator, whereConstraint, diag);

        case 'TupleMultiIndex':
            return evalMultiIndex(evaluator, whereConstraint, diag);

        case 'TuplePermute':
            return evalPermute(evaluator, whereConstraint, diag);

        case 'TupleReshape':
            return evalReshape(evaluator, whereConstraint, diag);

        case 'TupleSplice':
            return evalSplice(evaluator, whereConstraint, diag);

        case 'TupleSwap':
            return evalSwap(evaluator, whereConstraint, diag);
    }

    diag?.addMessage(LocAddendum.whereConstraintInvalidType().format({ type: evaluator.printType(whereConstraint) }));
    return undefined;
}

function evalBroadcast(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): ClassType | undefined {
    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length !== 2) {
        return whereConstraint;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    const arg1 = evalWhereConstraintType(evaluator, typeArgs[1], diag);

    if (!arg0 || !arg1) {
        return undefined;
    }

    // The two args must be tuples.
    const arg0TypeArgs = getTupleTypeArgs(arg0);
    const arg1TypeArgs = getTupleTypeArgs(arg1);
    if (!arg0TypeArgs || !arg1TypeArgs) {
        return whereConstraint;
    }

    assert(isClassInstance(arg0) && isTupleClass(arg0));

    const entries0 = arg0TypeArgs.slice().reverse();
    const entries1 = arg1TypeArgs.slice().reverse();

    const finalEntries: TupleTypeArg[] = [];

    for (let i = 0; i < Math.max(entries0.length, entries1.length); i++) {
        if (i < entries0.length && i < entries1.length) {
            if (entries0[i].isUnbounded || entries1[i].isUnbounded) {
                return whereConstraint;
            }

            const val0 = getIntLiteralType(entries0[i].type);
            const val1 = getIntLiteralType(entries1[i].type);

            if (val0 === undefined || val1 === undefined) {
                return whereConstraint;
            }

            const literalVal0 = getIntLiteralValue(val0);
            const literalVal1 = getIntLiteralValue(val1);

            if (literalVal0 === 1) {
                finalEntries.push(entries1[i]);
                continue;
            }

            if (literalVal1 === 1) {
                finalEntries.push(entries0[i]);
                continue;
            }

            if (!isTypeSame(val0, val1)) {
                diag?.addMessage(LocAddendum.whereConstraintBroadcast());
                return undefined;
            }
        }

        finalEntries.push(i < entries0.length ? entries0[i] : entries1[i]);
    }

    return specializeTupleClass(arg0, finalEntries.slice().reverse(), /* isTypeArgExplicit */ true);
}

function evalConcat(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): ClassType | undefined {
    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length !== 3) {
        return whereConstraint;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    const arg1 = evalWhereConstraintType(evaluator, typeArgs[1], diag);
    const arg2 = evalWhereConstraintType(evaluator, typeArgs[2], diag);

    if (!arg0 || !arg1 || !arg2) {
        return undefined;
    }

    // The first two args must be tuples.
    const arg0TypeArgs = getTupleTypeArgs(arg0);
    const arg1TypeArgs = getTupleTypeArgs(arg1);
    if (!arg0TypeArgs || !arg1TypeArgs) {
        return whereConstraint;
    }

    // The third arg must be an actual int literal value.
    const concatDim = getIntLiteralValue(arg2);
    if (concatDim === undefined) {
        return whereConstraint;
    }

    const dim1 = getTupleIndex(arg0TypeArgs, concatDim, diag);
    const dim2 = getTupleIndex(arg1TypeArgs, concatDim, diag);

    if (dim1 !== undefined && dim1 < 0) {
        return undefined;
    }

    if (dim2 !== undefined && dim2 < 0) {
        return undefined;
    }

    if (dim1 === undefined || dim2 === undefined) {
        return whereConstraint;
    }

    // If the dimensions differ for all but the designated dimension, it's an error.
    if (arg0TypeArgs.length !== arg1TypeArgs.length) {
        diag?.addMessage(LocAddendum.whereConstraintConcatMismatch());
        return undefined;
    }

    for (let i = 0; i < arg0TypeArgs.length; i++) {
        const typeArg0 = arg0TypeArgs[i];
        const typeArg1 = arg1TypeArgs[i];

        if (i !== concatDim) {
            if (!isTypeSame(typeArg0.type, typeArg1.type)) {
                diag?.addMessage(LocAddendum.whereConstraintConcatMismatch());
                return undefined;
            }
        } else {
            if (typeArg0.isUnbounded || typeArg1.isUnbounded) {
                return whereConstraint;
            }
        }
    }

    const typeArg0Type = getIntLiteralType(arg0TypeArgs[concatDim].type);
    const typeArg1Type = getIntLiteralType(arg1TypeArgs[concatDim].type);

    if (!typeArg0Type || !typeArg1Type) {
        return whereConstraint;
    }

    const intAddType = createIntAddType(evaluator, typeArg0Type, typeArg1Type);
    if (!intAddType) {
        return whereConstraint;
    }

    assert(isClassInstance(arg0));

    const newTypeArgs = [...arg0TypeArgs];
    newTypeArgs[concatDim] = {
        isUnbounded: false,
        type: simplifyNumericSum(evaluator, intAddType),
    };

    return specializeTupleClass(arg0, newTypeArgs, /* isTypeArgExplicit */ true);
}

function evalIndex(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): Type | undefined {
    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length !== 2) {
        return whereConstraint;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    const arg1 = evalWhereConstraintType(evaluator, typeArgs[1], diag);

    if (!arg0 || !arg1) {
        return undefined;
    }

    // The first arg must be a tuple.
    const arg0TypeArgs = getTupleTypeArgs(arg0);
    if (!arg0TypeArgs) {
        return whereConstraint;
    }

    // The second arg must be an int literal value.
    const index = getIntLiteralValue(arg1);
    if (index === undefined) {
        return whereConstraint;
    }

    const effectiveIndex = getTupleIndex(arg0TypeArgs, index, diag);
    if (effectiveIndex === undefined) {
        return whereConstraint;
    }

    if (effectiveIndex < 0) {
        return undefined;
    }

    return arg0TypeArgs[effectiveIndex].type;
}

function evalLen(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): ClassType | undefined {
    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length !== 1) {
        return whereConstraint;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    if (!arg0) {
        return undefined;
    }

    const arg0TypeArgs = getTupleTypeArgs(arg0);
    if (!arg0TypeArgs) {
        return whereConstraint;
    }

    if (containsUnboundedEntry(arg0TypeArgs)) {
        return whereConstraint;
    }

    return createIntLiteral(evaluator, arg0TypeArgs.length) ?? whereConstraint;
}

function evalMultiIndex(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): ClassType | undefined {
    // TODO - need to implement
    return undefined;
}

function evalPermute(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): ClassType | undefined {
    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length !== 2) {
        return whereConstraint;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    const arg1 = evalWhereConstraintType(evaluator, typeArgs[1], diag);

    if (!arg0 || !arg1) {
        return undefined;
    }

    // Args 0 and 1 should be tuples.
    const arg0TypeArgs = getTupleTypeArgs(arg0);
    const arg1TypeArgs = getTupleTypeArgs(arg1);
    if (!arg0TypeArgs || !arg1TypeArgs) {
        return whereConstraint;
    }

    // We don't handle unpacked entries.
    if (containsUnboundedEntry(arg0TypeArgs) || containsUnboundedEntry(arg1TypeArgs)) {
        return whereConstraint;
    }

    // Check for mismatch in lengths.
    if (arg0TypeArgs.length !== arg1TypeArgs.length) {
        diag?.addMessage(
            LocAddendum.whereConstraintPermuteMismatch().format({
                expected: arg0TypeArgs.length.toString(),
                received: arg1TypeArgs.length.toString(),
            })
        );
        return undefined;
    }

    const seenIndices = new Set<number>();
    const newEntries: TupleTypeArg[] = [];

    for (let i = 0; i < arg1TypeArgs.length; i++) {
        const index = getIntLiteralValue(arg1TypeArgs[i].type);
        if (index === undefined) {
            return whereConstraint;
        }

        const effectiveIndex = getTupleIndex(arg0TypeArgs, index, diag);

        if (effectiveIndex === undefined) {
            return whereConstraint;
        }

        if (effectiveIndex < 0) {
            return undefined;
        }

        // Check for duplicate indices.
        if (seenIndices.has(effectiveIndex)) {
            diag?.addMessage(LocAddendum.whereConstraintPermuteDuplicate());
            return undefined;
        }

        seenIndices.add(effectiveIndex);
        newEntries.push(arg0TypeArgs[effectiveIndex]);
    }

    assert(isClassInstance(arg0) && isTupleClass(arg0));

    return specializeTupleClass(arg0, newEntries, /* isTypeArgExplicit */ true);
}

function evalReshape(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): Type | undefined {
    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length !== 2) {
        return whereConstraint;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    const arg1 = evalWhereConstraintType(evaluator, typeArgs[1], diag);

    if (!arg0 || !arg1) {
        return undefined;
    }

    // Args 0 and 1 should be tuples.
    const arg0TypeArgs = getTupleTypeArgs(arg0);
    const arg1TypeArgs = getTupleTypeArgs(arg1);
    if (!arg0TypeArgs || !arg1TypeArgs) {
        return whereConstraint;
    }

    // We don't handle unbounded entries.
    if (containsUnboundedEntry(arg0TypeArgs) || containsUnboundedEntry(arg1TypeArgs)) {
        return whereConstraint;
    }

    let inferIndex: number | undefined;
    let srcDimProduct: TupleTypeArg[] = [];
    let destDimProduct: TupleTypeArg[] = [];

    for (let i = 0; i < arg0TypeArgs.length; i++) {
        const intType = getIntLiteralType(arg0TypeArgs[i].type);
        if (!intType) {
            return whereConstraint;
        }

        srcDimProduct.push(arg0TypeArgs[i]);
    }

    for (let i = 0; i < arg1TypeArgs.length; i++) {
        const intType = getIntLiteralType(arg1TypeArgs[i].type);
        if (!intType) {
            return whereConstraint;
        }

        const value = getIntLiteralValue(arg1TypeArgs[i].type);

        if (value === -1) {
            if (inferIndex !== undefined) {
                diag?.addMessage(LocAddendum.whenConstraintReshapeInferred());
                return undefined;
            }
            inferIndex = i;
        } else {
            destDimProduct.push(arg1TypeArgs[i]);
        }
    }

    srcDimProduct = simplifyProduct(evaluator, srcDimProduct);
    destDimProduct = simplifyProduct(evaluator, destDimProduct);

    const dimRemaining = diffProduct(evaluator, srcDimProduct, destDimProduct);
    if (!dimRemaining) {
        diag?.addMessage(LocAddendum.whenConstraintReshapeMismatch());
        return undefined;
    }

    if (inferIndex === undefined) {
        const value = getIntLiteralValue(dimRemaining.type);

        if (value !== undefined && value !== 1) {
            diag?.addMessage(LocAddendum.whenConstraintReshapeMismatch());
        }

        return arg1;
    }

    assert(isClassInstance(arg0) && isTupleClass(arg0));

    // Create a new tuple with the inferred dimension.
    const newEntries = [...arg1TypeArgs];
    newEntries[inferIndex] = dimRemaining;
    return specializeTupleClass(arg0, newEntries, /* isTypeArgExplicit */ true);
}

function evalSplice(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): ClassType | undefined {
    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length !== 4) {
        return whereConstraint;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    const arg1 = evalWhereConstraintType(evaluator, typeArgs[1], diag);
    const arg2 = evalWhereConstraintType(evaluator, typeArgs[2], diag);
    const arg3 = evalWhereConstraintType(evaluator, typeArgs[3], diag);

    if (!arg0 || !arg1 || !arg2 || !arg3) {
        return undefined;
    }

    // Args 0 and 3 should be tuples.
    const arg0TypeArgs = getTupleTypeArgs(arg0);
    const arg3TypeArgs = getTupleTypeArgs(arg3);
    if (!arg0TypeArgs || !arg3TypeArgs) {
        return whereConstraint;
    }

    // Args 1 and 2 should be int literals.
    const arg1Value = getIntLiteralValue(arg1);
    const arg2Value = getIntLiteralValue(arg2);
    if (arg1Value === undefined || arg2Value === undefined) {
        return whereConstraint;
    }

    const insertIndex = getTupleIndex(arg0TypeArgs, arg1Value, diag, /* allowFullLength */ true);
    if (insertIndex === undefined) {
        return whereConstraint;
    }
    if (insertIndex < 0) {
        return undefined;
    }

    const dropCount = arg2Value;
    if (dropCount < 0) {
        diag?.addMessage(LocAddendum.whereConstraintSpliceNegativeDrop());
        return undefined;
    }

    // Make sure the drop count is valid.
    if (arg0TypeArgs.length < insertIndex + dropCount) {
        if (containsUnboundedEntry(arg0TypeArgs.slice(insertIndex, insertIndex + dropCount))) {
            return whereConstraint;
        }

        diag?.addMessage(LocAddendum.whereConstraintIndexOutOfRange().format({ value: insertIndex + dropCount }));
        return undefined;
    }

    assert(isClassInstance(arg0) && isTupleClass(arg0));

    return specializeTupleClass(
        arg0,
        [...arg0TypeArgs.slice(0, insertIndex), ...arg3TypeArgs, ...arg0TypeArgs.slice(insertIndex + dropCount)],
        /* isTypeArgExplicit */ true
    );
}

function evalSwap(
    evaluator: TypeEvaluator,
    whereConstraint: ClassType,
    diag: DiagnosticAddendum | undefined
): ClassType | undefined {
    const typeArgs = whereConstraint.priv.typeArgs;
    if (!typeArgs || typeArgs.length !== 3) {
        return whereConstraint;
    }

    const arg0 = evalWhereConstraintType(evaluator, typeArgs[0], diag);
    const arg1 = evalWhereConstraintType(evaluator, typeArgs[1], diag);
    const arg2 = evalWhereConstraintType(evaluator, typeArgs[2], diag);

    if (!arg0 || !arg1 || !arg2) {
        return undefined;
    }

    // Arg 0 should be a tuple.
    const arg0TypeArgs = getTupleTypeArgs(arg0);
    if (!arg0TypeArgs) {
        return whereConstraint;
    }

    // Args 1 and 2 should be int literals.
    const arg1Value = getIntLiteralValue(arg1);
    const arg2Value = getIntLiteralValue(arg2);
    if (arg1Value === undefined || arg2Value === undefined) {
        return whereConstraint;
    }

    const index1 = getTupleIndex(arg0TypeArgs, arg1Value, diag);
    const index2 = getTupleIndex(arg0TypeArgs, arg2Value, diag);

    if (index1 !== undefined && index1 < 0) {
        return undefined;
    }

    if (index2 !== undefined && index2 < 0) {
        return undefined;
    }

    if (index1 === undefined || index2 === undefined) {
        return whereConstraint;
    }

    const newEntries = [...arg0TypeArgs];
    newEntries[index1] = arg0TypeArgs[index2];
    newEntries[index2] = arg0TypeArgs[index1];

    assert(isClassInstance(arg0) && isTupleClass(arg0));

    return specializeTupleClass(arg0, newEntries, /* isTypeArgExplicit */ true);
}

function simplifyNumericSum(evaluator: TypeEvaluator, type: Type): Type {
    const summableTerms: SummableTerm[] = [];
    getSummableTermsRecursive(type, /* isPositive */ true, summableTerms);

    const [numericTerms, symbolicTerms] = partition(
        summableTerms,
        (term) => getIntLiteralValue(term.type) !== undefined
    );

    let numericSum = numericTerms.reduce((accum, term) => {
        const value = Number(getIntLiteralValue(term.type));
        return term.isPositive ? accum + value : accum - value;
    }, 0);

    if (symbolicTerms.length === 0) {
        return createIntLiteral(evaluator, numericSum) ?? type;
    }

    const [posTerms, negTerms] = partition(symbolicTerms, (term) => term.isPositive);

    // TODO - cancel out terms that appear in both the pos and neg lists.

    let result: Type | undefined;

    if (posTerms.length > 0) {
        result = posTerms.shift()!.type;
    } else {
        result = createIntLiteral(evaluator, numericSum);
        if (!result) {
            return type;
        }
        numericSum = 0;
    }

    for (const term of posTerms) {
        result = createIntAddType(evaluator, result, term.type);
        if (!result) {
            return type;
        }
    }

    for (const term of negTerms) {
        result = createIntSubType(evaluator, result, term.type);
        if (!result) {
            return type;
        }
    }

    if (numericSum !== 0) {
        const numericType = createIntLiteral(evaluator, Math.abs(numericSum));
        if (!numericType) {
            return type;
        }

        if (numericSum < 0) {
            result = createIntSubType(evaluator, result, numericType);
        } else {
            result = createIntAddType(evaluator, result, numericType);
        }

        if (!result) {
            return type;
        }
    }

    return result;
}

// Converts numeric type into a list of summable subexpressions (positiver and negative)
// so they can be combined into a simpler expression.
function getSummableTermsRecursive(type: Type, isPositive: boolean, terms: SummableTerm[]): void {
    if (
        isClassInstance(type) &&
        ClassType.isBuiltIn(type, ['IntAdd', 'IntSub']) &&
        type.priv.typeArgs &&
        type.priv.typeArgs.length === 2
    ) {
        getSummableTermsRecursive(type.priv.typeArgs[0], isPositive, terms);
        getSummableTermsRecursive(
            type.priv.typeArgs[1],
            type.shared.name === 'IntAdd' ? isPositive : !isPositive,
            terms
        );
    } else {
        terms.push({ isPositive, type });
    }
}

// Given a list of entries, computes a simplified product of the entries.
// This includes collapsing any division operations.
function simplifyProduct(evaluator: TypeEvaluator, entries: TupleTypeArg[]): TupleTypeArg[] {
    // Simplify any division entries.
    // remaining.forEach((entry, index) => {
    //     if (isRefinementBinaryOp(entry, OperatorType.FloorDivide)) {
    //         for (let i = 0; i < remaining.length; i++) {
    //             if (i === index) {
    //                 continue;
    //             }

    //             if (isRefinementExprEquivalent(remaining[i], entry.rightExpr)) {
    //                 remaining[index] = entry.leftExpr;
    //                 remaining[i] = { nodeType: RefinementNodeType.Number, value: 1 };
    //                 break;
    //             }
    //         }
    //     }
    // });

    // Combine any numeric entries.
    const remaining: TupleTypeArg[] = [];
    let product = 1;

    for (const entry of entries) {
        const value = getIntLiteralValue(entry.type);
        if (value !== undefined) {
            product *= value;
        } else {
            remaining.push(entry);
        }
    }

    if (product !== 1) {
        remaining.push({
            type: createIntLiteral(evaluator, product) ?? UnknownType.create(),
            isUnbounded: false,
        });
    }

    return remaining;
}

// Diffs two sets of refinement expressions, removing any expressions
// from the left that are also found in the right. Combines the remaining
// items into a single product expression. If there are expressions
// on the right that are not found in the left, undefined is returned.
function diffProduct(evaluator: TypeEvaluator, left: TupleTypeArg[], right: TupleTypeArg[]): TupleTypeArg | undefined {
    const remaining = [...left];

    for (const rightEntry of right) {
        const index = remaining.findIndex((leftEntry) => isTypeSame(leftEntry.type, rightEntry.type));
        if (index < 0) {
            return undefined;
        }

        remaining.splice(index, 1);
    }

    // Create a single product expression.
    return createProductRecursive(evaluator, remaining);
}

function createProductRecursive(evaluator: TypeEvaluator, entries: TupleTypeArg[]): TupleTypeArg {
    if (entries.length === 0) {
        return { type: createIntLiteral(evaluator, 1) ?? UnknownType.create(), isUnbounded: false };
    }

    if (entries.length === 1) {
        return entries[0];
    }

    return {
        type:
            createIntMulType(
                evaluator,
                createProductRecursive(evaluator, entries.slice(0, -1)).type,
                entries[entries.length - 1].type
            ) ?? UnknownType.create(),
        isUnbounded: false,
    };
}

// function getVarReplacement(refinementVar: RefinementVar): RefinementExpr | undefined {
//     const conditions = refinementVar.shared.conditions;
//     if (!conditions) {
//         return undefined;
//     }

//     for (const condition of conditions) {
//         const conjunctions: RefinementExpr[] = [];
//         getConjunctionsRecursive(condition, conjunctions);

//         for (const expr of conjunctions) {
//             // Is this a condition of the form X = <expr> where X
//             // is the specified refinement var?
//             if (
//                 isRefinementBinaryOp(expr, OperatorType.Equals) &&
//                 isRefinementVar(expr.leftExpr) &&
//                 RefinementVar.isSameIgnoreBound(expr.leftExpr.var, refinementVar)
//             ) {
//                 return makeRefinementVarsBound(expr.rightExpr, [refinementVar.scopeId]);
//             }
//         }
//     }

//     return undefined;
// }
