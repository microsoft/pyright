/*
 * properties.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides type evaluation logic that is specific to properties.
 */

import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../localization/localize';
import { DecoratorNode, FunctionNode, ParameterCategory, ParseNode } from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { getClassFullName, getTypeAnnotationForParameter, getTypeSourceId } from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { TypeEvaluator } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isFunction,
    isInstantiableClass,
    isTypeSame,
    isTypeVar,
    ModuleType,
    OverloadedFunctionType,
    Type,
    UnknownType,
} from './types';
import {
    applySolvedTypeVars,
    AssignTypeFlags,
    computeMroLinearization,
    getTypeVarScopeId,
    isProperty,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';

export function validatePropertyMethod(evaluator: TypeEvaluator, method: FunctionType, errorNode: ParseNode) {
    if (FunctionType.isStaticMethod(method)) {
        evaluator.addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.propertyStaticMethod(), errorNode);
    }
}

export function createProperty(
    evaluator: TypeEvaluator,
    decoratorNode: DecoratorNode,
    decoratorType: ClassType,
    fget: FunctionType
): ClassType {
    const fileInfo = getFileInfo(decoratorNode);
    const typeMetaclass = evaluator.getBuiltInType(decoratorNode, 'type');
    const typeSourceId = ClassType.isBuiltIn(decoratorType, 'property')
        ? getTypeSourceId(decoratorNode)
        : decoratorType.details.typeSourceId;

    const propertyClass = ClassType.createInstantiable(
        decoratorType.details.name,
        getClassFullName(decoratorNode, fileInfo.moduleName, `__property_${fget.details.name}`),
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.PropertyClass | ClassTypeFlags.BuiltInClass,
        typeSourceId,
        /* declaredMetaclass */ undefined,
        isInstantiableClass(typeMetaclass) ? typeMetaclass : UnknownType.create()
    );

    propertyClass.details.declaration = decoratorType.details.declaration;
    propertyClass.details.typeVarScopeId = decoratorType.details.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(decoratorNode, 'object');
    propertyClass.details.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
    computeMroLinearization(propertyClass);

    // Clone the symbol table of the old class type.
    const fields = ClassType.getSymbolTable(propertyClass);
    ClassType.getSymbolTable(decoratorType).forEach((symbol, name) => {
        const ignoredMethods = ['__get__', '__set__', '__delete__'];

        if (!symbol.isIgnoredForProtocolMatch()) {
            if (!ignoredMethods.some((m) => m === name)) {
                fields.set(name, symbol);
            }
        }
    });

    const propertyObject = ClassType.cloneAsInstance(propertyClass);
    propertyClass.isAsymmetricDescriptor = false;

    // Update the __set__ and __delete__ methods if present.
    updateGetSetDelMethodForClonedProperty(evaluator, propertyObject);

    // Fill in the fget method.
    propertyObject.fgetInfo = {
        methodType: FunctionType.cloneWithNewFlags(fget, fget.details.flags | FunctionTypeFlags.StaticMethod),
        classType: fget.details.methodClass,
    };

    if (FunctionType.isClassMethod(fget)) {
        propertyClass.details.flags |= ClassTypeFlags.ClassProperty;
    }

    // Fill in the __get__ method with an overload.
    addGetMethodToPropertySymbolTable(evaluator, propertyObject, fget);

    // Fill in the getter, setter and deleter methods.
    addDecoratorMethodsToPropertySymbolTable(propertyObject);

    return propertyObject;
}

