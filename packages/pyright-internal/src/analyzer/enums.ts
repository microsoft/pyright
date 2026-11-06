/*
 * enums.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the Enum class.
 */

import { assert } from '../common/debug';
import { PythonVersion, pythonVersion3_13 } from '../common/pythonVersion';
import { ArgCategory, ExpressionNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';
import { AnalyzerNodeInfoAccessor, AnalyzerNodeInfoReader, getFileInfo, getInfoReader } from './analyzerNodeInfo';
import { VariableDeclaration } from './declaration';
import { ParamKind, ParamListDetails } from './parameterUtils';
import { getClassFullName, getEnclosingClass, getTypeSourceId } from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { isPrivateName, isSingleDunderName } from './symbolNameUtils';
import { Arg, EvalFlags, FunctionResult, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { enumerateLiteralsForType } from './typeGuards';
import {
    MemberAccessFlags,
    computeMroLinearization,
    isNoneInstance,
    lookUpClassMember,
    makeInferenceContext,
    mapSubtypes,
} from './typeUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    EnumLiteral,
    FunctionType,
    OverloadedType,
    Type,
    TypeBase,
    UnknownType,
    combineTypes,
    findSubtype,
    isAny,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isNever,
    isOverloaded,
    maxTypeRecursionCount,
} from './types';

interface EnumEvalStackEntry {
    classType: ClassType;
    memberName: string;
}

// This stack is used to prevent infinite recursion when evaluating
// enum members that refer to other enum members.
const enumEvalStack: EnumEvalStackEntry[] = [];
const intFlagBitwiseMethods = new Set(['enum.IntFlag.__or__', 'enum.IntFlag.__xor__', 'enum.IntFlag.__and__']);

export function isIntFlagBitwiseFunction(method: FunctionType): boolean {
    return intFlagBitwiseMethods.has(method.shared.fullName);
}

// Determines whether the class is an Enum metaclass or a subclass thereof.
export function isEnumMetaclass(classType: ClassType) {
    return classType.shared.mro.some(
        (mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, ['EnumMeta', 'EnumType'])
    );
}

// Determines whether this is an enum class that has at least one enum
// member defined.
export function isEnumClassWithMembers(
    evaluator: TypeEvaluator,
    classType: ClassType,
    nodeInfo: AnalyzerNodeInfoReader
) {
    if (!isClass(classType) || !ClassType.isEnumClass(classType)) {
        return false;
    }

    // Determine whether the enum class defines a member.
    const symbolTable = ClassType.getSymbolTable(classType);
    for (const name of symbolTable.keys()) {
        const symbolType = transformTypeForEnumMember(evaluator, classType, name, nodeInfo);
        if (
            symbolType &&
            isClassInstance(symbolType) &&
            ClassType.isSameGenericClass(symbolType, ClassType.cloneAsInstance(classType))
        ) {
            return true;
        }
    }

    return false;
}

// Creates a new custom enum class with named values.
export function createEnumType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    enumClass: ClassType,
    argList: Arg[],
    nodeInfo: AnalyzerNodeInfoAccessor
): ClassType | undefined {
    const fileInfo = nodeInfo.getFileInfo(errorNode);
    const isReprEnum = isReprEnumClass(enumClass);

    if (argList.length === 0) {
        return undefined;
    }

    const nameArg = argList[0];
    if (
        nameArg.argCategory !== ArgCategory.Simple ||
        !nameArg.valueExpression ||
        nameArg.valueExpression.nodeType !== ParseNodeType.StringList ||
        nameArg.valueExpression.d.strings.length !== 1 ||
        nameArg.valueExpression.d.strings[0].nodeType !== ParseNodeType.String
    ) {
        return undefined;
    }

    const className = nameArg.valueExpression.d.strings.map((s) => s.d.value).join('');
    const classType = ClassType.createInstantiable(
        className,
        getClassFullName(errorNode, fileInfo.moduleName, className),
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.EnumClass | ClassTypeFlags.ValidTypeAliasClass,
        getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        enumClass.shared.effectiveMetaclass
    );
    classType.shared.baseClasses.push(enumClass);
    computeMroLinearization(classType);

    const classFields = ClassType.getSymbolTable(classType);
    classFields.set(
        '__class__',
        Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
    );
    synthesizeEnumBoundary(evaluator, classType, argList);

    if (argList.length < 2) {
        return undefined;
    }

    const initArg = argList[1];
    if (initArg.argCategory !== ArgCategory.Simple || !initArg.valueExpression) {
        return undefined;
    }

    const intClassType = evaluator.getBuiltInType(errorNode, 'int');
    if (!intClassType || !isInstantiableClass(intClassType)) {
        return undefined;
    }
    const classInstanceType = ClassType.cloneAsInstance(classType);
    const isFlag = enumClass.shared.mro.some((base) => isClass(base) && ClassType.isBuiltIn(base, 'Flag'));
    const startArg = isFlag ? argList.find((arg) => arg.name?.d.value === 'start') : undefined;
    const startType = startArg ? evaluator.getTypeOfArg(startArg, /* inferenceContext */ undefined).type : undefined;
    let nextFlagValue: bigint | undefined = BigInt(1);
    if (startArg) {
        nextFlagValue =
            startType &&
            isClassInstance(startType) &&
            (typeof startType.priv.literalValue === 'number' ||
                typeof startType.priv.literalValue === 'bigint' ||
                typeof startType.priv.literalValue === 'boolean')
                ? BigInt(startType.priv.literalValue)
                : undefined;
    }

    const getAutomaticValueType = (index: number): Type => {
        if (!isFlag) {
            return ClassType.cloneWithLiteral(ClassType.cloneAsInstance(intClassType), index + 1);
        }
        const generator = lookUpClassMember(enumClass, '_generate_next_value_');
        if (
            nextFlagValue === undefined ||
            !generator ||
            !isInstantiableClass(generator.classType) ||
            !ClassType.isBuiltIn(generator.classType, ['Enum', 'Flag'])
        ) {
            return ClassType.cloneAsInstance(intClassType);
        }
        const value = nextFlagValue;
        const magnitude = value < BigInt(0) ? -value : value;
        nextFlagValue = BigInt(1) << BigInt(magnitude === BigInt(0) ? 0 : magnitude.toString(2).length);
        return ClassType.cloneWithLiteral(
            ClassType.cloneAsInstance(intClassType),
            value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value
        );
    };

    // The Enum functional form supports various forms of arguments:
    //   Enum('name', 'a b c')
    //   Enum('name', 'a,b,c')
    //   Enum('name', ['a', 'b', 'c'])
    //   Enum('name', ('a', 'b', 'c'))
    //   Enum('name', (('a', 1), ('b', 2), ('c', 3)))
    //   Enum('name', [('a', 1), ('b', 2), ('c', 3))]
    //   Enum('name', {'a': 1, 'b': 2, 'c': 3})
    if (initArg.valueExpression.nodeType === ParseNodeType.StringList) {
        // Don't allow format strings in the init arg.
        if (!initArg.valueExpression.d.strings.every((str) => str.nodeType === ParseNodeType.String)) {
            return undefined;
        }

        const initStr = initArg.valueExpression.d.strings
            .map((s) => s.d.value)
            .join('')
            .trim();

        // Split by comma or whitespace.
        const entryNames = initStr.split(/[\s,]+/);

        for (const [index, entryName] of entryNames.entries()) {
            if (!entryName) {
                return undefined;
            }

            const valueType = getAutomaticValueType(index);

            const enumLiteral = new EnumLiteral(
                classType.shared.fullName,
                classType.shared.name,
                entryName,
                valueType,
                isReprEnum
            );

            const newSymbol = Symbol.createWithType(
                SymbolFlags.ClassMember,
                ClassType.cloneWithLiteral(classInstanceType, enumLiteral)
            );

            classFields.set(entryName, newSymbol);
        }

        return classType;
    }

    if (
        initArg.valueExpression.nodeType === ParseNodeType.List ||
        initArg.valueExpression.nodeType === ParseNodeType.Tuple
    ) {
        const entries =
            initArg.valueExpression.nodeType === ParseNodeType.List
                ? initArg.valueExpression.d.items
                : initArg.valueExpression.d.items;

        if (entries.length === 0) {
            return undefined;
        }

        // Entries can be either string literals or tuples of a string
        // literal and a value. All entries must follow the same pattern.
        let isSimpleString = false;
        for (const [index, entry] of entries.entries()) {
            if (index === 0) {
                isSimpleString = entry.nodeType === ParseNodeType.StringList;
            }

            let nameNode: ParseNode | undefined;
            let valueType: Type | undefined;

            if (entry.nodeType === ParseNodeType.StringList) {
                if (!isSimpleString) {
                    return undefined;
                }

                nameNode = entry;
                valueType = getAutomaticValueType(index);
            } else if (entry.nodeType === ParseNodeType.Tuple) {
                if (isSimpleString) {
                    return undefined;
                }

                if (entry.d.items.length !== 2) {
                    return undefined;
                }
                nameNode = entry.d.items[0];
                valueType = evaluator.getTypeOfExpression(entry.d.items[1]).type;
            } else {
                return undefined;
            }

            if (
                nameNode.nodeType !== ParseNodeType.StringList ||
                nameNode.d.strings.length !== 1 ||
                nameNode.d.strings[0].nodeType !== ParseNodeType.String
            ) {
                return undefined;
            }

            const entryName = nameNode.d.strings[0].d.value;

            const enumLiteral = new EnumLiteral(
                classType.shared.fullName,
                classType.shared.name,
                entryName,
                valueType,
                isReprEnum
            );

            const newSymbol = Symbol.createWithType(
                SymbolFlags.ClassMember,
                ClassType.cloneWithLiteral(classInstanceType, enumLiteral)
            );

            classFields.set(entryName, newSymbol);
        }
    }

    if (initArg.valueExpression.nodeType === ParseNodeType.Dictionary) {
        const entries = initArg.valueExpression.d.items;
        if (entries.length === 0) {
            return undefined;
        }

        for (const entry of entries) {
            // Don't support dictionary expansion expressions.
            if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
                return undefined;
            }

            const nameNode = entry.d.keyExpr;
            const valueType = evaluator.getTypeOfExpression(entry.d.valueExpr).type;

            if (
                nameNode.nodeType !== ParseNodeType.StringList ||
                nameNode.d.strings.length !== 1 ||
                nameNode.d.strings[0].nodeType !== ParseNodeType.String
            ) {
                return undefined;
            }

            const entryName = nameNode.d.strings[0].d.value;
            const enumLiteral = new EnumLiteral(
                classType.shared.fullName,
                classType.shared.name,
                entryName,
                valueType,
                isReprEnum
            );

            const newSymbol = Symbol.createWithType(
                SymbolFlags.ClassMember,
                ClassType.cloneWithLiteral(classInstanceType, enumLiteral)
            );

            classFields.set(entryName, newSymbol);
        }
    }

    return classType;
}

