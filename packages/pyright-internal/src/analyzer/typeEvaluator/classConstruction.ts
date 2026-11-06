/*
 * classConstruction.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Class synthesis and effective metaclass selection.
 */

import { assert } from '../../common/debug';
import { DiagnosticAddendum } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../../localization/localize';
import { ArgCategory, ExpressionNode, ParamCategory, ParseNode, ParseNodeType } from '../../parser/parseNodes';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import * as ParseTreeUtils from '../parseTreeUtils';
import { Symbol, SymbolFlags } from '../symbol';
import { Arg, ExpectedTypeOptions, PrefetchedTypes, TypeEvaluator, TypeResult } from '../typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClassInstance,
    isInstantiableClass,
    isTypeVar,
    Type,
    TypeBase,
    TypeVarType,
    UnknownType,
} from '../types';
import {
    addConditionToType,
    computeMroLinearization,
    convertToInstance,
    derivesFromClassRecursive,
    getTypeVarScopeId,
    InferenceContext,
} from '../typeUtils';

interface Context {
    readonly addDiagnostic: TypeEvaluator['addDiagnostic'];
    readonly assignType: TypeEvaluator['assignType'];
    readonly getBaseClassesFromTypeCall: (baseTupleType: ClassType) => Type[] | undefined;
    readonly getBuiltInType: (node: ParseNode, name: string) => Type;
    readonly getNoneType: () => Type;
    readonly getTypeOfArg: (arg: Arg, inferenceContext: InferenceContext | undefined) => TypeResult;
    readonly getTypeOfArgExpectingType: (arg: Arg, options?: ExpectedTypeOptions) => TypeResult;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly prefetched: Partial<PrefetchedTypes> | undefined;
    readonly printType: TypeEvaluator['printType'];
}