export function clonePropertyWithSetter(
    evaluator: TypeEvaluator,
    prop: Type,
    fset: FunctionType,
    errorNode: FunctionNode
): Type {
    if (!isProperty(prop)) {
        return prop;
    }

    const classType = prop as ClassType;
    const flagsToClone = classType.details.flags;
    let isAsymmetricDescriptor = !!classType.isAsymmetricDescriptor;

    // Verify parameters for fset.
    // We'll skip this test if the diagnostic rule is disabled because it
    // can be somewhat expensive, especially in code that is not annotated.
    const fileInfo = getFileInfo(errorNode);
    if (errorNode.parameters.length >= 2) {
        const typeAnnotation = getTypeAnnotationForParameter(errorNode, 1);
        if (typeAnnotation) {
            // Verify consistency of the type.
            const fgetType = evaluator.getGetterTypeFromProperty(classType, /* inferTypeIfNeeded */ false);
            if (fgetType && !isAnyOrUnknown(fgetType)) {
                const fsetType = evaluator.getTypeOfAnnotation(typeAnnotation, {
                    associateTypeVarsWithScope: true,
                });

                // The setter type should be assignable to the getter type.
                if (fileInfo.diagnosticRuleSet.reportPropertyTypeMismatch !== 'none') {
                    const diag = new DiagnosticAddendum();
                    if (!evaluator.assignType(fgetType, fsetType, diag)) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportPropertyTypeMismatch,
                            LocMessage.setterGetterTypeMismatch() + diag.getString(),
                            typeAnnotation
                        );
                    }
                }

                if (!isTypeSame(fgetType, fsetType)) {
                    isAsymmetricDescriptor = true;
                }
            }
        }
    }

    const propertyClass = ClassType.createInstantiable(
        classType.details.name,
        classType.details.fullName,
        classType.details.moduleName,
        getFileInfo(errorNode).fileUri,
        flagsToClone,
        classType.details.typeSourceId,
        classType.details.declaredMetaclass,
        classType.details.effectiveMetaclass
    );

    propertyClass.details.declaration = classType.details.declaration;
    propertyClass.details.typeVarScopeId = classType.details.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(errorNode, 'object');
    propertyClass.details.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
    computeMroLinearization(propertyClass);

    propertyClass.fgetInfo = classType.fgetInfo;
    propertyClass.fdelInfo = classType.fdelInfo;
    propertyClass.isAsymmetricDescriptor = isAsymmetricDescriptor;
    const propertyObject = ClassType.cloneAsInstance(propertyClass);

    // Clone the symbol table of the old class type.
    const fields = ClassType.getSymbolTable(propertyClass);
    ClassType.getSymbolTable(classType).forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            fields.set(name, symbol);
        }
    });

    // Update the __get__ and __delete__ methods if present.
    updateGetSetDelMethodForClonedProperty(evaluator, propertyObject);

    // Fill in the new fset method.
    propertyObject.fsetInfo = {
        methodType: FunctionType.cloneWithNewFlags(fset, fset.details.flags | FunctionTypeFlags.StaticMethod),
        classType: fset.details.methodClass,
    };

    // Fill in the __set__ method.
    addSetMethodToPropertySymbolTable(evaluator, propertyObject, fset);

    // Fill in the getter, setter and deleter methods.
    addDecoratorMethodsToPropertySymbolTable(propertyObject);

    return propertyObject;
}

export function clonePropertyWithDeleter(
    evaluator: TypeEvaluator,
    prop: Type,
    fdel: FunctionType,
    errorNode: FunctionNode
): Type {
    if (!isProperty(prop)) {
        return prop;
    }

    const classType = prop as ClassType;
    const propertyClass = ClassType.createInstantiable(
        classType.details.name,
        classType.details.fullName,
        classType.details.moduleName,
        getFileInfo(errorNode).fileUri,
        classType.details.flags,
        classType.details.typeSourceId,
        classType.details.declaredMetaclass,
        classType.details.effectiveMetaclass
    );

    propertyClass.details.declaration = classType.details.declaration;
    propertyClass.details.typeVarScopeId = classType.details.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(errorNode, 'object');
    propertyClass.details.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
    computeMroLinearization(propertyClass);

    propertyClass.fgetInfo = classType.fgetInfo;
    propertyClass.fsetInfo = classType.fsetInfo;
    const propertyObject = ClassType.cloneAsInstance(propertyClass);
    propertyClass.isAsymmetricDescriptor = classType.isAsymmetricDescriptor ?? false;

    // Clone the symbol table of the old class type.
    const fields = ClassType.getSymbolTable(propertyClass);
    ClassType.getSymbolTable(classType).forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            fields.set(name, symbol);
        }
    });

    // Update the __get__ and __set__ methods if present.
    updateGetSetDelMethodForClonedProperty(evaluator, propertyObject);

    // Fill in the fdel method.
    propertyObject.fdelInfo = {
        methodType: FunctionType.cloneWithNewFlags(fdel, fdel.details.flags | FunctionTypeFlags.StaticMethod),
        classType: fdel.details.methodClass,
    };

    // Fill in the __delete__ method.
    addDelMethodToPropertySymbolTable(evaluator, propertyObject, fdel);

    // Fill in the getter, setter and deleter methods.
    addDecoratorMethodsToPropertySymbolTable(propertyObject);

    return propertyObject;
}

