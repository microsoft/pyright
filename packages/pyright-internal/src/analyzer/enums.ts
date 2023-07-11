/*
 * enums.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the Enum class.
 */

import { assert } from '../common/debug';
import {
    ArgumentCategory,
    AssignmentNode,
    ExpressionNode,
    NameNode,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
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
import { isSingleDunderName } from './symbolNameUtils';
import { FunctionArgument, TypeEvaluator } from './typeEvaluatorTypes';
import { enumerateLiteralsForType } from './typeGuards';
import { ClassMemberLookupFlags, computeMroLinearization, lookUpClassMember } from './typeUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    EnumLiteral,
    Type,
    UnknownType,
    combineTypes,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
} from './types';

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
    //   Enum('name', {'a': 1, 'b': 2, 'c': 3}
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
    let isMemberOfEnumeration = false;
    let isUnpackedTuple = false;

    const assignmentNode = getParentNodeOfType(node, ParseNodeType.Assignment) as AssignmentNode | undefined;

    if (assignmentNode && isNodeContainedWithin(node, assignmentNode.leftExpression)) {
        isMemberOfEnumeration = true;

        if (getParentNodeOfType(node, ParseNodeType.Tuple)) {
            isUnpackedTuple = true;
        }
    } else if (
        getFileInfo(node).isStubFile &&
        node.parent?.nodeType === ParseNodeType.TypeAnnotation &&
        node.parent.valueExpression === node
    ) {
        isMemberOfEnumeration = true;
    }

    // The spec specifically excludes names that start and end with a single underscore.
    // This also includes dunder names.
    if (isSingleDunderName(node.value)) {
        isMemberOfEnumeration = false;
    }

    // Specifically exclude "value" and "name". These are reserved by the enum metaclass.
    if (node.value === 'name' || node.value === 'value') {
        isMemberOfEnumeration = false;
    }

    let valueType: Type;

    // If the class includes a __new__ method, we cannot assume that
    // the value of each enum element is simply the value assigned to it.
    // The __new__ method can transform the value in ways that we cannot
    // determine statically.
    const newMember = lookUpClassMember(enumClassInfo.classType, '__new__', ClassMemberLookupFlags.SkipBaseClasses);
    if (newMember) {
        // We may want to change this to UnknownType in the future, but
        // for now, we'll leave it as Any which is consistent with the
        // type specified in the Enum class definition in enum.pyi.
        valueType = AnyType.create();
    } else {
        valueType = getValueType();

        // If the LHS is an unpacked tuple, we need to handle this as
        // a special case.
        if (isUnpackedTuple) {
            valueType =
                evaluator.getTypeOfIterator({ type: valueType }, /* isAsync */ false, /* errorNode */ undefined)
                    ?.type ?? UnknownType.create();
        }
    }

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
        if (literalValues) {
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

    if (memberName === 'value' || memberName === '_value_') {
        // If the enum class has a custom metaclass, it may implement some
        // "magic" that computes different values for the "value" attribute.
        // This occurs, for example, in the django TextChoices class. If we
        // detect a custom metaclass, we'll assume the value is Any.
        const metaclass = classType.details.effectiveMetaclass;
        if (metaclass && isClass(metaclass) && !ClassType.isBuiltIn(metaclass)) {
            return { type: AnyType.create(), isIncomplete };
        }

        if (literalValue) {
            assert(literalValue instanceof EnumLiteral);
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
