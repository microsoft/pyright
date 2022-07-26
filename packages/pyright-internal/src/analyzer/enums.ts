/*
 * enums.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the Enum class.
 */

import { assert } from '../common/debug';
import { convertOffsetsToRange } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import {
    ArgumentCategory,
    ExpressionNode,
    NameNode,
    ParseNode,
    ParseNodeType,
    StringListNode,
} from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { DeclarationType, VariableDeclaration } from './declaration';
import { getClassFullName, getEnclosingClass, getTypeSourceId } from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { isSingleDunderName } from './symbolNameUtils';
import { FunctionArgument, TypeEvaluator } from './typeEvaluatorTypes';
import {
    ClassType,
    ClassTypeFlags,
    EnumLiteral,
    isClassInstance,
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
    errorNode: ExpressionNode,
    enumClass: ClassType,
    argList: FunctionArgument[]
): ClassType | undefined {
    const fileInfo = getFileInfo(errorNode);
    let className = 'enum';
    if (argList.length === 0) {
        return undefined;
    } else {
        const nameArg = argList[0];
        if (
            nameArg.argumentCategory === ArgumentCategory.Simple &&
            nameArg.valueExpression &&
            nameArg.valueExpression.nodeType === ParseNodeType.StringList
        ) {
            className = nameArg.valueExpression.strings.map((s) => s.value).join('');
        } else {
            return undefined;
        }
    }

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
    } else {
        const entriesArg = argList[1];
        if (
            entriesArg.argumentCategory !== ArgumentCategory.Simple ||
            !entriesArg.valueExpression ||
            entriesArg.valueExpression.nodeType !== ParseNodeType.StringList
        ) {
            // Technically, the Enum constructor supports a bunch of different
            // ways to specify the items: space-delimited string, a string
            // iterator, an iterator of name/value tuples, and a dictionary
            // of name/value pairs. We support only the simple space-delimited
            // string here. For users who are interested in type checking, we
            // recommend using the more standard class declaration syntax.
            return undefined;
        } else {
            const entries = entriesArg.valueExpression.strings
                .map((s) => s.value)
                .join('')
                .split(' ');
            entries.forEach((entryName) => {
                entryName = entryName.trim();
                if (entryName) {
                    const entryType = UnknownType.create();
                    const newSymbol = Symbol.createWithType(SymbolFlags.ClassMember, entryType);

                    // We need to associate the declaration with a parse node.
                    // In this case it's just part of a string literal value.
                    // The definition provider won't necessarily take the
                    // user to the exact spot in the string, but it's close enough.
                    const stringNode = entriesArg.valueExpression!;
                    assert(stringNode.nodeType === ParseNodeType.StringList);
                    const fileInfo = getFileInfo(errorNode);
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: stringNode as StringListNode,
                        isRuntimeTypeExpression: true,
                        path: fileInfo.filePath,
                        range: convertOffsetsToRange(stringNode.start, TextRange.getEnd(stringNode), fileInfo.lines),
                        moduleName: fileInfo.moduleName,
                        isInExceptSuite: false,
                    };
                    newSymbol.addDeclaration(declaration);
                    classFields.set(entryName, newSymbol);
                }
            });
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
    if (enclosingClassNode) {
        const enumClassInfo = evaluator.getTypeOfClass(enclosingClassNode);

        if (enumClassInfo && ClassType.isEnumClass(enumClassInfo.classType)) {
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
                return ClassType.cloneAsInstance(
                    ClassType.cloneWithLiteral(
                        enumClassInfo.classType,
                        new EnumLiteral(enumClassInfo.classType.details.name, node.value, valueType)
                    )
                );
            }
        }
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
    if (ClassType.isEnumClass(classType)) {
        const literalValue = classType.literalValue;
        if (literalValue instanceof EnumLiteral) {
            if (memberName === 'name' || memberName === '_name_') {
                const strClass = evaluator.getBuiltInType(errorNode, 'str');
                if (isInstantiableClass(strClass)) {
                    return {
                        type: ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strClass, literalValue.itemName)),
                        isIncomplete,
                    };
                }
            } else if (memberName === 'value' || memberName === '_value_') {
                return { type: literalValue.itemType, isIncomplete };
            }
        }
    }

    return undefined;
}