export function synthesizeEnumBoundary(evaluator: TypeEvaluator, classType: ClassType, args: Arg[]) {
    if (!ClassType.isEnumClass(classType)) {
        return;
    }

    const boundaryArg = args.find((arg) => arg.name?.d.value === 'boundary');
    let boundaryType =
        boundaryArg?.typeResult?.type ??
        (boundaryArg?.valueExpression ? evaluator.getTypeOfExpression(boundaryArg.valueExpression).type : undefined);

    // None selects the inherited boundary, just as omitting the keyword does.
    if (boundaryType && !isNoneInstance(boundaryType)) {
        const inheritedBoundary = lookUpClassMember(classType, '_boundary_', MemberAccessFlags.SkipInstanceMembers);
        const inheritedType = inheritedBoundary ? evaluator.getTypeOfMember(inheritedBoundary) : undefined;
        if (inheritedType) {
            boundaryType = mapSubtypes(boundaryType, (subtype) => (isNoneInstance(subtype) ? inheritedType : subtype));
        }
        ClassType.getSymbolTable(classType).set(
            '_boundary_',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, boundaryType)
        );
    }
}

export function getTypeOfIntFlagMember(
    evaluator: TypeEvaluator,
    classType: ClassType,
    memberType: Type,
    nodeInfo: AnalyzerNodeInfoReader
): Type {
    if (
        !ClassType.isEnumClass(classType) ||
        !isFunction(memberType) ||
        !intFlagBitwiseMethods.has(memberType.shared.fullName)
    ) {
        return memberType;
    }

    if (!canFlagEject(evaluator, classType)) {
        return memberType;
    }

    const nonNegativeValues = getNonNegativeFlagMask(evaluator, classType, nodeInfo) !== undefined;
    const intClass = classType.shared.mro.find((base) => isInstantiableClass(base) && ClassType.isBuiltIn(base, 'int'));
    const otherIndex = memberType.shared.parameters.findIndex((param) => param.name === 'other');
    if (!intClass || !isInstantiableClass(intClass) || otherIndex < 0) {
        return memberType;
    }

    const parameterTypes = memberType.shared.parameters.map((_, index) => FunctionType.getParamType(memberType, index));
    const intResult = FunctionType.specialize(memberType, {
        parameterTypes,
        parameterDefaultTypes: memberType.priv.specializedTypes?.parameterDefaultTypes,
        returnType: ClassType.cloneAsInstance(intClass),
    });
    const zeroType = ClassType.cloneWithLiteral(ClassType.cloneAsInstance(intClass), 0);
    if (
        !nonNegativeValues &&
        (!hasStandardFlagConstruction(classType) || !isEnumClassWithMembers(evaluator, classType, nodeInfo))
    ) {
        return intResult;
    }

    // Zero is safe even for negative flag values. Nonnegative flags are also
    // closed over operations with another value of the same enum.
    const flagParameters = [...parameterTypes];
    flagParameters[otherIndex] = nonNegativeValues
        ? combineTypes([ClassType.cloneAsInstance(classType), zeroType])
        : zeroType;
    const flagResult = FunctionType.specialize(memberType, {
        parameterTypes: flagParameters,
        parameterDefaultTypes: memberType.priv.specializedTypes?.parameterDefaultTypes,
        returnType: FunctionType.getEffectiveReturnType(memberType),
    });
    return OverloadedType.create([flagResult, intResult]);
}

