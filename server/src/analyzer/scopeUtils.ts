/*
* scopeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Static utility methods related to scopes and their related
* symbol tables.
*/

import * as assert from 'assert';

import { Scope, ScopeType } from './scope';
import { ClassType, ObjectType, Type, TypeCategory, UnknownType } from './types';
import * as TypeUtils from './typeUtils';

export function getBuiltInType(currentScope: Scope, name: string): Type {
    // Starting at the current scope, find the built-in scope, which should
    // be the top-most parent.
    let builtInScope = currentScope;

    while (builtInScope.getType() !== ScopeType.Builtin) {
        builtInScope = builtInScope.getParent()!;
    }

    const nameType = builtInScope.lookUpSymbol(name);
    if (nameType) {
        return TypeUtils.getEffectiveTypeOfSymbol(nameType);
    }

    return UnknownType.create();
}

export function getBuiltInObject(currentScope: Scope, className: string,
        typeArguments?: Type[]): Type {

    const nameType = getBuiltInType(currentScope, className);
    if (nameType.category === TypeCategory.Class) {
        let classType = nameType;
        if (typeArguments) {
            classType = ClassType.cloneForSpecialization(classType, typeArguments);
        }

        return ObjectType.create(classType);
    }

    return nameType;
}

export function getPermanentScope(scope: Scope): Scope {
    let curScope: Scope | undefined = scope;
    while (curScope) {
        if (curScope.getType() !== ScopeType.Temporary) {
            return curScope;
        }

        curScope = curScope.getParent();
    }

    // We should never get here.
    assert.fail('No permanent scope found');
    return scope;
}
