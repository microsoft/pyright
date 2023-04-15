/*
 * enums.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the Enum class.
 */

import { ArgumentCategory, ExpressionNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { VariableDeclaration } from './declaration';
import { getClassFullName, getEnclosingClass, getTypeSourceId } from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { isSingleDunderName } from './symbolNameUtils';
import { FunctionArgument, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    ClassTypeFlags,
    EnumLiteral,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    Type,
    UnknownType,
} from './types';
import { computeMroLinearization } from './typeUtils';

export function isKnownEnumType(className: string) {
    const knownEnumTypes = ['Enum', 'IntEnum', 'StrEnum', 'Flag', 'IntFlag'];
    return knownEnumTypes.some((c) => c === className);
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
        fileInfo.filePath,
        ClassTypeFlags.EnumClass,
        getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        enumClass.details.effectiveMetaclass
    );
    classType.details.baseClasses.push(enumClass);
    computeMroLinearization(classType);

    const classFields = classType.details.fields;
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

    // The Enum factory call supports various forms of arguments:
    //   Enum('name', 'a b c')
    //   Enum('name', 'a,b,c')
    //   Enum('name', ['a', 'b', 'c'])
    //   Enum('name', ('a', 'b', 'c'))
    //   Enum('name', (('a', 1), ('b', 2), ('c', 3)))
    //   Enum('name', [('a', 1), ('b', 2), ('c', 3))]
    //   Enum('name', {'a': 1, 'b': 2, 'c': 3}
    if (initArg.valueExpression.nodeType === ParseNodeType.StringList) {
        // Don't allow format strings in the init arg.
        if (!initArg.valueExpression.strings.every((str) => str.nodeType === ParseNodeType.String)) {
            return undefined;
        }

        const classInstanceType = ClassType.cloneAsInstance(classType);
        const intClassType = evaluator.getBuiltInType(errorNode, 'int');

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

            const valueType =
                intClassType && isInstantiableClass(intClassType)
                    ? ClassType.cloneWithLiteral(ClassType.cloneAsInstance(intClassType), index + 1)
                    : UnknownType.create();

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

    return classType;
}

export function transformTypeForPossibleEnumClass(
    evaluator: TypeEvaluator,
    node: NameNode,
    getValueType: () => Type
): Type | undefined {
    // If the node is within a class that derives from the metaclass
    // "EnumMeta", we need to treat assignments differently.
    const enclosingClassNode = getEnclosingClass(node, /* stopAtFunction */ true);
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
    let isMemberOfEnumeration =
        (node.parent?.nodeType === ParseNodeType.Assignment && node.parent.leftExpression === node) ||
        (node.parent?.nodeType === ParseNodeType.TypeAnnotation &&
            node.parent.valueExpression === node &&
            node.parent.parent?.nodeType === ParseNodeType.Assignment) ||
        (getFileInfo(node).isStubFile &&
            node.parent?.nodeType === ParseNodeType.TypeAnnotation &&
            node.parent.valueExpression === node);

    // The spec specifically excludes names that start and end with a single underscore.
    // This also includes dunder names.
    if (isSingleDunderName(node.value)) {
        isMemberOfEnumeration = false;
    }

    // Specifically exclude "value" and "name". These are reserved by the enum metaclass.
    if (node.value === 'name' || node.value === 'value') {
        isMemberOfEnumeration = false;
    }

    const valueType = getValueType();

    // The spec excludes descriptors.
    if (isClassInstance(valueType) && valueType.details.fields.get('__get__')) {
        isMemberOfEnumeration = false;
    }

    if (isMemberOfEnumeration) {
        const enumLiteral = new EnumLiteral(
            enumClassInfo.classType.details.fullName,
            enumClassInfo.classType.details.name,
            node.value,
            valueType
        );
        return ClassType.cloneAsInstance(ClassType.cloneWithLiteral(enumClassInfo.classType, enumLiteral));
    }

    return undefined;
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

export function getTypeOfEnumMember(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    memberName: string,
    isIncomplete: boolean
) {
    // Handle the special case of 'name' and 'value' members within an enum.
    if (!ClassType.isEnumClass(classType)) {
        return undefined;
    }

    const literalValue = classType.literalValue;
    if (!(literalValue instanceof EnumLiteral)) {
        return undefined;
    }

    if (memberName === 'name' || memberName === '_name_') {
        const strClass = evaluator.getBuiltInType(errorNode, 'str');

        if (isInstantiableClass(strClass)) {
            return {
                type: ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strClass, literalValue.itemName)),
                isIncomplete,
            };
        }
    }

    if (memberName === 'value' || memberName === '_value_') {
        return { type: literalValue.itemType, isIncomplete };
    }

    return undefined;
}

export function getEnumAutoValueType(evaluator: TypeEvaluator, node: ExpressionNode) {
    const containingClassNode = getEnclosingClass(node);

    if (containingClassNode) {
        const classTypeInfo = evaluator.getTypeOfClass(containingClassNode);
        if (classTypeInfo) {
            const memberInfo = evaluator.getTypeOfObjectMember(
                node,
                ClassType.cloneAsInstance(classTypeInfo.classType),
                '_generate_next_value_'
            );

            // Did we find a custom _generate_next_value_ sunder override?
            // Ignore if this comes from Enum because it is declared as
            // returning an "Any" type in the typeshed stubs.
            if (
                memberInfo &&
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