export function applyIntFlagTransform(
    evaluator: TypeEvaluator,
    method: FunctionType,
    argumentTypes: ReadonlyMap<string, Type>,
    result: FunctionResult
): FunctionResult {
    if (!isIntFlagBitwiseFunction(method)) {
        return result;
    }

    const isBound = !!method.priv.strippedFirstParamType;
    const receiver = isBound ? method.priv.boundToType : argumentTypes.get('self');
    if (!receiver) {
        return result;
    }

    const returnType = getIntFlagReturnType(
        evaluator,
        method,
        receiver,
        argumentTypes.get('other') ?? UnknownType.create(),
        result.returnType
    );
    return {
        ...result,
        returnType,
    };
}

export function getIntFlagReturnTypeForCallable(
    evaluator: TypeEvaluator,
    method: FunctionType,
    srcParams: ParamListDetails,
    destParams: ParamListDetails,
    returnType: Type
): Type | undefined {
    if (
        !intFlagBitwiseMethods.has(method.shared.fullName) ||
        srcParams.params.length !== destParams.params.length ||
        destParams.argsIndex !== undefined ||
        destParams.kwargsIndex !== undefined
    ) {
        return undefined;
    }

    const getArgType = (index: number) => {
        const name = srcParams.params[index]?.param.name;
        const param =
            destParams.params.find(
                (param) =>
                    param.kind !== ParamKind.Positional &&
                    param.kind !== ParamKind.ExpandedArgs &&
                    param.param.name === name
            ) ?? destParams.params[index];
        return param?.type;
    };
    const isBound = !!method.priv.strippedFirstParamType;
    const receiver = isBound ? method.priv.boundToType : getArgType(0);
    const other = getArgType(isBound ? 0 : 1);
    // An empty argument domain adds no evidence that could invalidate the matched signature.
    return receiver && other && !isNever(other)
        ? getIntFlagReturnType(evaluator, method, receiver, other, returnType)
        : undefined;
}

