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
import { Localizer } from '../localization/localize';
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
    isFunction,
    isInstantiableClass,
    isTypeSame,
    isTypeVar,
    NoneType,
    OverloadedFunctionType,
    Type,
    UnknownType,
} from './types';
import {
    applySolvedTypeVars,
    CanAssignFlags,
    computeMroLinearization,
    getTypeVarScopeId,
    isProperty,
    partiallySpecializeType,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';

export function validatePropertyMethod(evaluator: TypeEvaluator, method: FunctionType, errorNode: ParseNode) {
    if (FunctionType.isStaticMethod(method)) {
        evaluator.addDiagnostic(
            getFileInfo(errorNode).diagnosticRuleSet.reportGeneralTypeIssues,
            DiagnosticRule.reportGeneralTypeIssues,
            Localizer.Diagnostic.propertyStaticMethod(),
            errorNode
        );
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
        fileInfo.filePath,
        ClassTypeFlags.PropertyClass,
        typeSourceId,
        /* declaredMetaclass */ undefined,
        isInstantiableClass(typeMetaclass) ? typeMetaclass : UnknownType.create()
    );

    propertyClass.details.typeVarScopeId = decoratorType.details.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(decoratorNode, 'object');
    propertyClass.details.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
    computeMroLinearization(propertyClass);

    // Clone the symbol table of the old class type.
    const fields = propertyClass.details.fields;
    decoratorType.details.fields.forEach((symbol, name) => {
        const ignoredMethods = ['__get__', '__set__', '__delete__', 'fget', 'fset', 'fdel'];

        if (!symbol.isIgnoredForProtocolMatch()) {
            if (!ignoredMethods.some((m) => m === name)) {
                fields.set(name, symbol);
            }
        }
    });

    const propertyObject = ClassType.cloneAsInstance(propertyClass);
    propertyClass.isAsymmetricDescriptor = false;

    // Update the __set__ and __delete__ methods if present.
    updateGetSetDelMethodForClonedProperty(propertyObject, evaluator);

    // Fill in the fget method.
    const fgetSymbol = Symbol.createWithType(
        SymbolFlags.ClassMember,
        FunctionType.cloneWithNewFlags(fget, fget.details.flags | FunctionTypeFlags.StaticMethod)
    );
    fields.set('fget', fgetSymbol);

    if (FunctionType.isClassMethod(fget)) {
        propertyClass.details.flags |= ClassTypeFlags.ClassProperty;
    }

    // Fill in the __get__ method with an overload.
    addGetMethodToPropertySymbolTable(propertyObject, fget);

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
                    disallowRecursiveTypeAlias: true,
                });

                // The setter type should be assignable to the getter type.
                if (fileInfo.diagnosticRuleSet.reportPropertyTypeMismatch !== 'none') {
                    const diag = new DiagnosticAddendum();
                    if (!evaluator.canAssignType(fgetType, fsetType, diag)) {
                        evaluator.addDiagnostic(
                            fileInfo.diagnosticRuleSet.reportPropertyTypeMismatch,
                            DiagnosticRule.reportPropertyTypeMismatch,
                            Localizer.Diagnostic.setterGetterTypeMismatch() + diag.getString(),
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
        getFileInfo(errorNode).filePath,
        flagsToClone,
        classType.details.typeSourceId,
        classType.details.declaredMetaclass,
        classType.details.effectiveMetaclass
    );
    propertyClass.details.typeVarScopeId = classType.details.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(errorNode, 'object');
    propertyClass.details.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
    computeMroLinearization(propertyClass);

    const propertyObject = ClassType.cloneAsInstance(propertyClass);
    propertyClass.isAsymmetricDescriptor = isAsymmetricDescriptor;

    // Clone the symbol table of the old class type.
    const fields = propertyClass.details.fields;
    classType.details.fields.forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            fields.set(name, symbol);
        }
    });

    // Update the __get__ and __delete__ methods if present.
    updateGetSetDelMethodForClonedProperty(propertyObject, evaluator);

    // Fill in the fset method.
    const fsetSymbol = Symbol.createWithType(
        SymbolFlags.ClassMember,
        FunctionType.cloneWithNewFlags(fset, fset.details.flags | FunctionTypeFlags.StaticMethod)
    );
    fields.set('fset', fsetSymbol);

    // Fill in the __set__ method.
    addSetMethodToPropertySymbolTable(propertyObject, fset, evaluator);

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
        getFileInfo(errorNode).filePath,
        classType.details.flags,
        classType.details.typeSourceId,
        classType.details.declaredMetaclass,
        classType.details.effectiveMetaclass
    );
    propertyClass.details.typeVarScopeId = classType.details.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(errorNode, 'object');
    propertyClass.details.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
    computeMroLinearization(propertyClass);

    const propertyObject = ClassType.cloneAsInstance(propertyClass);
    propertyClass.isAsymmetricDescriptor = classType.isAsymmetricDescriptor ?? false;

    // Clone the symbol table of the old class type.
    const fields = propertyClass.details.fields;
    classType.details.fields.forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            fields.set(name, symbol);
        }
    });

    // Update the __get__ and __set__ methods if present.
    updateGetSetDelMethodForClonedProperty(propertyObject, evaluator);

    // Fill in the fdel method.
    const fdelSymbol = Symbol.createWithType(
        SymbolFlags.ClassMember,
        FunctionType.cloneWithNewFlags(fdel, fdel.details.flags | FunctionTypeFlags.StaticMethod)
    );
    fields.set('fdel', fdelSymbol);

    // Fill in the __delete__ method.
    addDelMethodToPropertySymbolTable(propertyObject, fdel, evaluator);

    // Fill in the getter, setter and deleter methods.
    addDecoratorMethodsToPropertySymbolTable(propertyObject);

    return propertyObject;
}

