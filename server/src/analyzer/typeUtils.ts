/*
* typeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Collection of static methods that operate on Type objects.
*/

import * as assert from 'assert';

import { ParameterCategory } from '../parser/parseNodes';
import { Symbol } from './symbol';
import { ClassType, FunctionType, NoneType,
    ObjectType, OverloadedFunctionType, TupleType, Type, TypeCategory,
    TypeVarType, UnboundType, UnionType, UnknownType } from './types';

export interface ClassMember {
    symbol?: Symbol;
    isInstanceMember: boolean;
    class?: ClassType;
}

export class TypeUtils {
    // Combines two types into a single type. If the types are
    // the same, only one is returned. If they differ, they
    // are combined into a UnionType.
    static combineTypes(type1: Type, type2: Type): Type {
        if (type1.isSame(type2)) {
            return type1;
        }

        let unionType = new UnionType();

        if (type1 instanceof UnionType) {
            unionType.addTypes(type1.getTypes());
        } else {
            unionType.addTypes([type1]);
        }

        if (type2 instanceof UnionType) {
            unionType.addTypes(type2.getTypes());
        } else {
            unionType.addTypes([type2]);
        }

        return unionType;
    }

    static combineTypesArray(types: Type[]): Type {
        assert(types.length > 0);

        let resultingType = types[0];
        types.forEach((t, index) => {
            if (index > 0) {
                resultingType = this.combineTypes(resultingType, t);
            }
        });

        return resultingType;
    }

    static isInstanceOf(objectType: ObjectType, classType: ClassType): boolean {
        return objectType.getClassType().isDerivedFrom(classType);
    }

    static canAssignType(destType: Type, srcType: Type): boolean {
        if (srcType instanceof UnionType) {
            // For union sources, all of the types need to be assignable to the dest.
            return srcType.getTypes().find(t => !this.canAssignType(destType, t)) === undefined;
        }

        if (destType instanceof UnionType) {
            // For union destinations, we just need to match one of the types.
            return destType.getTypes().find(t => this.canAssignType(t, srcType)) !== undefined;
        }

        // TODO - remove this once we support specialization
        if (destType instanceof TypeVarType || srcType instanceof TypeVarType) {
            return true;
        }

        if (destType.isAny() || srcType.isAny()) {
            return true;
        }

        if (destType.category === TypeCategory.Unbound ||
                srcType.category === TypeCategory.Unbound) {
            return false;
        }

        if (destType.category === TypeCategory.None && srcType.category === TypeCategory.None) {
            return true;
        }

        if (destType instanceof ObjectType) {
            const destClassType = destType.getClassType();

            // Construct a generic tuple object using the built-in tuple
            // class so we can perform a comparison.
            if (srcType instanceof TupleType) {
                srcType = new ObjectType(srcType.getBaseClass());
            }

            if (srcType instanceof ObjectType) {
                return this.canAssignClassType(destClassType, srcType.getClassType());
            }
        }

        if (srcType instanceof ClassType) {
            // Is the dest a generic "type" object?
            if (destType instanceof ObjectType) {
                const destClassType = destType.getClassType();
                if (destClassType.isBuiltIn()) {
                    const destClassName = destClassType.getClassName();
                    if (destClassName === 'type') {
                        return true;
                    }
                }
            }

            if (destType instanceof ClassType) {
                return this.canAssignClassType(destType, srcType);
            }
        }

        if (destType instanceof FunctionType) {
            let srcFunction: FunctionType | undefined;

            if (srcType instanceof OverloadedFunctionType) {
                // TODO - need to find first overloaded function
                // that matches the parameters.
                const overloads = srcType.getOverloads();
                if (overloads.length > 0) {
                    srcFunction = overloads[0].type;
                }
            } else if (srcType instanceof FunctionType) {
                srcFunction = srcType;
            } else if (srcType instanceof ObjectType) {
                const callMember = this.lookUpObjectMember(srcType, '__call__');
                if (callMember) {
                    const callType = TypeUtils.getEffectiveTypeOfMember(callMember);
                    if (callType instanceof FunctionType) {
                        srcFunction = callType;
                    }
                }
            } else if (srcType instanceof ClassType) {
                // TODO - need to create function corresponding to constructor for class
            }

            if (srcFunction) {
                // TODO - validate parameters
                return true;
            }
        }

        if (destType instanceof TupleType && srcType instanceof TupleType) {
            const destEntries = destType.getEntryTypes();
            const srcEntries = srcType.getEntryTypes();

            if (destEntries.length !== srcEntries.length) {
                return false;
            }

            if (srcEntries.find((srcEntry, index) => !this.canAssignType(destEntries[index], srcEntry))) {
                return false;
            }

            return true;
        }

        // None derives from object.
        if (srcType instanceof NoneType) {
            if (destType instanceof ObjectType) {
                let destClassType = destType.getClassType();
                if (destClassType.isBuiltIn() && destClassType.getClassName() === 'object') {
                    return true;
                }
            }
        }

        return false;
    }

    static canAssignClassType(destType: ClassType, srcType: ClassType): boolean {
        if (destType.isProtocol()) {
            const destClassFields = destType.getClassFields();

            let missingNames: string[] = [];
            let wrongTypes: string[] = [];

            destClassFields.forEach((symbol, name) => {
                const classMemberInfo = TypeUtils.lookUpClassMember(srcType, name, false);
                if (!classMemberInfo) {
                    missingNames.push(name);
                } else {
                    const srcMemberType = TypeUtils.getEffectiveTypeOfMember(classMemberInfo);
                    if (symbol.declarations && symbol.declarations[0].declaredType) {
                        let destMemberType = symbol.declarations[0].declaredType;
                        if (!TypeUtils.canAssignType(srcMemberType, destMemberType)) {
                            wrongTypes.push(name);
                        }
                    }
                }
            });

            if (missingNames.length > 0 || wrongTypes.length > 0) {
                return false;
            }

            return true;
        }

        if (srcType.isDerivedFrom(destType)) {
            // TODO - need to validate type parameter matches
            return true;
        }

        if (srcType.isBuiltIn()) {
            if (srcType.getClassName() === 'int') {
                if (this.lookUpClassMember(destType, '__int__')) {
                    return true;
                }
            }

            if (srcType.getClassName() === 'float') {
                if (this.lookUpClassMember(destType, '__float__')) {
                    return true;
                }
            }
        }

        return false;
    }