function getIntFlagReturnType(
    evaluator: TypeEvaluator,
    method: FunctionType,
    receiver: Type,
    otherType: Type,
    returnType: Type
): Type {
    if (isNever(otherType)) {
        return returnType;
    }

    const overloads = method.priv.overloaded ? OverloadedType.getOverloads(method.priv.overloaded) : undefined;
    const flagReturn = !method.priv.strippedFirstParamType
        ? mapSubtypes(receiver, (subtype) =>
              isClassInstance(subtype) ? ClassType.cloneWithLiteral(subtype, /* value */ undefined) : subtype
          )
        : overloads?.[0]
        ? FunctionType.getEffectiveReturnType(overloads[0]) ?? returnType
        : returnType;
    let expandedOtherType: Type | undefined;
    return mapSubtypes(evaluator.makeTopLevelTypeVarsConcrete(receiver), (classType) => {
        if (!isClassInstance(classType) || !ClassType.isEnumClass(classType)) {
            return returnType;
        }
        if (!canFlagEject(evaluator, classType)) {
            return flagReturn;
        }
        const intClass = classType.shared.mro.find(
            (base) => isInstantiableClass(base) && ClassType.isBuiltIn(base, 'int')
        );
        if (!intClass || !isInstantiableClass(intClass)) {
            return returnType;
        }
        expandedOtherType ??= mapSubtypes(evaluator.makeTopLevelTypeVarsConcrete(otherType), (other) => {
            if (
                isClassInstance(other) &&
                other.priv.literalValue === undefined &&
                (ClassType.isBuiltIn(other, 'bool') ||
                    (ClassType.isEnumClass(other) && hasStandardFlagConstruction(other)))
            ) {
                const literals = enumerateLiteralsForType(evaluator, other);
                if (literals && literals.length > 0) {
                    // Keep the numeric alternatives rather than collapsing True | False back to bool.
                    return combineTypes(
                        literals.map((literal) =>
                            ClassType.isBuiltIn(literal, 'bool')
                                ? ClassType.cloneWithLiteral(
                                      ClassType.cloneAsInstance(intClass),
                                      literal.priv.literalValue ? 1 : 0
                                  )
                                : literal
                        )
                    );
                }
            }
            return other;
        });
        const mask = getNonNegativeFlagMask(evaluator, classType, getInfoReader(evaluator));
        const allBits =
            mask !== undefined
                ? (BigInt(1) << BigInt(mask === BigInt(0) ? 0 : mask.toString(2).length)) - BigInt(1)
                : undefined;
        const intType = ClassType.cloneAsInstance(intClass);
        return mapSubtypes(expandedOtherType, (other) => {
            if (flagReturn) {
                const concreteOther = evaluator.makeTopLevelTypeVarsConcrete(other);
                if (
                    mask !== undefined &&
                    isClassInstance(concreteOther) &&
                    ClassType.isSameGenericClass(classType, concreteOther)
                ) {
                    return flagReturn;
                }
                const valueType = getIntFlagOperandValueType(evaluator, method, other, intClass, mask !== undefined);
                if (
                    valueType &&
                    isClassInstance(valueType) &&
                    ClassType.isBuiltIn(valueType, ['int', 'bool']) &&
                    (typeof valueType.priv.literalValue === 'number' ||
                        typeof valueType.priv.literalValue === 'bigint' ||
                        typeof valueType.priv.literalValue === 'boolean')
                ) {
                    const value = BigInt(valueType.priv.literalValue);
                    if (mask !== undefined && method.shared.name === '__and__') {
                        return flagReturn;
                    }
                    if (
                        value === BigInt(0) &&
                        hasStandardFlagConstruction(classType) &&
                        isEnumClassWithMembers(evaluator, classType, getInfoReader(evaluator))
                    ) {
                        return flagReturn;
                    }
                    if (
                        mask !== undefined &&
                        allBits !== undefined &&
                        value >= ~allBits &&
                        value <= allBits &&
                        (value & (allBits ^ mask)) === BigInt(0)
                    ) {
                        return flagReturn;
                    }
                }
            }
            return intType;
        });
    });
}

function getIntFlagOperandValueType(
    evaluator: TypeEvaluator,
    method: FunctionType,
    other: Type,
    intClass: ClassType,
    nonNegativeReceiver: boolean
): Type | undefined {
    if (!isClassInstance(other) || !(other.priv.literalValue instanceof EnumLiteral)) {
        return other;
    }
    if (!hasStandardFlagConstruction(other)) {
        return undefined;
    }

    const reflectedName = `__r${method.shared.name.slice(2)}`;
    const reflected = lookUpClassMember(other, reflectedName);
    const reflectedType = reflected ? evaluator.getTypeOfMember(reflected) : undefined;
    const functions = reflectedType
        ? isOverloaded(reflectedType)
            ? OverloadedType.getOverloads(reflectedType)
            : isFunction(reflectedType)
            ? [reflectedType]
            : []
        : [];
    if (functions.length === 0) {
        return undefined;
    }
    const valueType = other.priv.literalValue.itemType;
    if (
        functions.every(
            (fn) =>
                fn.shared.fullName === `${intClass.shared.fullName}.${reflectedName}` ||
                fn.shared.fullName === `${intClass.shared.fullName}.${method.shared.name}`
        )
    ) {
        return valueType;
    }

    // Another standard flag can normalize negative values or mask bits under CONFORM.
    // For nonnegative operands, masking cannot introduce bits outside the receiver.
    if (
        nonNegativeReceiver &&
        functions.every((fn) => fn.shared.fullName === method.shared.fullName) &&
        isClassInstance(valueType) &&
        (typeof valueType.priv.literalValue === 'number' || typeof valueType.priv.literalValue === 'bigint') &&
        valueType.priv.literalValue >= 0 &&
        getNonNegativeFlagMask(evaluator, other, getInfoReader(evaluator)) !== undefined
    ) {
        return valueType;
    }
    return undefined;
}