function addGetMethodToPropertySymbolTable(evaluator: TypeEvaluator, propertyObject: ClassType, fget: FunctionType) {
    const fields = ClassType.getSymbolTable(propertyObject);

    // The first overload is for accesses through a class object (where
    // the instance argument is None).
    const getFunction1 = FunctionType.createSynthesizedInstance('__get__', FunctionTypeFlags.Overloaded);
    FunctionType.addParameter(getFunction1, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: AnyType.create(),
        hasDeclaredType: true,
    });
    FunctionType.addParameter(getFunction1, {
        category: ParameterCategory.Simple,
        name: 'obj',
        type: evaluator.getNoneType(),
        hasDeclaredType: true,
    });
    FunctionType.addParameter(getFunction1, {
        category: ParameterCategory.Simple,
        name: 'objtype',
        type: AnyType.create(),
        hasDeclaredType: true,
        hasDefault: true,
        defaultType: AnyType.create(),
    });
    getFunction1.details.declaredReturnType = FunctionType.isClassMethod(fget)
        ? FunctionType.getEffectiveReturnType(fget)
        : propertyObject;
    getFunction1.details.declaration = fget.details.declaration;
    getFunction1.details.deprecatedMessage = fget.details.deprecatedMessage;

    // Override the scope ID since we're using parameter types from the
    // decorated function.
    getFunction1.details.typeVarScopeId = getTypeVarScopeId(fget);

    // The second overload is for accesses through a class instance.
    const getFunction2 = FunctionType.createSynthesizedInstance('__get__', FunctionTypeFlags.Overloaded);
    FunctionType.addParameter(getFunction2, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: AnyType.create(),
        hasDeclaredType: true,
    });

    const objType =
        fget.details.parameters.length > 0 ? FunctionType.getEffectiveParameterType(fget, 0) : AnyType.create();

    FunctionType.addParameter(getFunction2, {
        category: ParameterCategory.Simple,
        name: 'obj',
        type: objType,
        hasDeclaredType: true,
    });

    FunctionType.addParameter(getFunction2, {
        category: ParameterCategory.Simple,
        name: 'objtype',
        type: AnyType.create(),
        hasDeclaredType: true,
        hasDefault: true,
        defaultType: AnyType.create(),
    });
    getFunction2.details.declaredReturnType = FunctionType.getEffectiveReturnType(fget);
    getFunction2.details.declaration = fget.details.declaration;
    getFunction2.details.deprecatedMessage = fget.details.deprecatedMessage;

    // Override the scope ID since we're using parameter types from the
    // decorated function.
    getFunction2.details.typeVarScopeId = getTypeVarScopeId(fget);

    // We previously placed getFunction1 before getFunction2, but this creates
    // problems specifically for the `NoneType` class because None.__class__
    // is a property, and both overloads match in this case because None
    // is passed for the "obj" parameter.
    const getFunctionOverload = OverloadedFunctionType.create([getFunction2, getFunction1]);
    const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunctionOverload);
    fields.set('__get__', getSymbol);
}