function addGetMethodToPropertySymbolTable(propertyObject: ClassType, fget: FunctionType) {
    const fields = propertyObject.details.fields;

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
        type: NoneType.createInstance(),
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
        ? FunctionType.getSpecializedReturnType(fget)
        : propertyObject;
    getFunction1.details.declaration = fget.details.declaration;

    const getFunction2 = FunctionType.createSynthesizedInstance('__get__', FunctionTypeFlags.Overloaded);
    FunctionType.addParameter(getFunction2, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: AnyType.create(),
        hasDeclaredType: true,
    });

    const objType = fget.details.parameters.length > 0 ? fget.details.parameters[0].type : AnyType.create();
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
    getFunction2.details.declaredReturnType = FunctionType.getSpecializedReturnType(fget);
    getFunction2.details.declaration = fget.details.declaration;

    // Override the scope ID since we're using parameter types from the
    // decorated function.
    getFunction2.details.typeVarScopeId = getTypeVarScopeId(fget);

    const getFunctionOverload = OverloadedFunctionType.create([getFunction1, getFunction2]);
    const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunctionOverload);
    fields.set('__get__', getSymbol);
}

function addSetMethodToPropertySymbolTable(propertyObject: ClassType, fset: FunctionType, evaluator: TypeEvaluator) {
    const fields = propertyObject.details.fields;

    const setFunction = FunctionType.createSynthesizedInstance('__set__');
    FunctionType.addParameter(setFunction, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: AnyType.create(),
        hasDeclaredType: true,
    });
    let objType = fset.details.parameters.length > 0 ? fset.details.parameters[0].type : AnyType.create();
    if (isTypeVar(objType) && objType.details.isSynthesizedSelf) {
        objType = evaluator.makeTopLevelTypeVarsConcrete(objType);
    }
    FunctionType.addParameter(setFunction, {
        category: ParameterCategory.Simple,
        name: 'obj',
        type: combineTypes([objType, NoneType.createInstance()]),
        hasDeclaredType: true,
    });
    setFunction.details.declaredReturnType = NoneType.createInstance();
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

function addDelMethodToPropertySymbolTable(propertyObject: ClassType, fdel: FunctionType, evaluator: TypeEvaluator) {
    const fields = propertyObject.details.fields;

    const delFunction = FunctionType.createSynthesizedInstance('__delete__');
    FunctionType.addParameter(delFunction, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: AnyType.create(),
        hasDeclaredType: true,
    });
    let objType = fdel.details.parameters.length > 0 ? fdel.details.parameters[0].type : AnyType.create();
    if (isTypeVar(objType) && objType.details.isSynthesizedSelf) {
        objType = evaluator.makeTopLevelTypeVarsConcrete(objType);
    }
    FunctionType.addParameter(delFunction, {
        category: ParameterCategory.Simple,
        name: 'obj',
        type: combineTypes([objType, NoneType.createInstance()]),
        hasDeclaredType: true,
    });
    delFunction.details.declaredReturnType = NoneType.createInstance();
    const delSymbol = Symbol.createWithType(SymbolFlags.ClassMember, delFunction);
    fields.set('__delete__', delSymbol);
}