function canFlagEject(evaluator: TypeEvaluator, classType: ClassType): boolean {
    if (!ClassType.isEnumClass(classType)) {
        return false;
    }
    const member = lookUpClassMember(classType, '_boundary_', MemberAccessFlags.SkipInstanceMembers);
    return (
        (!!member &&
            !!findSubtype(
                evaluator.getTypeOfMember(member),
                (subtype) =>
                    isAnyOrUnknown(subtype) ||
                    (isClassInstance(subtype) &&
                        ClassType.isBuiltIn(subtype, 'FlagBoundary') &&
                        (!(subtype.priv.literalValue instanceof EnumLiteral) ||
                            subtype.priv.literalValue.itemName === 'EJECT'))
            )) ||
        !isEnumClassWithMembers(evaluator, classType, getInfoReader(evaluator))
    );
}

function getNonNegativeFlagMask(
    evaluator: TypeEvaluator,
    classType: ClassType,
    nodeInfo: AnalyzerNodeInfoReader
): bigint | undefined {
    if (!hasStandardFlagConstruction(classType)) {
        return undefined;
    }

    let foundMember = false;
    let mask = BigInt(0);
    const memberValues = new Map<string, bigint>();
    const getAutomaticValue = (node: ExpressionNode, recursionCount = 0): bigint | undefined => {
        if (recursionCount > maxTypeRecursionCount) {
            return undefined;
        }
        if (node.nodeType === ParseNodeType.Name) {
            return memberValues.get(node.d.value);
        }
        if (node.nodeType === ParseNodeType.Number && node.d.isInteger && !node.d.isImaginary) {
            return BigInt(node.d.value);
        }
        if (node.nodeType === ParseNodeType.BinaryOperation) {
            const left = getAutomaticValue(node.d.leftExpr, recursionCount + 1);
            const right = getAutomaticValue(node.d.rightExpr, recursionCount + 1);
            if (left !== undefined && right !== undefined) {
                switch (node.d.operator) {
                    case OperatorType.BitwiseOr:
                        return left | right;
                    case OperatorType.BitwiseAnd:
                        return left & right;
                    case OperatorType.BitwiseXor:
                        return left ^ right;
                }
            }
        }
        if (node.nodeType === ParseNodeType.Call) {
            const callee = evaluator.getTypeOfExpression(node.d.leftExpr).type;
            const generator = lookUpClassMember(classType, '_generate_next_value_');
            if (
                isInstantiableClass(callee) &&
                ClassType.isBuiltIn(callee, 'auto') &&
                generator &&
                isInstantiableClass(generator.classType) &&
                ClassType.isBuiltIn(generator.classType, ['Enum', 'Flag'])
            ) {
                return BigInt(1) << BigInt(mask === BigInt(0) ? 0 : mask.toString(2).length);
            }
        }
        return undefined;
    };
    for (const [name, symbol] of ClassType.getSymbolTable(classType)) {
        if (symbol.isIgnoredForProtocolMatch()) {
            continue;
        }

        const type =
            transformTypeForEnumMember(evaluator, classType, name, nodeInfo) ??
            evaluator.getEffectiveTypeOfSymbol(symbol);
        if (
            isClassInstance(type) &&
            ClassType.isSameGenericClass(type, classType) &&
            type.priv.literalValue instanceof EnumLiteral
        ) {
            const valueType = type.priv.literalValue.itemType;
            let value = memberValues.get(type.priv.literalValue.itemName);
            if (
                value === undefined &&
                isClassInstance(valueType) &&
                ClassType.isBuiltIn(valueType, ['int', 'bool']) &&
                (typeof valueType.priv.literalValue === 'number' ||
                    typeof valueType.priv.literalValue === 'bigint' ||
                    typeof valueType.priv.literalValue === 'boolean')
            ) {
                value = BigInt(valueType.priv.literalValue);
            }
            if (value === undefined) {
                const declaration = symbol.getDeclarations()[0];
                const assignment = declaration?.node.parent;
                if (assignment?.nodeType === ParseNodeType.Assignment) {
                    value = getAutomaticValue(assignment.d.rightExpr);
                }
            }
            if (value === undefined || value < BigInt(0)) {
                return undefined;
            }
            memberValues.set(name, value);
            mask |= value;
            foundMember = true;
        }
    }
    return foundMember ? mask : undefined;
}