    // Looks up a member in a class using the multiple-inheritance rules
    // defined by Python. For more detials, see this note on method resolution
    // order: https://www.python.org/download/releases/2.3/mro/.
    static lookUpClassMember(classType: Type, memberName: string,
            includeInstanceFields = true, searchBaseClasses = true): ClassMember | undefined {

        if (classType instanceof ClassType) {
            // TODO - for now, use naive depth-first search.

            // Look in the instance fields first if requested.
            if (includeInstanceFields) {
                const instanceFields = classType.getInstanceFields();
                const instanceFieldEntry = instanceFields.get(memberName);
                if (instanceFieldEntry) {
                    let symbol = instanceFieldEntry;

                    return {
                        symbol,
                        isInstanceMember: true,
                        class: classType
                    };
                }
            }

            // Next look in the class fields.
            const classFields = classType.getClassFields();
            const classFieldEntry = classFields.get(memberName);
            if (classFieldEntry) {
                let symbol = classFieldEntry;

                return {
                    symbol,
                    isInstanceMember: false,
                    class: classType
                };
            }

            if (searchBaseClasses) {
                for (let baseClass of classType.getBaseClasses()) {
                    let methodType = this.lookUpClassMember(baseClass.type,
                        memberName, searchBaseClasses);
                    if (methodType) {
                        return methodType;
                    }
                }
            }
        } else if (classType.isAny()) {
            return {
                isInstanceMember: false
            };
        }

        return undefined;
    }

    static getEffectiveTypeOfMember(member: ClassMember): Type {
        if (!member.symbol) {
            return UnknownType.create();
        }

        if (member.symbol.declarations) {
            if (member.symbol.declarations[0].declaredType) {
                return member.symbol.declarations[0].declaredType;
            }
        }

        if (member.symbol.inferredType) {
            // TODO - for now, always simplify the type.
            if (member.symbol.inferredType instanceof UnionType) {
                return member.symbol.inferredType.removeOptional();
            }
            return member.symbol.inferredType.getType();
        }

        return UnboundType.create();
    }

    static lookUpObjectMember(objectType: Type, memberName: string): ClassMember | undefined {
        if (objectType instanceof ObjectType) {
            return this.lookUpClassMember(objectType.getClassType(), memberName);
        }

        return undefined;
    }

    static addDefaultFunctionParameters(functionType: FunctionType) {
        functionType.addParameter({
            category: ParameterCategory.VarArgList,
            name: 'args',
            type: UnknownType.create()
        });
        functionType.addParameter({
            category: ParameterCategory.VarArgDictionary,
            name: 'kwargs',
            type: UnknownType.create()
        });
    }

    static getMetaclass(type: ClassType): ClassType | UnknownType | undefined {
        for (let base of type.getBaseClasses()) {
            if (base.isMetaclass) {
                if (base.type instanceof ClassType) {
                    return base.type;
                } else {
                    return UnknownType.create();
                }
            }

            if (base.type instanceof ClassType) {
                // TODO - add protection for infinite recursion
                let metaclass = this.getMetaclass(base.type);
                if (metaclass) {
                    return metaclass;
                }
            }
        }

        return undefined;
    }

    static addTypeVarToListIfUnique(list: TypeVarType[], type: TypeVarType) {
        if (list.find(t => t === type) === undefined) {
            list.push(type);
        }
    }

    // Combines two lists of type var types, maintaining the combined order
    // but removing any duplicates.
    static addTypeVarsToListIfUnique(list1: TypeVarType[], list2: TypeVarType[]) {
        for (let t of list2) {
            this.addTypeVarToListIfUnique(list1, t);
        }
    }

    static getTypeVarArgumentsRecursive(type: Type): TypeVarType[] {
        let getTypeVarsFromClass = (classType: ClassType) => {
            let combinedList: TypeVarType[] = [];
            let typeArgs = classType.getTypeArguments();

            if (typeArgs) {
                typeArgs.forEach(typeArg => {
                    if (typeArg instanceof Type) {
                        this.addTypeVarsToListIfUnique(combinedList,
                            this.getTypeVarArgumentsRecursive(typeArg));
                    }
                });
            }

            return combinedList;
        };

        if (type instanceof TypeVarType) {
            return [type];
        } else if (type instanceof ClassType) {
            return getTypeVarsFromClass(type);
        } else if (type instanceof ObjectType) {
            return getTypeVarsFromClass(type.getClassType());
        } else if (type instanceof UnionType) {
            let combinedList: TypeVarType[] = [];
            for (let subtype of type.getTypes()) {
                this.addTypeVarsToListIfUnique(combinedList,
                    this.getTypeVarArgumentsRecursive(subtype));
            }
        }

        return [];
    }

    // If the class is generic, the type is cloned, and its own
    // type parameters are used as type arguments. This is useful
    // for typing "self" or "cls" within a class's implementation.
    static selfSpecializeClassType(type: ClassType): ClassType {
        if (!type.isGeneric()) {
            return type;
        }

        let typeArgs = type.getTypeParameters();
        return type.cloneForSpecialization(typeArgs);
    }
}