function updateGetSetDelMethodForClonedProperty(propertyObject: ClassType, evaluator: TypeEvaluator) {
    const fields = propertyObject.details.fields;

    const fgetSymbol = fields.get('fget');
    const fgetType = fgetSymbol?.getSynthesizedType();
    if (fgetType && isFunction(fgetType)) {
        addGetMethodToPropertySymbolTable(propertyObject, fgetType);
    }

    const fsetSymbol = fields.get('fset');
    const fsetType = fsetSymbol?.getSynthesizedType();
    if (fsetType && isFunction(fsetType)) {
        addSetMethodToPropertySymbolTable(propertyObject, fsetType, evaluator);
    }

    const fdelSymbol = fields.get('fdel');
    const fdelType = fdelSymbol?.getSynthesizedType();
    if (fdelType && isFunction(fdelType)) {
        addDelMethodToPropertySymbolTable(propertyObject, fdelType, evaluator);
    }
}

function addDecoratorMethodsToPropertySymbolTable(propertyObject: ClassType) {
    const fields = propertyObject.details.fields;

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

export function canAssignProperty(
    evaluator: TypeEvaluator,
    destPropertyType: ClassType,
    srcPropertyType: ClassType,
    destClass: ClassType,
    srcClass: ClassType,
    diag: DiagnosticAddendum | undefined,
    typeVarContext?: TypeVarContext,
    selfTypeVarContext?: TypeVarContext,
    recursionCount = 0
): boolean {
    const objectToBind = ClassType.cloneAsInstance(srcClass);
    let isAssignable = true;
    const accessors: { name: string; missingDiagMsg: () => string; incompatibleDiagMsg: () => string }[] = [
        {
            name: 'fget',
            missingDiagMsg: Localizer.DiagnosticAddendum.missingGetter,
            incompatibleDiagMsg: Localizer.DiagnosticAddendum.incompatibleGetter,
        },
        {
            name: 'fset',
            missingDiagMsg: Localizer.DiagnosticAddendum.missingSetter,
            incompatibleDiagMsg: Localizer.DiagnosticAddendum.incompatibleSetter,
        },
        {
            name: 'fdel',
            missingDiagMsg: Localizer.DiagnosticAddendum.missingDeleter,
            incompatibleDiagMsg: Localizer.DiagnosticAddendum.incompatibleDeleter,
        },
    ];

    accessors.forEach((accessorInfo) => {
        const destAccessSymbol = destPropertyType.details.fields.get(accessorInfo.name);
        let destAccessType = destAccessSymbol ? evaluator.getDeclaredTypeOfSymbol(destAccessSymbol) : undefined;

        if (destAccessType && isFunction(destAccessType)) {
            const srcAccessSymbol = srcPropertyType.details.fields.get(accessorInfo.name);
            let srcAccessType = srcAccessSymbol ? evaluator.getDeclaredTypeOfSymbol(srcAccessSymbol) : undefined;

            if (!srcAccessType || !isFunction(srcAccessType)) {
                diag?.addMessage(accessorInfo.missingDiagMsg());
                isAssignable = false;
                return;
            }

            srcAccessType = partiallySpecializeType(srcAccessType, srcClass) as FunctionType;
            destAccessType = partiallySpecializeType(destAccessType, destClass) as FunctionType;

            // If the caller provided a "self" TypeVar context, replace any Self types.
            // This is needed during protocol matching.
            if (selfTypeVarContext) {
                destAccessType = applySolvedTypeVars(destAccessType, selfTypeVarContext) as FunctionType;
            }

            const boundDestAccessType = evaluator.bindFunctionToClassOrObject(
                objectToBind,
                destAccessType,
                /* memberClass */ undefined,
                /* errorNode */ undefined,
                recursionCount
            );
            const boundSrcAccessType = evaluator.bindFunctionToClassOrObject(
                objectToBind,
                srcAccessType,
                /* memberClass */ undefined,
                /* errorNode */ undefined,
                recursionCount
            );

            if (
                !boundDestAccessType ||
                !boundSrcAccessType ||
                !evaluator.canAssignType(
                    boundDestAccessType,
                    boundSrcAccessType,
                    diag,
                    typeVarContext,
                    CanAssignFlags.Default,
                    recursionCount
                )
            ) {
                isAssignable = false;
            }
        }
    });

    return isAssignable;
}
