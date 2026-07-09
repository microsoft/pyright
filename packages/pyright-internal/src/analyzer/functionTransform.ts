/*
 * functionTransform.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Code that transforms the return result of a function.
 *
 */

import { DiagnosticRule } from '../common/diagnosticRules';
import { LocMessage } from '../localization/localize';
import { ExpressionNode, ParamCategory } from '../parser/parseNodes';
import { Symbol, SymbolFlags } from './symbol';
import { makeTupleObject } from './tuples';
import { Arg, FunctionResult, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    OverloadedType,
    TupleTypeArg,
    Type,
} from './types';
import { ClassMember, lookUpObjectMember, MemberAccessFlags, synthesizeTypeVarForSelfCls } from './typeUtils';

export function applyFunctionTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    functionType: FunctionType | OverloadedType,
    result: FunctionResult
): FunctionResult {
    if (isFunction(functionType)) {
        if (functionType.shared.fullName === 'functools.total_ordering') {
            return applyTotalOrderingTransform(evaluator, errorNode, argList, result);
        }

        const structUnpackKind = getStructUnpackKind(functionType.shared.fullName);
        if (structUnpackKind !== undefined) {
            return applyStructUnpackTransform(evaluator, errorNode, argList, result, structUnpackKind);
        }
    }

    // By default, return the result unmodified.
    return result;
}

function applyTotalOrderingTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    result: FunctionResult
) {
    if (argList.length !== 1) {
        return result;
    }

    // This function is meant to apply to a concrete instantiable class.
    const classType = argList[0].typeResult?.type;
    if (!classType || !isInstantiableClass(classType) || classType.priv.includeSubclasses) {
        return result;
    }

    const orderingMethods = ['__lt__', '__le__', '__gt__', '__ge__'];
    const instanceType = ClassType.cloneAsInstance(classType);

    // Verify that the class has at least one of the required functions.
    let firstMemberFound: ClassMember | undefined;
    const missingMethods = orderingMethods.filter((methodName) => {
        const memberInfo = lookUpObjectMember(instanceType, methodName, MemberAccessFlags.SkipInstanceMembers);
        if (memberInfo && !firstMemberFound) {
            firstMemberFound = memberInfo;
        }
        return !memberInfo;
    });

    if (!firstMemberFound) {
        evaluator.addDiagnostic(
            DiagnosticRule.reportGeneralTypeIssues,
            LocMessage.totalOrderingMissingMethod(),
            errorNode
        );
        return result;
    }

    // Determine what type to use for the parameter corresponding to
    // the second operand. This will be taken from the existing method.
    let operandType: Type | undefined;

    const firstMemberType = evaluator.getTypeOfMember(firstMemberFound);
    if (
        isFunction(firstMemberType) &&
        firstMemberType.shared.parameters.length >= 2 &&
        FunctionParam.isTypeDeclared(firstMemberType.shared.parameters[1])
    ) {
        operandType = FunctionType.getParamType(firstMemberType, 1);
    }

    // If there was no provided operand type, fall back to object.
    if (!operandType) {
        const objectType = evaluator.getBuiltInObject(errorNode, 'object');
        if (!objectType || !isClassInstance(objectType)) {
            return result;
        }
        operandType = objectType;
    }

    const boolType = evaluator.getBuiltInObject(errorNode, 'bool');
    if (!boolType || !isClassInstance(boolType)) {
        return result;
    }

    const selfParam = FunctionParam.create(
        ParamCategory.Simple,
        synthesizeTypeVarForSelfCls(classType, /* isClsParam */ false),
        FunctionParamFlags.TypeDeclared,
        'self'
    );

    const objParam = FunctionParam.create(
        ParamCategory.Simple,
        operandType,
        FunctionParamFlags.TypeDeclared,
        '__value'
    );

    // Add the missing members to the class's symbol table.
    missingMethods.forEach((methodName) => {
        const methodToAdd = FunctionType.createSynthesizedInstance(methodName);
        FunctionType.addParam(methodToAdd, selfParam);
        FunctionType.addParam(methodToAdd, objParam);
        methodToAdd.shared.declaredReturnType = boolType;

        ClassType.getSymbolTable(classType).set(
            methodName,
            Symbol.createWithType(SymbolFlags.ClassMember, methodToAdd)
        );
    });

    return result;
}

// Distinguishes between the `struct` functions whose return type can be
// synthesized from a literal format string. `unpack` and `unpack_from`
// return a tuple; `iter_unpack` returns an iterator of tuples.
//
// Only the module-level `_struct.*` free functions are handled here. The
// reused-format API (`struct.Struct(fmt).unpack()` / `.unpack_from()` /
// `.iter_unpack()`) is out of scope: it would require threading the
// constructor's literal format through to the method calls, so those still
// infer the declared `tuple[Any, ...]`.
function getStructUnpackKind(fullName: string): StructUnpackKind | undefined {
    switch (fullName) {
        case '_struct.unpack':
        case '_struct.unpack_from':
            return 'tuple';

        case '_struct.iter_unpack':
            return 'iterator';

        default:
            return undefined;
    }
}

// To avoid performance issues with very large repeat counts, fall back to
// the declared return type (a homogeneous `Any` tuple) above this many elements.
const maxStructUnpackElementCount = 256;

