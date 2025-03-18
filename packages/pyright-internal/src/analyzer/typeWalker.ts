/*
 * typeWalker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A class that walks the parts of a type (e.g. the parameters of a function
 * or the type arguments of a class). It detects and prevents infinite recursion.
 */

import { assert, assertNever } from '../common/debug';
import {
    AnyType,
    ClassType,
    FunctionType,
    ModuleType,
    NeverType,
    OverloadedType,
    Type,
    TypeCategory,
    TypeVarType,
    UnboundType,
    UnionType,
    UnknownType,
    maxTypeRecursionCount,
} from './types';

export class TypeWalker {
    private _recursionCount = 0;
    private _isWalkCanceled = false;
    private _hitRecursionLimit = false;

    get isRecursionLimitHit() {
        return this._hitRecursionLimit;
    }

    get isWalkCanceled() {
        return this._isWalkCanceled;
    }

    walk(type: Type): void {
        if (this._recursionCount > maxTypeRecursionCount) {
            this._hitRecursionLimit = true;
            return;
        }

        if (this._isWalkCanceled) {
            return;
        }

        this._recursionCount++;

        if (type.props?.typeAliasInfo) {
            this.visitTypeAlias(type);
        }

        switch (type.category) {
            case TypeCategory.Unbound:
                this.visitUnbound(type);
                break;

            case TypeCategory.Any:
                this.visitAny(type);
                break;

            case TypeCategory.Unknown:
                this.visitUnknown(type);
                break;

            case TypeCategory.Never:
                this.visitNever(type);
                break;

            case TypeCategory.Function:
                this.visitFunction(type);
                break;

            case TypeCategory.Overloaded:
                this.visitOverloaded(type);
                break;

            case TypeCategory.Class:
                this.visitClass(type);
                break;

            case TypeCategory.Module:
                this.visitModule(type);
                break;

            case TypeCategory.Union:
                this.visitUnion(type);
                break;

            case TypeCategory.TypeVar:
                this.visitTypeVar(type);
                break;

            default:
                assertNever(type);
        }

        this._recursionCount--;
    }

    cancelWalk() {
        this._isWalkCanceled = true;
    }

    visitTypeAlias(type: Type) {
        const aliasInfo = type.props?.typeAliasInfo;
        assert(aliasInfo !== undefined);

        if (aliasInfo.typeArgs) {
            for (const typeArg of aliasInfo.typeArgs) {
                this.walk(typeArg);
                if (this._isWalkCanceled) {
                    break;
                }
            }
        }
    }

    visitUnbound(type: UnboundType): void {
        // Nothing to do.
    }

    visitAny(type: AnyType): void {
        // Nothing to do.
    }

    visitUnknown(type: UnknownType): void {
        // Nothing to do.
    }

    visitNever(type: NeverType): void {
        // Nothing to do.
    }

    visitFunction(type: FunctionType): void {
        for (let i = 0; i < type.shared.parameters.length; i++) {
            // Ignore parameters such as "*" that have no name.
            if (type.shared.parameters[i].name) {
                const paramType = FunctionType.getParamType(type, i);
                this.walk(paramType);
                if (this._isWalkCanceled) {
                    break;
                }
            }
        }

        if (!this._isWalkCanceled && !FunctionType.isParamSpecValue(type) && !FunctionType.isParamSpecValue(type)) {
            const returnType = type.shared.declaredReturnType ?? type.shared.inferredReturnType?.type;
            if (returnType) {
                this.walk(returnType);
            }
        }
    }

    visitOverloaded(type: OverloadedType): void {
        const overloads = OverloadedType.getOverloads(type);
        for (const overload of overloads) {
            this.walk(overload);
            if (this._isWalkCanceled) {
                break;
            }
        }

        const impl = OverloadedType.getImplementation(type);
        if (impl) {
            this.walk(impl);
        }
    }

    visitClass(type: ClassType): void {
        if (!ClassType.isPseudoGenericClass(type)) {
            const typeArgs = type.priv.tupleTypeArgs?.map((t) => t.type) || type.priv.typeArgs;
            if (typeArgs) {
                for (const argType of typeArgs) {
                    this.walk(argType);
                    if (this._isWalkCanceled) {
                        break;
                    }
                }
            }
        }
    }

    visitModule(type: ModuleType): void {
        // Nothing to do.
    }

    visitUnion(type: UnionType): void {
        for (const subtype of type.priv.subtypes) {
            this.walk(subtype);
            if (this._isWalkCanceled) {
                break;
            }
        }
    }

    visitTypeVar(type: TypeVarType): void {
        // Nothing to do.
    }
}