function hasStandardFlagConstruction(classType: ClassType): boolean {
    if (ClassType.isEnumMemberSetMayBeDynamicallyModified(classType)) {
        return false;
    }
    // Custom construction or storage may change the values assigned in the class body.
    return !['__new__', '__init__', '_missing_', '_value_'].some((name) => {
        const member = lookUpClassMember(classType, name);
        return member && isClass(member.classType) && !ClassType.isBuiltIn(member.classType);
    });
}

// Performs the "magic" that the Enum metaclass does at runtime when it
// transforms a value into an enum instance. If the specified name isn't
// an enum member, this function returns undefined indicating that the
// Enum metaclass does not transform the value.
// By default, if a type annotation is present, the member is not treated
// as a member of the enumeration, but the Enum metaclass ignores such
// annotations. The typing spec indicates that the use of an annotation is
// illegal, so we need to detect this case and report an error.
export function transformTypeForEnumMember(
    evaluator: TypeEvaluator,
    classType: ClassType,
    memberName: string,
    nodeInfo: AnalyzerNodeInfoReader,
    ignoreAnnotation = false,
    recursionCount = 0
): Type | undefined {
    if (!ClassType.isEnumClass(classType)) {
        return undefined;
    }

    if (recursionCount > maxTypeRecursionCount) {
        return undefined;
    }
    recursionCount++;

    // Avoid infinite recursion.
    if (
        enumEvalStack.find(
            (entry) => ClassType.isSameGenericClass(entry.classType, classType) && entry.memberName === memberName
        )
    ) {
        return undefined;
    }

    enumEvalStack.push({ classType, memberName });

    try {
        const memberInfo = lookUpClassMember(classType, memberName);
        if (!memberInfo || !isClass(memberInfo.classType) || !ClassType.isEnumClass(memberInfo.classType)) {
            return undefined;
        }

        const decls = memberInfo.symbol.getDeclarations();
        if (decls.length < 1) {
            return undefined;
        }

        const primaryDecl = decls[0];

        let isMemberOfEnumeration = false;
        let isUnpackedTuple = false;
        let valueTypeExprNode: ExpressionNode | undefined;
        let declaredTypeNode: ExpressionNode | undefined;
        let nameNode: NameNode | undefined;

        if (primaryDecl.node.nodeType === ParseNodeType.Name) {
            nameNode = primaryDecl.node;
        } else if (
            primaryDecl.node.nodeType === ParseNodeType.Function ||
            primaryDecl.node.nodeType === ParseNodeType.Class
        ) {
            // Handle the case where a method or class is decorated with @enum.member.
            nameNode = primaryDecl.node.d.name;
        } else {
            return undefined;
        }

        if (nameNode.parent?.nodeType === ParseNodeType.Assignment && nameNode.parent.d.leftExpr === nameNode) {
            isMemberOfEnumeration = true;
            valueTypeExprNode = nameNode.parent.d.rightExpr;
        } else if (
            nameNode.parent?.nodeType === ParseNodeType.Tuple &&
            nameNode.parent.parent?.nodeType === ParseNodeType.Assignment
        ) {
            isMemberOfEnumeration = true;
            isUnpackedTuple = true;
            valueTypeExprNode = nameNode.parent.parent.d.rightExpr;
        } else if (
            nameNode.parent?.nodeType === ParseNodeType.TypeAnnotation &&
            nameNode.parent.d.valueExpr === nameNode
        ) {
            if (ignoreAnnotation) {
                isMemberOfEnumeration = true;
            }
            declaredTypeNode = nameNode.parent.d.annotation;
        }

        // The spec specifically excludes names that start and end with a single underscore.
        // This also includes dunder names.
        if (isSingleDunderName(memberName)) {
            return undefined;
        }

        // Specifically exclude "value" and "name". These are reserved by the enum metaclass.
        if (memberName === 'name' || memberName === 'value') {
            return undefined;
        }

        const declaredType = declaredTypeNode ? evaluator.getTypeOfAnnotation(declaredTypeNode) : undefined;
        let assignedType: Type | undefined;

        if (valueTypeExprNode) {
            const fileInfo = getFileInfo(valueTypeExprNode, nodeInfo);
            const evalFlags = fileInfo.isStubFile ? EvalFlags.ConvertEllipsisToAny : undefined;
            assignedType = evaluator.getTypeOfExpression(valueTypeExprNode, evalFlags).type;
        }

        // Handle aliases to other enum members within the same enum.
        if (valueTypeExprNode?.nodeType === ParseNodeType.Name && valueTypeExprNode.d.value !== memberName) {
            const aliasedEnumType = transformTypeForEnumMember(
                evaluator,
                classType,
                valueTypeExprNode.d.value,
                nodeInfo,
                /* ignoreAnnotation */ false,
                recursionCount
            );

            if (
                aliasedEnumType &&
                isClassInstance(aliasedEnumType) &&
                ClassType.isSameGenericClass(aliasedEnumType, ClassType.cloneAsInstance(memberInfo.classType)) &&
                aliasedEnumType.priv.literalValue !== undefined
            ) {
                return aliasedEnumType;
            }
        }

        if (primaryDecl.node.nodeType === ParseNodeType.Function) {
            const functionTypeInfo = evaluator.getTypeOfFunction(primaryDecl.node);
            if (functionTypeInfo) {
                assignedType = functionTypeInfo.decoratedType;
            }
        } else if (primaryDecl.node.nodeType === ParseNodeType.Class) {
            const classTypeInfo = evaluator.getTypeOfClass(primaryDecl.node);
            if (classTypeInfo) {
                assignedType = classTypeInfo.decoratedType;

                // If the class is not marked as a member or a non-member, the behavior
                // depends on the version of Python. In versions prior to 3.13, classes
                // are treated as members.
                if (isInstantiableClass(assignedType)) {
                    const fileInfo = getFileInfo(primaryDecl.node, nodeInfo);
                    isMemberOfEnumeration = PythonVersion.isLessThan(
                        fileInfo.executionEnvironment.pythonVersion,
                        pythonVersion3_13
                    );
                }
            }
        }

        let valueType = declaredType ?? assignedType ?? UnknownType.create();

        // If the LHS is an unpacked tuple, we need to handle this as
        // a special case.
        if (isUnpackedTuple) {
            valueType =
                evaluator.getTypeOfIterator(
                    { type: valueType },
                    /* isAsync */ false,
                    nameNode,
                    /* emitNotIterableError */ false
                )?.type ?? UnknownType.create();
        }

        // The spec excludes descriptors.
        if (isClassInstance(valueType) && ClassType.getSymbolTable(valueType).get('__get__')) {
            return undefined;
        }

        // The spec excludes private (mangled) names.
        if (isPrivateName(memberName)) {
            return undefined;
        }

        // The enum spec doesn't explicitly specify this, but it
        // appears that callables are excluded.
        if (!findSubtype(valueType, (subtype) => !isFunctionOrOverloaded(subtype))) {
            return undefined;
        }

        if (
            !assignedType &&
            nameNode.parent?.nodeType === ParseNodeType.Assignment &&
            nameNode.parent.d.leftExpr === nameNode
        ) {
            assignedType = evaluator.getTypeOfExpression(
                nameNode.parent.d.rightExpr,
                /* flags */ undefined,
                makeInferenceContext(declaredType)
            ).type;
        }

        // Handle the Python 3.11 "enum.member()" and "enum.nonmember()" features.
        if (assignedType && isClassInstance(assignedType) && ClassType.isBuiltIn(assignedType)) {
            if (assignedType.shared.fullName === 'enum.nonmember') {
                const nonMemberType =
                    assignedType.priv.typeArgs && assignedType.priv.typeArgs.length > 0
                        ? assignedType.priv.typeArgs[0]
                        : UnknownType.create();

                // If the type of the nonmember is declared and the assigned value has
                // a compatible type, use the declared type.
                if (declaredType && evaluator.assignType(declaredType, nonMemberType)) {
                    return declaredType;
                }

                return nonMemberType;
            }

            if (assignedType.shared.fullName === 'enum.member') {
                valueType =
                    assignedType.priv.typeArgs && assignedType.priv.typeArgs.length > 0
                        ? assignedType.priv.typeArgs[0]
                        : UnknownType.create();
                isMemberOfEnumeration = true;
            }
        }

        if (!isMemberOfEnumeration) {
            return undefined;
        }

        const enumLiteral = new EnumLiteral(
            memberInfo.classType.shared.fullName,
            memberInfo.classType.shared.name,
            memberName,
            valueType,
            isReprEnumClass(classType)
        );

        return ClassType.cloneAsInstance(ClassType.cloneWithLiteral(memberInfo.classType, enumLiteral));
    } finally {
        enumEvalStack.pop();
    }
}

