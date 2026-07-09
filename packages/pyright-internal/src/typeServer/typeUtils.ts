/*
 * typeUtils.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Collection of helper functions around types
 */

import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import {
    ClassType,
    isAnyOrUnknown,
    isClass,
    isUnion as isUnionType,
    Type,
    TypeFlags,
} from '../analyzer/types';
import { getClassMemberIterator, isOptionalType, MemberAccessFlags } from '../analyzer/typeUtils';
import { isThenable } from '../common/core';
import { ExpressionNode, FunctionNode, ParameterNode } from '../parser/parseNodes';

import { IAsyncTypeEvaluator } from './asyncTypeEvaluatorTypes';

export function isOptional(type: Type) {
    // Both `typing.Optional` and `T | None` is considered as Optional
    if (isOptionalType(type)) {
        return true;
    }

    return isClass(type) && type.shared.moduleName === 'typing' && type.shared.name === 'Optional';
}

export function isUnion(type: Type) {
    // Both TypeCategory.Union and TypeCategory.Class with name `Union` is considered as Union
    if (isUnionType(type)) {
        return true;
    }

    return isClass(type) && type.shared.moduleName === 'typing' && type.shared.name === 'Union';
}

// Looks up a member in a class using the multiple-inheritance rules
// defined by Python.
export function* lookUpClassMembers(
    classType: ClassType,
    memberName: string,
    flags = MemberAccessFlags.Default,
    skipMroClass?: ClassType | undefined
) {
    // Look in the metaclass first.
    const metaclass = classType.shared.effectiveMetaclass;

    // Skip the "type" class as an optimization because it is known to not
    // define any instance variables, and it's by far the most common metaclass.
    if (metaclass && isClass(metaclass) && !ClassType.isBuiltIn(metaclass, 'type')) {
        for (const metaMember of getClassMemberIterator(metaclass, memberName, MemberAccessFlags.SkipClassMembers)) {
            // If the metaclass defines the member and we didn't hit an Unknown
            // class in the metaclass MRO, use the metaclass member.
            if (metaMember && !isAnyOrUnknown(metaMember.classType)) {
                // Set the isClassMember to true because it's a class member from the
                // perspective of the classType.
                metaMember.isClassMember = true;
                yield metaMember;
            }
        }
    }

    for (const member of getClassMemberIterator(classType, memberName, flags, skipMroClass)) {
        yield member;
    }

    return undefined;
}

export function getFunctionParameterNode(node: FunctionNode, name: string | undefined) {
    return node.d.params.find((param) => param.d.name?.d.value === name);
}

export function getParameterAnnotationNode(node: ParameterNode) {
    return node.d.annotation ?? node.d.annotationComment;
}

export interface TypeMember {
    name: string;
    type: Type;
    classType: ClassType | undefined;
}

export function isTypeFlagSet(flags: TypeFlags, flag: TypeFlags): boolean {
    return (flags & flag) === flag;
}

export function getTypeWithConcreteTopLevelTypeVars(evaluator: TypeEvaluator, node: ExpressionNode): Type | undefined;
export function getTypeWithConcreteTopLevelTypeVars(
    evaluator: IAsyncTypeEvaluator,
    node: ExpressionNode
): Promise<Type | undefined>;
export function getTypeWithConcreteTopLevelTypeVars(
    evaluator: TypeEvaluator | IAsyncTypeEvaluator,
    node: ExpressionNode
): Type | undefined | Promise<Type | undefined> {
    const typeOrPromise = evaluator.getType(node);

    if (isThenable<Type | undefined>(typeOrPromise)) {
        return Promise.resolve(typeOrPromise).then((type) =>
            type ? evaluator.makeTopLevelTypeVarsConcrete(type) : undefined
        );
    }

    return typeOrPromise ? evaluator.makeTopLevelTypeVarsConcrete(typeOrPromise) : undefined;
}