function applyStructUnpackTransform(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    argList: Arg[],
    result: FunctionResult,
    kind: StructUnpackKind
): FunctionResult {
    // The format string is always the first positional argument.
    if (argList.length === 0) {
        return result;
    }

    const formatType = evaluator.getTypeOfArg(argList[0], /* inferenceContext */ undefined).type;
    if (!isClassInstance(formatType)) {
        return result;
    }

    // The format must be a `str` or `bytes` literal. Both store their value
    // as a string in `literalValue`.
    if (!ClassType.isBuiltIn(formatType, ['str', 'bytes'])) {
        return result;
    }

    const formatValue = formatType.priv.literalValue;
    if (typeof formatValue !== 'string') {
        return result;
    }

    const elementKinds = parseStructFormat(formatValue);
    if (!elementKinds || elementKinds.length > maxStructUnpackElementCount) {
        return result;
    }

    const elementTypeCache = new Map<StructElementType, Type>();
    const getElementType = (elementKind: StructElementType): Type | undefined => {
        let elementType = elementTypeCache.get(elementKind);
        if (!elementType) {
            const builtInType = evaluator.getBuiltInObject(errorNode, elementKind);
            if (!isClassInstance(builtInType)) {
                return undefined;
            }
            elementType = builtInType;
            elementTypeCache.set(elementKind, elementType);
        }
        return elementType;
    };

    const tupleArgs: TupleTypeArg[] = [];
    for (const elementKind of elementKinds) {
        const elementType = getElementType(elementKind);
        if (!elementType) {
            return result;
        }
        tupleArgs.push({ type: elementType, isUnbounded: false });
    }

    const tupleType = makeTupleObject(evaluator, tupleArgs);

    if (kind === 'tuple') {
        return { ...result, returnType: tupleType };
    }

    // iter_unpack returns an Iterator of the synthesized tuple type.
    const iteratorType = evaluator.getTypingType(errorNode, 'Iterator');
    if (!iteratorType || !isInstantiableClass(iteratorType)) {
        return result;
    }

    const iteratorInstance = ClassType.cloneAsInstance(ClassType.specialize(iteratorType, [tupleType]));
    return { ...result, returnType: iteratorInstance };
}

// Parses a struct format string (https://docs.python.org/3/library/struct.html)
// into the sequence of element types produced by `struct.unpack`. Returns
// undefined if the format string contains an unrecognized format code.
function parseStructFormat(format: string): StructElementType[] | undefined {
    const elements: StructElementType[] = [];
    let index = 0;

    // An optional leading byte-order/size/alignment character. The 'n', 'N',
    // and 'P' codes are only valid in native mode (no prefix or '@'); under an
    // explicit byte-order prefix ('=', '<', '>', '!') they raise struct.error.
    let isNativeMode = true;
    if (index < format.length && '@=<>!'.includes(format[index])) {
        isNativeMode = format[index] === '@';
        index++;
    }

    while (index < format.length) {
        const ch = format[index];

        // Whitespace between format codes is ignored.
        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v') {
            index++;
            continue;
        }

        // An optional repeat count precedes the format code.
        let count = -1;
        if (ch >= '0' && ch <= '9') {
            count = 0;
            while (index < format.length && format[index] >= '0' && format[index] <= '9') {
                count = count * 10 + (format.charCodeAt(index) - 0x30);
                index++;

                // Guard against pathologically large counts. This bounds the
                // accumulator itself; the produced element count is bounded
                // separately below so byte-length codes ('s'/'p') aren't
                // rejected for large counts.
                if (count > Number.MAX_SAFE_INTEGER) {
                    return undefined;
                }
            }

            // A count must be followed by a format code.
            if (index >= format.length) {
                return undefined;
            }
        }

        const code = format[index];
        index++;

        const elementKind = getStructElementType(code, isNativeMode);
        if (elementKind === undefined) {
            return undefined;
        }

        if (code === 's' || code === 'p') {
            // For 's' and 'p', the count is the byte length of a single value,
            // so it always produces exactly one element regardless of count.
            elements.push('bytes');
        } else if (elementKind === 'pad') {
            // Pad bytes ('x') produce no elements.
        } else {
            const repeat = count < 0 ? 1 : count;
            for (let i = 0; i < repeat; i++) {
                elements.push(elementKind);

                // Bound the produced element count to avoid performance issues
                // with very large repeat counts.
                if (elements.length > maxStructUnpackElementCount) {
                    return undefined;
                }
            }
        }
    }

    return elements;
}

function getStructElementType(code: string, isNativeMode: boolean): StructElementType | 'pad' | undefined {
    switch (code) {
        case 'x':
            return 'pad';

        case 'c':
        case 's':
        case 'p':
            return 'bytes';

        case 'b':
        case 'B':
        case 'h':
        case 'H':
        case 'i':
        case 'I':
        case 'l':
        case 'L':
        case 'q':
        case 'Q':
            return 'int';

        case 'n':
        case 'N':
        case 'P':
            // These codes are only available in native mode (no prefix or '@').
            // Under an explicit byte-order prefix they are invalid, so fall back
            // to the declared return type rather than synthesizing 'int'.
            return isNativeMode ? 'int' : undefined;

        case '?':
            return 'bool';

        case 'e':
        case 'f':
        case 'd':
            return 'float';

        default:
            return undefined;
    }
}

// The kind of return type synthesized for a dispatched `struct` function:
// a tuple (`unpack`/`unpack_from`) or an iterator of tuples (`iter_unpack`).
type StructUnpackKind = 'tuple' | 'iterator';

// The synthesized element type produced by a single struct format code.
type StructElementType = 'int' | 'float' | 'bool' | 'bytes';
