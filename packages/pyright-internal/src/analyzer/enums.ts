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
import { getFileInfo } from './analyzerNodeInfo';
import { VariableDeclaration } from './declaration';
import { getClassFullName, getEnclosingClass, getTypeSourceId } from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { isPrivateName, isSingleDunderName } from './symbolNameUtils';
import { Arg, EvalFlags, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import { enumerateLiteralsForType } from './typeGuards';
import { MemberAccessFlags, computeMroLinearization, lookUpClassMember, makeInferenceContext } from './typeUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    EnumLiteral,
    Type,
    TypeBase,
    UnknownType,
    combineTypes,
    findSubtype,
    isAny,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    maxTypeRecursionCount,
} from './types';

interface EnumEvalStackEntry {
    classType: ClassType;
    memberName: string;
}

// This stack is used to prevent infinite recursion when evaluating
// enum members that refer to other enum members.
const enumEvalStack: EnumEvalStackEntry[] = [];

// Determines whether the class is an Enum metaclass or a subclass thereof.
export function isEnumMetaclass(classType: ClassType) {
    return classType.shared.mro.some(
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
    let definesMember = false;

    ClassType.getSymbolTable(classType).forEach((symbol, name) => {
        const symbolType = transformTypeForEnumMember(evaluator, classType, name);
        if (
            symbolType &&
            isClassInstance(symbolType) &&
            ClassType.isSameGenericClass(symbolType, ClassType.cloneAsInstance(classType))
        ) {
            definesMember = true;
        }
    });

    return definesMember;
}

// Creates a new custom enum class with named values.
export function createEnumType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    enumClass: ClassType,
    argList: Arg[]
): ClassType | undefined {
    const fileInfo = getFileInfo(errorNode);
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

            const valueType = ClassType.cloneWithLiteral(ClassType.cloneAsInstance(intClassType), index + 1);

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
                valueType = ClassType.cloneWithLiteral(ClassType.cloneAsInstance(intClassType), index + 1);
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
            const evalFlags = getFileInfo(valueTypeExprNode).isStubFile ? EvalFlags.ConvertEllipsisToAny : undefined;
            assignedType = evaluator.getTypeOfExpression(valueTypeExprNode, evalFlags).type;
        }

        // Handle aliases to other enum members within the same enum.
        if (valueTypeExprNode?.nodeType === ParseNodeType.Name && valueTypeExprNode.d.value !== memberName) {
            const aliasedEnumType = transformTypeForEnumMember(
                evaluator,
                classType,
                valueTypeExprNode.d.value,
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
                    const fileInfo = getFileInfo(primaryDecl.node);
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
    isIncomplete: boolean
): TypeResult | undefined {
    if (!ClassType.isEnumClass(classType)) {
        return undefined;
    }

    const type = transformTypeForEnumMember(evaluator, classType, memberName);
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