function addSetMethodToPropertySymbolTable(evaluator: TypeEvaluator, propertyObject: ClassType, fset: FunctionType) {
    const fields = ClassType.getSymbolTable(propertyObject);

    const setFunction = FunctionType.createSynthesizedInstance('__set__');
    FunctionType.addParameter(setFunction, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: AnyType.create(),
        hasDeclaredType: true,
    });

    let objType =
        fset.details.parameters.length > 0 ? FunctionType.getEffectiveParameterType(fset, 0) : AnyType.create();
    if (isTypeVar(objType) && objType.details.isSynthesizedSelf) {
        objType = evaluator.makeTopLevelTypeVarsConcrete(objType);
    }

    FunctionType.addParameter(setFunction, {
        category: ParameterCategory.Simple,
        name: 'obj',
        type: combineTypes([objType, evaluator.getNoneType()]),
        hasDeclaredType: true,
    });

    setFunction.details.declaredReturnType = evaluator.getNoneType();

    // Adopt the TypeVarScopeId of the fset function in case it has any
    // TypeVars that need to be solved.
    setFunction.details.typeVarScopeId = getTypeVarScopeId(fset);
    setFunction.details.deprecatedMessage = fset.details.deprecatedMessage;

    let setParamType: Type = UnknownType.create();

    if (
        fset.details.parameters.length >= 2 &&
        fset.details.parameters[1].category === ParameterCategory.Simple &&
        fset.details.parameters[1].name
    ) {
        setParamType = fset.details.parameters[1].type;
    }
    FunctionType.addParameter(setFunction, {
        category: ParameterCategory.Simple,
        name: 'value',
        type: setParamType,
        hasDeclaredType: true,
    });
    const setSymbol = Symbol.createWithType(SymbolFlags.ClassMember, setFunction);
    fields.set('__set__', setSymbol);
}

function addDelMethodToPropertySymbolTable(evaluator: TypeEvaluator, propertyObject: ClassType, fdel: FunctionType) {
    const fields = ClassType.getSymbolTable(propertyObject);

    const delFunction = FunctionType.createSynthesizedInstance('__delete__');
    FunctionType.addParameter(delFunction, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: AnyType.create(),
        hasDeclaredType: true,
    });

    // Adopt the TypeVarScopeId of the fdel function in case it has any
    // TypeVars that need to be solved.
    delFunction.details.typeVarScopeId = getTypeVarScopeId(fdel);
    delFunction.details.deprecatedMessage = fdel.details.deprecatedMessage;

    let objType =
        fdel.details.parameters.length > 0 ? FunctionType.getEffectiveParameterType(fdel, 0) : AnyType.create();

    if (isTypeVar(objType) && objType.details.isSynthesizedSelf) {
        objType = evaluator.makeTopLevelTypeVarsConcrete(objType);
    }

    FunctionType.addParameter(delFunction, {
        category: ParameterCategory.Simple,
        name: 'obj',
        type: combineTypes([objType, evaluator.getNoneType()]),
        hasDeclaredType: true,
    });
    delFunction.details.declaredReturnType = evaluator.getNoneType();
    const delSymbol = Symbol.createWithType(SymbolFlags.ClassMember, delFunction);
    fields.set('__delete__', delSymbol);
}

function updateGetSetDelMethodForClonedProperty(evaluator: TypeEvaluator, propertyObject: ClassType) {
    const fgetInfo = propertyObject.fgetInfo;
    if (fgetInfo && isFunction(fgetInfo.methodType)) {
        addGetMethodToPropertySymbolTable(evaluator, propertyObject, fgetInfo.methodType);
    }

    const fsetInfo = propertyObject.fsetInfo;
    if (fsetInfo && isFunction(fsetInfo.methodType)) {
        addSetMethodToPropertySymbolTable(evaluator, propertyObject, fsetInfo.methodType);
    }

    const fdelInfo = propertyObject.fdelInfo;
    if (fdelInfo && isFunction(fdelInfo.methodType)) {
        addDelMethodToPropertySymbolTable(evaluator, propertyObject, fdelInfo.methodType);
    }
}

function addDecoratorMethodsToPropertySymbolTable(propertyObject: ClassType) {
    const fields = ClassType.getSymbolTable(propertyObject);

    // Fill in the getter, setter and deleter methods.
    ['getter', 'setter', 'deleter'].forEach((accessorName) => {
        const accessorFunction = FunctionType.createSynthesizedInstance(accessorName);
        FunctionType.addParameter(accessorFunction, {
            category: ParameterCategory.Simple,
            name: 'self',
            type: AnyType.create(),
            hasDeclaredType: true,
        });
        FunctionType.addParameter(accessorFunction, {
            category: ParameterCategory.Simple,
            name: 'accessor',
            type: AnyType.create(),
            hasDeclaredType: true,
        });
        accessorFunction.details.declaredReturnType = propertyObject;
        const accessorSymbol = Symbol.createWithType(SymbolFlags.ClassMember, accessorFunction);
        fields.set(accessorName, accessorSymbol);
    });
}