export function isDeclInEnumClass(evaluator: TypeEvaluator, decl: VariableDeclaration): boolean {
    const classNode = getEnclosingClass(decl.node, /* stopAtFunction */ true);
    if (!classNode) {
        return false;
    }

    const classInfo = evaluator.getTypeOfClass(classNode);
    if (!classInfo) {
        return false;
    }

    return ClassType.isEnumClass(classInfo.classType);
}

export function getEnumDeclaredValueType(
    evaluator: TypeEvaluator,
    classType: ClassType,
    declaredTypesOnly = false
): Type | undefined {
    // See if there is a declared type for "_value_".
    let valueType: Type | undefined;

    const declaredValueMember = lookUpClassMember(
        classType,
        '_value_',
        declaredTypesOnly ? MemberAccessFlags.DeclaredTypesOnly : MemberAccessFlags.Default
    );

    // If the declared type comes from the 'Enum' base class, ignore it
    // because it will be "Any", which isn't useful to us here.
    if (
        declaredValueMember &&
        declaredValueMember.classType &&
        isClass(declaredValueMember.classType) &&
        !ClassType.isBuiltIn(declaredValueMember.classType, 'Enum')
    ) {
        valueType = evaluator.getTypeOfMember(declaredValueMember);
    }

    return valueType;
}