// Synthesizes classes and resolves effective metaclasses, delegating evaluation and diagnostics.
export function createClassConstruction(context: Context) {
    const {
        addDiagnostic,
        assignType,
        getBaseClassesFromTypeCall,
        getBuiltInType,
        getNoneType,
        getTypeOfArg,
        getTypeOfArgExpectingType,
        nodeInfo,
        printType,
    } = context;

    function createNewType(errorNode: ExpressionNode, argList: Arg[]): ClassType | undefined {
        const fileInfo = nodeInfo.getFileInfo(errorNode);
        let className = '';

        if (argList.length !== 2) {
            addDiagnostic(DiagnosticRule.reportCallIssue, LocMessage.newTypeParamCount(), errorNode);
            return undefined;
        }

        const nameArg = argList[0];
        if (
            nameArg.argCategory === ArgCategory.Simple &&
            nameArg.valueExpression &&
            nameArg.valueExpression.nodeType === ParseNodeType.StringList
        ) {
            className = nameArg.valueExpression.d.strings.map((s) => s.d.value).join('');
        }

        if (!className) {
            addDiagnostic(DiagnosticRule.reportArgumentType, LocMessage.newTypeBadName(), argList[0].node ?? errorNode);
            return undefined;
        }

        if (
            errorNode.parent?.nodeType === ParseNodeType.Assignment &&
            errorNode.parent.d.leftExpr.nodeType === ParseNodeType.Name &&
            errorNode.parent.d.leftExpr.d.value !== className
        ) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeNameMismatch(),
                errorNode.parent.d.leftExpr
            );
            return undefined;
        }

        let baseClass = getTypeOfArgExpectingType(argList[1]).type;
        let isBaseClassAny = false;

        if (isAnyOrUnknown(baseClass)) {
            baseClass = context.prefetched?.objectClass ?? UnknownType.create();

            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeAnyOrUnknown(),
                argList[1].node ?? errorNode
            );

            isBaseClassAny = true;
        }

        // Specifically disallow Annotated.
        if (
            baseClass.props?.specialForm &&
            isClassInstance(baseClass.props.specialForm) &&
            ClassType.isBuiltIn(baseClass.props.specialForm, 'Annotated')
        ) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeNotAClass(),
                argList[1].node || errorNode
            );
            return undefined;
        }

        if (!isInstantiableClass(baseClass)) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeNotAClass(),
                argList[1].node || errorNode
            );
            return undefined;
        }

        if (ClassType.isProtocolClass(baseClass) || ClassType.isTypedDictClass(baseClass)) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeProtocolClass(),
                argList[1].node || errorNode
            );
        } else if (baseClass.priv.literalValue !== undefined) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.newTypeLiteral(),
                argList[1].node || errorNode
            );
        }

        const classType = ClassType.createInstantiable(
            className,
            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            fileInfo.fileUri,
            ClassTypeFlags.Final | ClassTypeFlags.NewTypeClass | ClassTypeFlags.ValidTypeAliasClass,
            ParseTreeUtils.getTypeSourceId(errorNode),
            /* declaredMetaclass */ undefined,
            baseClass.shared.effectiveMetaclass
        );
        classType.shared.baseClasses.push(isBaseClassAny ? AnyType.create() : baseClass);
        computeMroLinearization(classType);

        if (!isBaseClassAny) {
            // Synthesize an __init__ method that accepts only the specified type.
            const initType = FunctionType.createSynthesizedInstance('__init__');
            FunctionType.addParam(
                initType,
                FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'self')
            );
            FunctionType.addParam(
                initType,
                FunctionParam.create(
                    ParamCategory.Simple,
                    ClassType.cloneAsInstance(baseClass),
                    FunctionParamFlags.TypeDeclared,
                    '_x'
                )
            );
            initType.shared.declaredReturnType = getNoneType();
            ClassType.getSymbolTable(classType).set(
                '__init__',
                Symbol.createWithType(SymbolFlags.ClassMember, initType)
            );

            // Synthesize a trivial __new__ method.
            const newType = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.ConstructorMethod);
            FunctionType.addParam(
                newType,
                FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'cls')
            );
            FunctionType.addDefaultParams(newType);
            newType.shared.declaredReturnType = ClassType.cloneAsInstance(classType);
            newType.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);
            ClassType.getSymbolTable(classType).set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
        }

        return classType;
    }

    function createClassFromMetaclass(
        errorNode: ExpressionNode,
        argList: Arg[],
        metaclass: ClassType
    ): ClassType | undefined {
        const fileInfo = nodeInfo.getFileInfo(errorNode);
        const arg0Type = getTypeOfArg(argList[0], /* inferenceContext */ undefined).type;
        if (!isClassInstance(arg0Type) || !ClassType.isBuiltIn(arg0Type, 'str')) {
            return undefined;
        }
        const className = (arg0Type.priv.literalValue as string) || '_';

        const baseTupleType = getTypeOfArg(argList[1], /* inferenceContext */ undefined).type;
        if (!isClassInstance(baseTupleType)) {
            return undefined;
        }

        const baseClasses = getBaseClassesFromTypeCall(baseTupleType);
        if (!baseClasses) {
            return undefined;
        }

        const classType = ClassType.createInstantiable(
            className,
            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            fileInfo.fileUri,
            ClassTypeFlags.ValidTypeAliasClass,
            ParseTreeUtils.getTypeSourceId(errorNode),
            metaclass,
            baseTupleType.shared.effectiveMetaclass
        );
        classType.shared.baseClasses.push(...baseClasses);

        if (!computeMroLinearization(classType)) {
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.methodOrdering(), errorNode);
        }

        return classType;
    }

    function createSubclass(errorNode: ExpressionNode, type1: ClassType, type2: ClassType): ClassType {
        assert(isInstantiableClass(type1) && isInstantiableClass(type2));

        // If both classes are class objects (type[A] and type[B]), create a new
        // class object (type[A & B]) rather than "type[A] & type[B]".
        let createClassObject = false;
        if (TypeBase.getInstantiableDepth(type1) > 0 && TypeBase.getInstantiableDepth(type2) > 0) {
            type1 = ClassType.cloneAsInstance(type1);
            type2 = ClassType.cloneAsInstance(type2);
            createClassObject = true;
        }

        const className = `<subclass of ${printType(convertToInstance(type1), {
            omitTypeArgsIfUnknown: true,
        })} and ${printType(convertToInstance(type2), { omitTypeArgsIfUnknown: true })}>`;
        const fileInfo = nodeInfo.getFileInfo(errorNode);

        // The effective metaclass of the intersection is the narrower of the two metaclasses.
        let effectiveMetaclass = type1.shared.effectiveMetaclass;
        if (type2.shared.effectiveMetaclass) {
            if (!effectiveMetaclass || assignType(effectiveMetaclass, type2.shared.effectiveMetaclass)) {
                effectiveMetaclass = type2.shared.effectiveMetaclass;
            }
        }

        let newClassType = ClassType.createInstantiable(
            className,
            ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
            fileInfo.moduleName,
            fileInfo.fileUri,
            ClassTypeFlags.None,
            ParseTreeUtils.getTypeSourceId(errorNode),
            /* declaredMetaclass */ undefined,
            effectiveMetaclass,
            type1.shared.docString
        );

        newClassType.shared.baseClasses = [type1, type2];
        computeMroLinearization(newClassType);

        newClassType = addConditionToType(newClassType, type1.props?.condition);
        newClassType = addConditionToType(newClassType, type2.props?.condition);

        if (createClassObject) {
            newClassType = ClassType.cloneAsInstantiable(newClassType);
        }

        return newClassType;
    }

    function buildTypeParamsFromTypeArgs(classType: ClassType): TypeVarType[] {
        const typeParams: TypeVarType[] = [];
        const typeArgs = classType.priv.typeArgs ?? [];

        typeArgs.forEach((typeArg, index) => {
            if (isTypeVar(typeArg)) {
                typeParams.push(typeArg);
                return;
            }

            // Synthesize a dummy type parameter.
            const typeVar = TypeVarType.createInstance(`__P${index}`);
            typeVar.shared.isSynthesized = true;
            typeParams.push(typeVar);
        });

        return typeParams;
    }

    function computeEffectiveMetaclass(classType: ClassType, errorNode: ParseNode) {
        let effectiveMetaclass = classType.shared.declaredMetaclass;
        let reportedMetaclassConflict = false;

        if (!effectiveMetaclass || isInstantiableClass(effectiveMetaclass)) {
            for (const baseClass of classType.shared.baseClasses) {
                if (isInstantiableClass(baseClass)) {
                    const baseClassMeta = baseClass.shared.effectiveMetaclass ?? context.prefetched?.typeClass;
                    if (baseClassMeta && isInstantiableClass(baseClassMeta)) {
                        // Make sure there is no metaclass conflict.
                        if (!effectiveMetaclass) {
                            effectiveMetaclass = baseClassMeta;
                        } else if (
                            derivesFromClassRecursive(baseClassMeta, effectiveMetaclass, /* ignoreUnknown */ false)
                        ) {
                            effectiveMetaclass = baseClassMeta;
                        } else if (
                            !derivesFromClassRecursive(effectiveMetaclass, baseClassMeta, /* ignoreUnknown */ false)
                        ) {
                            if (!reportedMetaclassConflict) {
                                const diag = new DiagnosticAddendum();

                                diag.addMessage(
                                    LocAddendum.metaclassConflict().format({
                                        metaclass1: printType(convertToInstance(effectiveMetaclass)),
                                        metaclass2: printType(convertToInstance(baseClassMeta)),
                                    })
                                );
                                addDiagnostic(
                                    DiagnosticRule.reportGeneralTypeIssues,
                                    LocMessage.metaclassConflict() + diag.getString(),
                                    errorNode
                                );

                                // Don't report more than once.
                                reportedMetaclassConflict = true;
                            }
                        }
                    } else {
                        effectiveMetaclass = baseClassMeta ? UnknownType.create() : undefined;
                        break;
                    }
                } else {
                    // If one of the base classes is unknown, then the effective
                    // metaclass is also unknowable.
                    effectiveMetaclass = UnknownType.create();
                    break;
                }
            }
        }

        // If we haven't found an effective metaclass, assume "type", which
        // is the metaclass for "object".
        if (!effectiveMetaclass) {
            const typeMetaclass = getBuiltInType(errorNode, 'type');
            effectiveMetaclass =
                typeMetaclass && isInstantiableClass(typeMetaclass) ? typeMetaclass : UnknownType.create();
        }

        classType.shared.effectiveMetaclass = effectiveMetaclass;

        return effectiveMetaclass;
    }

    return {
        createNewType,
        createClassFromMetaclass,
        createSubclass,
        buildTypeParamsFromTypeArgs,
        computeEffectiveMetaclass,
    };
}