export function assignProperty(
    evaluator: TypeEvaluator,
    destPropertyType: ClassType,
    srcPropertyType: ClassType,
    destClass: ClassType,
    srcClass: ClassType | ModuleType,
    diag: DiagnosticAddendum | undefined,
    typeVarContext?: TypeVarContext,
    selfTypeVarContext?: TypeVarContext,
    recursionCount = 0
): boolean {
    const srcObjectToBind = isClass(srcClass) ? ClassType.cloneAsInstance(srcClass) : undefined;
    const destObjectToBind = ClassType.cloneAsInstance(destClass);
    let isAssignable = true;
    const accessors: {
        getFunction: (c: ClassType) => FunctionType | undefined;
        missingDiagMsg: () => string;
        incompatibleDiagMsg: () => string;
    }[] = [
        {
            getFunction: (c: ClassType) => c.fgetInfo?.methodType,
            missingDiagMsg: LocAddendum.missingGetter,
            incompatibleDiagMsg: LocAddendum.incompatibleGetter,
        },
        {
            getFunction: (c: ClassType) => c.fsetInfo?.methodType,
            missingDiagMsg: LocAddendum.missingSetter,
            incompatibleDiagMsg: LocAddendum.incompatibleSetter,
        },
        {
            getFunction: (c: ClassType) => c.fdelInfo?.methodType,
            missingDiagMsg: LocAddendum.missingDeleter,
            incompatibleDiagMsg: LocAddendum.incompatibleDeleter,
        },
    ];

    accessors.forEach((accessorInfo) => {
        let destAccessType = accessorInfo.getFunction(destPropertyType);

        if (destAccessType && isFunction(destAccessType)) {
            let srcAccessType = accessorInfo.getFunction(srcPropertyType);

            if (!srcAccessType || !isFunction(srcAccessType)) {
                diag?.addMessage(accessorInfo.missingDiagMsg());
                isAssignable = false;
                return;
            }

            evaluator.inferReturnTypeIfNecessary(srcAccessType);
            evaluator.inferReturnTypeIfNecessary(destAccessType);

            // If the caller provided a "self" TypeVar context, replace any Self types.
            // This is needed during protocol matching.
            if (selfTypeVarContext) {
                destAccessType = applySolvedTypeVars(destAccessType, selfTypeVarContext) as FunctionType;
            }

            // The access methods of fget, fset and fdel are modeled as static
            // variables because they do not bind go the "property" class that
            // contains them, but we'll turn it back into a non-static method
            // here and bind them to the associated objects.
            destAccessType = FunctionType.cloneWithNewFlags(
                destAccessType,
                destAccessType.details.flags & ~FunctionTypeFlags.StaticMethod
            );

            srcAccessType = FunctionType.cloneWithNewFlags(
                srcAccessType,
                srcAccessType.details.flags & ~FunctionTypeFlags.StaticMethod
            );

            const boundDestAccessType = evaluator.bindFunctionToClassOrObject(
                destObjectToBind,
                destAccessType,
                /* memberClass */ undefined,
                /* treatConstructorAsClassMethod */ undefined,
                /* firstParamType */ undefined,
                diag?.createAddendum(),
                recursionCount
            );

            const boundSrcAccessType = evaluator.bindFunctionToClassOrObject(
                srcObjectToBind,
                srcAccessType,
                /* memberClass */ undefined,
                /* treatConstructorAsClassMethod */ undefined,
                /* firstParamType */ undefined,
                diag?.createAddendum(),
                recursionCount
            );

            if (
                !boundDestAccessType ||
                !boundSrcAccessType ||
                !evaluator.assignType(
                    boundDestAccessType,
                    boundSrcAccessType,
                    diag,
                    typeVarContext,
                    /* srcTypeVarContext */ undefined,
                    AssignTypeFlags.Default,
                    recursionCount
                )
            ) {
                isAssignable = false;
            }
        }
    });

    return isAssignable;
}