export function getTypeOfEnumMember(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    memberName: string,
    isIncomplete: boolean,
    nodeInfo: AnalyzerNodeInfoAccessor
): TypeResult | undefined {
    if (!ClassType.isEnumClass(classType)) {
        return undefined;
    }

    const type = transformTypeForEnumMember(evaluator, classType, memberName, nodeInfo);
    if (type) {
        return { type, isIncomplete };
    }

    if (TypeBase.isInstantiable(classType)) {
        return undefined;
    }

    // Handle the special case of 'name' and 'value' members within an enum.
    const literalValue = classType.priv.literalValue;

    if (memberName === 'name' || memberName === '_name_') {
        // Does the class explicitly override this member? Or it it using the
        // standard behavior provided by the "Enum" class?
        const memberInfo = lookUpClassMember(classType, memberName);
        if (memberInfo && isClass(memberInfo.classType) && !ClassType.isBuiltIn(memberInfo.classType, 'Enum')) {
            return undefined;
        }

        const strClass = evaluator.getBuiltInType(errorNode, 'str');
        if (!isInstantiableClass(strClass)) {
            return undefined;
        }

        const makeNameType = (value: EnumLiteral) => {
            return ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strClass, value.itemName));
        };

        if (literalValue) {
            assert(literalValue instanceof EnumLiteral);
            return { type: makeNameType(literalValue), isIncomplete };
        }

        // The type wasn't associated with a particular enum literal, so return
        // a union of all possible enum literals.
        const literalValues = enumerateLiteralsForType(evaluator, classType);
        if (literalValues && literalValues.length > 0) {
            return {
                type: combineTypes(
                    literalValues.map((literalClass) => {
                        const literalValue = literalClass.priv.literalValue;
                        assert(literalValue instanceof EnumLiteral);
                        return makeNameType(literalValue);
                    })
                ),
                isIncomplete,
            };
        }
    }

    // See if there is a declared type for "_value_".
    const valueType = getEnumDeclaredValueType(evaluator, classType);

    if (memberName === 'value' || memberName === '_value_') {
        // Does the class explicitly override this member? Or it it using the
        // standard behavior provided by the "Enum" class and other built-in
        // subclasses like "StrEnum" and "IntEnum"?
        const memberInfo = lookUpClassMember(classType, memberName);
        if (memberInfo && isClass(memberInfo.classType) && !ClassType.isBuiltIn(memberInfo.classType)) {
            return undefined;
        }

        // If the enum class has a custom metaclass, it may implement some
        // "magic" that computes different values for the "_value_" attribute.
        // This occurs, for example, in the django TextChoices class. If we
        // detect a custom metaclass, we'll use the declared type of _value_
        // if it is declared.
        const metaclass = classType.shared.effectiveMetaclass;
        if (metaclass && isClass(metaclass) && !ClassType.isBuiltIn(metaclass)) {
            return { type: valueType ?? AnyType.create(), isIncomplete };
        }

        // If the enum class has a custom __new__ or __init__ method,
        // it may implement some magic that computes different values for
        // the "_value_" attribute. If we see a customer __new__ or __init__,
        // we'll assume the value type is what we computed above, or Any.
        const newMember = lookUpClassMember(classType, '__new__', MemberAccessFlags.SkipObjectBaseClass);
        const initMember = lookUpClassMember(classType, '__init__', MemberAccessFlags.SkipObjectBaseClass);

        if (newMember && isClass(newMember.classType) && !ClassType.isBuiltIn(newMember.classType)) {
            return { type: valueType ?? AnyType.create(), isIncomplete };
        }

        if (initMember && isClass(initMember.classType) && !ClassType.isBuiltIn(initMember.classType)) {
            return { type: valueType ?? AnyType.create(), isIncomplete };
        }

        // There were no explicit assignments to the "_value_" attribute, so we can
        // assume that the values are assigned directly to the "_value_" by
        // the EnumMeta metaclass.
        if (literalValue) {
            assert(literalValue instanceof EnumLiteral);

            // If there is no known value type for this literal value,
            // return undefined. This will cause the caller to fall back
            // on the definition of "_value_" within the class definition
            // (if present).
            if (isAny(literalValue.itemType)) {
                return valueType ? { type: valueType, isIncomplete } : undefined;
            }

            return { type: literalValue.itemType, isIncomplete };
        }

        // The type wasn't associated with a particular enum literal, so return
        // a union of all possible enum literals.
        const literalValues = enumerateLiteralsForType(evaluator, classType);
        if (literalValues && literalValues.length > 0) {
            return {
                type: combineTypes(
                    literalValues.map((literalClass) => {
                        const literalValue = literalClass.priv.literalValue;
                        assert(literalValue instanceof EnumLiteral);
                        return literalValue.itemType;
                    })
                ),
                isIncomplete,
            };
        }
    }

    return undefined;
}

export function getEnumAutoValueType(evaluator: TypeEvaluator, node: ExpressionNode) {
    const containingClassNode = getEnclosingClass(node);

    if (containingClassNode) {
        const classTypeInfo = evaluator.getTypeOfClass(containingClassNode);
        if (classTypeInfo) {
            const memberInfo = evaluator.getTypeOfBoundMember(
                node,
                ClassType.cloneAsInstance(classTypeInfo.classType),
                '_generate_next_value_'
            );

            // Did we find a custom _generate_next_value_ sunder override?
            // Ignore if this comes from Enum because it is declared as
            // returning an "Any" type in the typeshed stubs.
            if (
                memberInfo &&
                !memberInfo.typeErrors &&
                isFunction(memberInfo.type) &&
                memberInfo.classType &&
                isClass(memberInfo.classType) &&
                !ClassType.isBuiltIn(memberInfo.classType, 'Enum')
            ) {
                if (memberInfo.type.shared.declaredReturnType) {
                    return memberInfo.type.shared.declaredReturnType;
                }
            }
        }
    }

    return evaluator.getBuiltInObject(node, 'int');
}

function isReprEnumClass(enumClass: ClassType) {
    return enumClass.shared.mro.some((mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, 'ReprEnum'));
}
