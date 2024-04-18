/*
 * enums.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the Enum class.
 */

import { assert } from '../common/debug';
import { ArgumentCategory, ExpressionNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { VariableDeclaration } from './declaration';
import {
    getClassFullName,
    getEnclosingClass,
    getParentNodeOfType,
    getTypeSourceId,
    isNodeContainedWithin,
} from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { isPrivateName, isSingleDunderName } from './symbolNameUtils';
import { FunctionArgument, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { enumerateLiteralsForType } from './typeGuards';
import { MemberAccessFlags, computeMroLinearization, lookUpClassMember, makeInferenceContext } from './typeUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    EnumLiteral,
    Type,
    UnknownType,
    combineTypes,
    findSubtype,
    isAny,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isOverloadedFunction,
} from './types';

// Determines whether the class is an Enum metaclass or a subclass thereof.
export function isEnumMetaclass(classType: ClassType) {
    return classType.details.mro.some(
        (mroClass) => isClass(mroClass) && ClassType.isBuiltIn(mroClass, ['EnumMeta', 'EnumType'])
    );
}

// Determines whether this is an enum class that has at least one enum
// member defined.
export function isEnumClassWithMembers(evaluator: TypeEvaluator, classType: ClassType) {
    if (!isClass(classType) || !ClassType.isEnumClass(classType)) {
        return false;
    }

    // Determine whether the enum class defines a member.
    let definesValue = false;

    ClassType.getSymbolTable(classType).forEach((symbol) => {
        const symbolType = evaluator.getEffectiveTypeOfSymbol(symbol);
        if (isClassInstance(symbolType) && ClassType.isSameGenericClass(symbolType, classType)) {
            definesValue = true;
        }
    });

    return definesValue;
}

// Creates a new custom enum class with named values.
export function createEnumType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    enumClass: ClassType,
    argList: FunctionArgument[]
): ClassType | undefined {
    const fileInfo = getFileInfo(errorNode);

    if (argList.length === 0) {
        return undefined;
    }

    const nameArg = argList[0];
    if (
        nameArg.argumentCategory !== ArgumentCategory.Simple ||
        !nameArg.valueExpression ||
        nameArg.valueExpression.nodeType !== ParseNodeType.StringList ||
        nameArg.valueExpression.strings.length !== 1 ||
        nameArg.valueExpression.strings[0].nodeType !== ParseNodeType.String
    ) {
        return undefined;
    }

    const className = nameArg.valueExpression.strings.map((s) => s.value).join('');
    const classType = ClassType.createInstantiable(
        className,
        getClassFullName(errorNode, fileInfo.moduleName, className),
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.EnumClass | ClassTypeFlags.ValidTypeAliasClass,
        getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        enumClass.details.effectiveMetaclass
    );
    classType.details.baseClasses.push(enumClass);
    computeMroLinearization(classType);

    const classFields = ClassType.getSymbolTable(classType);
    classFields.set(
        '__class__',
        Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
    );

    if (argList.length < 2) {
        return undefined;
    }

    const initArg = argList[1];
    if (initArg.argumentCategory !== ArgumentCategory.Simple || !initArg.valueExpression) {
        return undefined;
    }

    const intClassType = evaluator.getBuiltInType(errorNode, 'int');
    if (!intClassType || !isInstantiableClass(intClassType)) {
        return undefined;
    }
    const classInstanceType = ClassType.cloneAsInstance(classType);

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
        if (!initArg.valueExpression.strings.every((str) => str.nodeType === ParseNodeType.String)) {
            return undefined;
        }

        const initStr = initArg.valueExpression.strings
            .map((s) => s.value)
            .join('')
            .trim();

        // Split by comma or whitespace.
        const entryNames = initStr.split(/[\s,]+/);

        for (const [index, entryName] of entryNames.entries()) {
            if (!entryName) {
                return undefined;
            }

            const valueType = ClassType.cloneWithLiteral(ClassType.cloneAsInstance(intClassType), index + 1);

            const enumLiteral = new EnumLiteral(
                classType.details.fullName,
                classType.details.name,
                entryName,
                valueType
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
                ? initArg.valueExpression.entries
                : initArg.valueExpression.expressions;

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
                valueType = ClassType.cloneWithLiteral(ClassType.cloneAsInstance(intClassType), index + 1);
            } else if (entry.nodeType === ParseNodeType.Tuple) {
                if (isSimpleString) {
                    return undefined;
                }

                if (entry.expressions.length !== 2) {
                    return undefined;
                }
                nameNode = entry.expressions[0];
                valueType = evaluator.getTypeOfExpression(entry.expressions[1]).type;
            } else {
                return undefined;
            }

            if (
                nameNode.nodeType !== ParseNodeType.StringList ||
                nameNode.strings.length !== 1 ||
                nameNode.strings[0].nodeType !== ParseNodeType.String
            ) {
                return undefined;
            }

            const entryName = nameNode.strings[0].value;

            const enumLiteral = new EnumLiteral(
                classType.details.fullName,
                classType.details.name,
                entryName,
                valueType
            );

            const newSymbol = Symbol.createWithType(
                SymbolFlags.ClassMember,
                ClassType.cloneWithLiteral(classInstanceType, enumLiteral)
            );

            classFields.set(entryName, newSymbol);
        }
    }

    if (initArg.valueExpression.nodeType === ParseNodeType.Dictionary) {
        const entries = initArg.valueExpression.entries;
        if (entries.length === 0) {
            return undefined;
        }

        for (const entry of entries) {
            // Don't support dictionary expansion expressions.
            if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
                return undefined;
            }

            const nameNode = entry.keyExpression;
            const valueType = evaluator.getTypeOfExpression(entry.valueExpression).type;

            if (
                nameNode.nodeType !== ParseNodeType.StringList ||
                nameNode.strings.length !== 1 ||
                nameNode.strings[0].nodeType !== ParseNodeType.String
            ) {
                return undefined;
            }

            const entryName = nameNode.strings[0].value;
            const enumLiteral = new EnumLiteral(
                classType.details.fullName,
                classType.details.name,
                entryName,
                valueType
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

export function transformTypeForPossibleEnumClass(
    evaluator: TypeEvaluator,
    statementNode: ParseNode,
    nameNode: NameNode,
    getValueType: () => { declaredType?: Type; assignedType?: Type }
): Type | undefined {
    // If the node is within a class that derives from the metaclass
    // "EnumMeta", we need to treat assignments differently.
    const enclosingClassNode = getEnclosingClass(statementNode, /* stopAtFunction */ true);
    if (!enclosingClassNode) {
        return undefined;
    }

    const enumClassInfo = evaluator.getTypeOfClass(enclosingClassNode);
    if (!enumClassInfo || !ClassType.isEnumClass(enumClassInfo.classType)) {
        return undefined;
    }

    // In ".py" files, the transform applies only to members that are
    // assigned within the class. In stub files, it applies to most variables
    // even if they are not assigned. This unfortunate convention means
    // there is no way in a stub to specify both enum members and instance
    // variables used within each enum instance. Unless/until there is
    // a change to this convention and all type checkers and stubs adopt
    // it, we're stuck with this limitation.
    let isMemberOfEnumeration = false;
    let isUnpackedTuple = false;

    if (
        statementNode.nodeType === ParseNodeType.Assignment &&
        isNodeContainedWithin(nameNode, statementNode.leftExpression)
    ) {
        isMemberOfEnumeration = true;

        if (getParentNodeOfType(nameNode, ParseNodeType.Tuple)) {
            isUnpackedTuple = true;
        }
    } else if (
        getFileInfo(nameNode).isStubFile &&
        nameNode.parent?.nodeType === ParseNodeType.TypeAnnotation &&
        nameNode.parent.valueExpression === nameNode
    ) {
        isMemberOfEnumeration = true;
    }

    // The spec specifically excludes names that start and end with a single underscore.
    // This also includes dunder names.
    if (isSingleDunderName(nameNode.value)) {
        return undefined;
    }

    // Specifically exclude "value" and "name". These are reserved by the enum metaclass.
    if (nameNode.value === 'name' || nameNode.value === 'value') {
        return undefined;
    }

    const valueTypeInfo = getValueType();
    const declaredType = valueTypeInfo.declaredType;
    let assignedType = valueTypeInfo.assignedType;

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
    if (isPrivateName(nameNode.value)) {
        return undefined;
    }

    // The enum spec doesn't explicitly specify this, but it
    // appears that callables are excluded.
    if (!findSubtype(valueType, (subtype) => !isFunction(subtype) && !isOverloadedFunction(subtype))) {
        return undefined;
    }

    if (!assignedType && statementNode.nodeType === ParseNodeType.Assignment) {
        assignedType = evaluator.getTypeOfExpression(
            statementNode.rightExpression,
            /* flags */ undefined,
            makeInferenceContext(declaredType)
        ).type;
    }

    // Handle the Python 3.11 "enum.member()" and "enum.nonmember()" features.
    if (assignedType && isClassInstance(assignedType) && ClassType.isBuiltIn(assignedType)) {
        if (assignedType.details.fullName === 'enum.nonmember') {
            const nonMemberType =
                assignedType.typeArguments && assignedType.typeArguments.length > 0
                    ? assignedType.typeArguments[0]
                    : UnknownType.create();

            // If the type of the nonmember is declared and the assigned value has
            // a compatible type, use the declared type.
            if (declaredType && evaluator.assignType(declaredType, nonMemberType)) {
                return declaredType;
            }

            return nonMemberType;
        }

        if (assignedType.details.fullName === 'enum.member') {
            valueType =
                assignedType.typeArguments && assignedType.typeArguments.length > 0
                    ? assignedType.typeArguments[0]
                    : UnknownType.create();
            isMemberOfEnumeration = true;
        }
    }

    // Handle aliases to other enum members within the same enum.
    if (
        isClassInstance(valueType) &&
        ClassType.isSameGenericClass(valueType, ClassType.cloneAsInstance(enumClassInfo.classType)) &&
        valueType.literalValue !== undefined
    ) {
        return undefined;
    }

    if (!isMemberOfEnumeration) {
        return undefined;
    }

    const enumLiteral = new EnumLiteral(
        enumClassInfo.classType.details.fullName,
        enumClassInfo.classType.details.name,
        nameNode.value,
        valueType
    );

    return ClassType.cloneAsInstance(ClassType.cloneWithLiteral(enumClassInfo.classType, enumLiteral));
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
    isIncomplete: boolean
): TypeResult | undefined {
    // Handle the special case of 'name' and 'value' members within an enum.
    if (!isClassInstance(classType) || !ClassType.isEnumClass(classType)) {
        return undefined;
    }

    const literalValue = classType.literalValue;

    if (memberName === 'name' || memberName === '_name_') {
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
                        const literalValue = literalClass.literalValue;
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
        // If the enum class has a custom metaclass, it may implement some
        // "magic" that computes different values for the "_value_" attribute.
        // This occurs, for example, in the django TextChoices class. If we
        // detect a custom metaclass, we'll use the declared type of _value_
        // if it is declared.
        const metaclass = classType.details.effectiveMetaclass;
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
                        const literalValue = literalClass.literalValue;
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
                if (memberInfo.type.details.declaredReturnType) {
                    return memberInfo.type.details.declaredReturnType;
                }
            }
        }
    }

    return evaluator.getBuiltInObject(node, 'int');
}
