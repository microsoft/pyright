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
import { DecoratorNode, FunctionNode, ParamCategory, ParseNode } from '../parser/parseNodes';
import { getFileInfo } from './analyzerNodeInfo';
import { ConstraintSolution } from './constraintSolution';
import { ConstraintTracker } from './constraintTracker';
import { getClassFullName, getTypeAnnotationForParam, getTypeSourceId } from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import { AssignTypeFlags, TypeEvaluator } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isFunction,
    isInstantiableClass,
    isTypeSame,
    isTypeVar,
    ModuleType,
    OverloadedType,
    Type,
    TypeVarType,
    UnknownType,
} from './types';
import { applySolvedTypeVars, computeMroLinearization, getTypeVarScopeId, isProperty } from './typeUtils';

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
        : decoratorType.shared.typeSourceId;

    const propertyClass = ClassType.createInstantiable(
        decoratorType.shared.name,
        getClassFullName(decoratorNode, fileInfo.moduleName, `__property_${fget.shared.name}`),
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.PropertyClass | ClassTypeFlags.BuiltIn,
        typeSourceId,
        /* declaredMetaclass */ undefined,
        isInstantiableClass(typeMetaclass) ? typeMetaclass : UnknownType.create()
    );

    propertyClass.shared.declaration = decoratorType.shared.declaration;
    propertyClass.shared.typeVarScopeId = decoratorType.shared.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(decoratorNode, 'object');
    propertyClass.shared.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
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
    propertyClass.priv.isAsymmetricDescriptor = false;

    // Update the __set__ and __delete__ methods if present.
    updateGetSetDelMethodForClonedProperty(evaluator, propertyObject);

    // Fill in the fget method.
    propertyObject.priv.fgetInfo = {
        methodType: fget,
        classType: fget.shared.methodClass,
    };

    if (FunctionType.isClassMethod(fget)) {
        propertyClass.shared.flags |= ClassTypeFlags.ClassProperty;
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
    const flagsToClone = classType.shared.flags;
    let isAsymmetricDescriptor = !!classType.priv.isAsymmetricDescriptor;

    // Verify parameters for fset.
    // We'll skip this test if the diagnostic rule is disabled because it
    // can be somewhat expensive, especially in code that is not annotated.
    const fileInfo = getFileInfo(errorNode);
    if (errorNode.d.params.length >= 2) {
        const typeAnnotation = getTypeAnnotationForParam(errorNode, 1);
        if (typeAnnotation) {
            // Verify consistency of the type.
            const fgetType = evaluator.getGetterTypeFromProperty(classType);
            if (fgetType && !isAnyOrUnknown(fgetType)) {
                const fsetType = evaluator.getTypeOfAnnotation(typeAnnotation, {
                    typeVarGetsCurScope: true,
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
        classType.shared.name,
        classType.shared.fullName,
        classType.shared.moduleName,
        getFileInfo(errorNode).fileUri,
        flagsToClone,
        classType.shared.typeSourceId,
        classType.shared.declaredMetaclass,
        classType.shared.effectiveMetaclass
    );

    propertyClass.shared.declaration = classType.shared.declaration;
    propertyClass.shared.typeVarScopeId = classType.shared.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(errorNode, 'object');
    propertyClass.shared.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
    computeMroLinearization(propertyClass);

    propertyClass.priv.fgetInfo = classType.priv.fgetInfo;
    propertyClass.priv.fdelInfo = classType.priv.fdelInfo;
    propertyClass.priv.isAsymmetricDescriptor = isAsymmetricDescriptor;
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
    propertyObject.priv.fsetInfo = {
        methodType: fset,
        classType: fset.shared.methodClass,
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
        classType.shared.name,
        classType.shared.fullName,
        classType.shared.moduleName,
        getFileInfo(errorNode).fileUri,
        classType.shared.flags,
        classType.shared.typeSourceId,
        classType.shared.declaredMetaclass,
        classType.shared.effectiveMetaclass
    );

    propertyClass.shared.declaration = classType.shared.declaration;
    propertyClass.shared.typeVarScopeId = classType.shared.typeVarScopeId;
    const objectType = evaluator.getBuiltInType(errorNode, 'object');
    propertyClass.shared.baseClasses.push(isInstantiableClass(objectType) ? objectType : UnknownType.create());
    computeMroLinearization(propertyClass);

    propertyClass.priv.fgetInfo = classType.priv.fgetInfo;
    propertyClass.priv.fsetInfo = classType.priv.fsetInfo;
    const propertyObject = ClassType.cloneAsInstance(propertyClass);
    propertyClass.priv.isAsymmetricDescriptor = classType.priv.isAsymmetricDescriptor ?? false;

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
    propertyObject.priv.fdelInfo = {
        methodType: fdel,
        classType: fdel.shared.methodClass,
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
    FunctionType.addParam(
        getFunction1,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'self')
    );
    FunctionType.addParam(
        getFunction1,
        FunctionParam.create(ParamCategory.Simple, evaluator.getNoneType(), FunctionParamFlags.TypeDeclared, 'obj')
    );
    FunctionType.addParam(
        getFunction1,
        FunctionParam.create(
            ParamCategory.Simple,
            AnyType.create(),
            FunctionParamFlags.TypeDeclared,
            'objtype',
            AnyType.create(/* isEllipsis */ true)
        )
    );
    getFunction1.shared.declaredReturnType = FunctionType.isClassMethod(fget)
        ? FunctionType.getEffectiveReturnType(fget)
        : propertyObject;
    getFunction1.shared.declaration = fget.shared.declaration;
    getFunction1.shared.deprecatedMessage = fget.shared.deprecatedMessage;
    getFunction1.shared.methodClass = fget.shared.methodClass;

    // Override the scope ID since we're using parameter types from the
    // decorated function.
    getFunction1.shared.typeVarScopeId = getTypeVarScopeId(fget);

    // The second overload is for accesses through a class instance.
    const getFunction2 = FunctionType.createSynthesizedInstance('__get__', FunctionTypeFlags.Overloaded);
    FunctionType.addParam(
        getFunction2,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'self')
    );

    const objType = fget.shared.parameters.length > 0 ? FunctionType.getParamType(fget, 0) : AnyType.create();

    FunctionType.addParam(
        getFunction2,
        FunctionParam.create(ParamCategory.Simple, objType, FunctionParamFlags.TypeDeclared, 'obj')
    );

    FunctionType.addParam(
        getFunction2,
        FunctionParam.create(
            ParamCategory.Simple,
            AnyType.create(),
            FunctionParamFlags.TypeDeclared,
            'objtype',
            AnyType.create(/* isEllipsis */ true)
        )
    );
    getFunction2.shared.declaredReturnType = FunctionType.getEffectiveReturnType(fget);
    getFunction2.shared.declaration = fget.shared.declaration;
    getFunction2.shared.deprecatedMessage = fget.shared.deprecatedMessage;
    getFunction2.shared.methodClass = fget.shared.methodClass;

    // Override the scope ID since we're using parameter types from the
    // decorated function.
    getFunction2.shared.typeVarScopeId = getTypeVarScopeId(fget);

    // We previously placed getFunction1 before getFunction2, but this creates
    // problems specifically for the `NoneType` class because None.__class__
    // is a property, and both overloads match in this case because None
    // is passed for the "obj" parameter.
    const getFunctionOverload = OverloadedType.create([getFunction2, getFunction1]);
    const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunctionOverload);
    fields.set('__get__', getSymbol);
}

function addSetMethodToPropertySymbolTable(evaluator: TypeEvaluator, propertyObject: ClassType, fset: FunctionType) {
    const fields = ClassType.getSymbolTable(propertyObject);

    const setFunction = FunctionType.createSynthesizedInstance('__set__');
    FunctionType.addParam(
        setFunction,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'self')
    );

    let objType = fset.shared.parameters.length > 0 ? FunctionType.getParamType(fset, 0) : AnyType.create();
    if (isTypeVar(objType) && TypeVarType.isSelf(objType)) {
        objType = evaluator.makeTopLevelTypeVarsConcrete(objType);
    }

    FunctionType.addParam(
        setFunction,
        FunctionParam.create(
            ParamCategory.Simple,
            combineTypes([objType, evaluator.getNoneType()]),
            FunctionParamFlags.TypeDeclared,
            'obj'
        )
    );

    setFunction.shared.declaredReturnType = evaluator.getNoneType();

    // Adopt the TypeVarScopeId of the fset function in case it has any
    // TypeVars that need to be solved.
    setFunction.shared.typeVarScopeId = getTypeVarScopeId(fset);
    setFunction.shared.deprecatedMessage = fset.shared.deprecatedMessage;
    setFunction.shared.methodClass = fset.shared.methodClass;

    let setParamType: Type = UnknownType.create();

    if (
        fset.shared.parameters.length >= 2 &&
        fset.shared.parameters[1].category === ParamCategory.Simple &&
        fset.shared.parameters[1].name
    ) {
        setParamType = FunctionType.getParamType(fset, 1);
    }
    FunctionType.addParam(
        setFunction,
        FunctionParam.create(ParamCategory.Simple, setParamType, FunctionParamFlags.TypeDeclared, 'value')
    );
    const setSymbol = Symbol.createWithType(SymbolFlags.ClassMember, setFunction);
    fields.set('__set__', setSymbol);
}

function addDelMethodToPropertySymbolTable(evaluator: TypeEvaluator, propertyObject: ClassType, fdel: FunctionType) {
    const fields = ClassType.getSymbolTable(propertyObject);

    const delFunction = FunctionType.createSynthesizedInstance('__delete__');
    FunctionType.addParam(
        delFunction,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'self')
    );

    // Adopt the TypeVarScopeId of the fdel function in case it has any
    // TypeVars that need to be solved.
    delFunction.shared.typeVarScopeId = getTypeVarScopeId(fdel);
    delFunction.shared.deprecatedMessage = fdel.shared.deprecatedMessage;
    delFunction.shared.methodClass = fdel.shared.methodClass;

    let objType = fdel.shared.parameters.length > 0 ? FunctionType.getParamType(fdel, 0) : AnyType.create();

    if (isTypeVar(objType) && TypeVarType.isSelf(objType)) {
        objType = evaluator.makeTopLevelTypeVarsConcrete(objType);
    }

    FunctionType.addParam(
        delFunction,
        FunctionParam.create(
            ParamCategory.Simple,
            combineTypes([objType, evaluator.getNoneType()]),
            FunctionParamFlags.TypeDeclared,
            'obj'
        )
    );
    delFunction.shared.declaredReturnType = evaluator.getNoneType();
    const delSymbol = Symbol.createWithType(SymbolFlags.ClassMember, delFunction);
    fields.set('__delete__', delSymbol);
}

