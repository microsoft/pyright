/*
* scopeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Static utility methods related to scopes and their related
* symbol tables.
*/

import { Scope, ScopeType } from './analyzer/scope';
import { ClassType, ObjectType, Type, UnknownType } from './analyzer/types';

export class ScopeUtils {
    static getBuiltInType(currentScope: Scope, name: string): Type {
        // Starting at the current scope, find the built-in scope, which should
        // be the top-most parent.
        let builtInScope = currentScope;
        while (builtInScope.getType() !== ScopeType.BuiltIn) {
            builtInScope = builtInScope.getParent()!;
        }

        let nameType = builtInScope.lookUpSymbol(name);
        if (nameType) {
            return nameType.currentType;
        }

        return UnknownType.create();
    }

    static getBuiltInObject(currentScope: Scope, className: string,
            typeArguments?: Type[]): Type {

        let nameType = this.getBuiltInType(currentScope, className);
        if (nameType instanceof ClassType) {
            let classType = nameType;
            if (typeArguments) {
                classType = classType.cloneForSpecialization(typeArguments);
            }

            return new ObjectType(classType);
        }

        return nameType;
    }
}