function updateGetSetDelMethodForClonedProperty(evaluator: TypeEvaluator, propertyObject: ClassType) {
    const fgetInfo = propertyObject.priv.fgetInfo;
    if (fgetInfo && isFunction(fgetInfo.methodType)) {
        addGetMethodToPropertySymbolTable(evaluator, propertyObject, fgetInfo.methodType);
    }

    const fsetInfo = propertyObject.priv.fsetInfo;
    if (fsetInfo && isFunction(fsetInfo.methodType)) {
        addSetMethodToPropertySymbolTable(evaluator, propertyObject, fsetInfo.methodType);
    }

    const fdelInfo = propertyObject.priv.fdelInfo;
    if (fdelInfo && isFunction(fdelInfo.methodType)) {
        addDelMethodToPropertySymbolTable(evaluator, propertyObject, fdelInfo.methodType);
    }
}

function addDecoratorMethodsToPropertySymbolTable(propertyObject: ClassType) {
    const fields = ClassType.getSymbolTable(propertyObject);

    // Fill in the getter, setter and deleter methods.
    ['getter', 'setter', 'deleter'].forEach((accessorName) => {
        const accessorFunction = FunctionType.createSynthesizedInstance(accessorName);
        FunctionType.addParam(
            accessorFunction,
            FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'self')
        );
        FunctionType.addParam(
            accessorFunction,
            FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'accessor')
        );
        accessorFunction.shared.declaredReturnType = propertyObject;
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
    constraints?: ConstraintTracker,
    selfSolution?: ConstraintSolution,
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
            getFunction: (c: ClassType) => c.priv.fgetInfo?.methodType,
            missingDiagMsg: LocAddendum.missingGetter,
            incompatibleDiagMsg: LocAddendum.incompatibleGetter,
        },
        {
            getFunction: (c: ClassType) => c.priv.fsetInfo?.methodType,
            missingDiagMsg: LocAddendum.missingSetter,
            incompatibleDiagMsg: LocAddendum.incompatibleSetter,
        },
        {
            getFunction: (c: ClassType) => c.priv.fdelInfo?.methodType,
            missingDiagMsg: LocAddendum.missingDeleter,
            incompatibleDiagMsg: LocAddendum.incompatibleDeleter,
        },
    ];

    accessors.forEach((accessorInfo) => {
        let destAccessType = accessorInfo.getFunction(destPropertyType);

        if (destAccessType && isFunction(destAccessType)) {
            const srcAccessType = accessorInfo.getFunction(srcPropertyType);

            if (!srcAccessType || !isFunction(srcAccessType)) {
                diag?.addMessage(accessorInfo.missingDiagMsg());
                isAssignable = false;
                return;
            }

            evaluator.inferReturnTypeIfNecessary(srcAccessType);
            evaluator.inferReturnTypeIfNecessary(destAccessType);

            // If the caller provided a "self" TypeVar context, replace any Self types.
            // This is needed during protocol matching.
            if (selfSolution) {
                destAccessType = applySolvedTypeVars(destAccessType, selfSolution) as FunctionType;
            }

            const boundDestAccessType =
                evaluator.bindFunctionToClassOrObject(
                    destObjectToBind,
                    destAccessType,
                    /* memberClass */ undefined,
                    /* treatConstructorAsClassMethod */ undefined,
                    /* firstParamType */ undefined,
                    diag?.createAddendum(),
                    recursionCount
                ) ?? destAccessType;

            const boundSrcAccessType =
                evaluator.bindFunctionToClassOrObject(
                    srcObjectToBind,
                    srcAccessType,
                    /* memberClass */ undefined,
                    /* treatConstructorAsClassMethod */ undefined,
                    /* firstParamType */ undefined,
                    diag?.createAddendum(),
                    recursionCount
                ) ?? srcAccessType;

            if (
                !evaluator.assignType(
                    boundDestAccessType,
                    boundSrcAccessType,
                    diag,
                    constraints,
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
