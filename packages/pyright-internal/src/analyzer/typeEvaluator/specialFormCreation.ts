/*
 * specialFormCreation.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * specialFormCreation implementation, using evaluator-owned dependencies and state.
 */

import { appendArray } from '../../common/collectionUtils';
import { assert } from '../../common/debug';
import { DiagnosticAddendum } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { PythonVersion, pythonVersion3_9 } from '../../common/pythonVersion';
import { LocAddendum, LocMessage } from '../../localization/localize';
import {
    ArgCategory,
    ClassNode,
    ExpressionNode,
    IndexNode,
    ParamCategory,
    ParseNode,
    ParseNodeType,
    TypeParameterNode,
} from '../../parser/parseNodes';
import { KeywordType, OperatorType, StringTokenFlags } from '../../parser/tokenizerTypes';
import { isAnnotationEvaluationPostponed } from '../analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { ConstraintTracker } from '../constraintTracker';
import { getFunctionInfoFromDecorators } from '../decorators';
import * as ParseTreeUtils from '../parseTreeUtils';
import { makeTupleObject } from '../tuples';
import {
    ClassTypeResult,
    EvalFlags,
    ExpectedTypeOptions,
    PrefetchedTypes,
    TypeEvaluator,
    TypeResult,
    TypeResultWithNode,
    ValidateTypeArgsOptions,
} from '../typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    combineTypes,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isModule,
    isNever,
    isParamSpec,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    isUnknown,
    isUnpackedClass,
    isUnpackedTypeVar,
    isUnpackedTypeVarTuple,
    LiteralValue,
    NeverType,
    ParamSpecType,
    TupleTypeArg,
    Type,
    TypeBase,
    TypeCondition,
    TypeVarScopeId,
    TypeVarScopeType,
    TypeVarTupleType,
    TypeVarType,
    UnknownType,
} from '../types';
import {
    addTypeVarsToListIfUnique,
    convertToInstance,
    doForEachSubtype,
    explodeGenericClass,
    getTypeVarArgsRecursive,
    getTypeVarScopeIds,
    isEllipsisType,
    isInstantiableMetaclass,
    isNoneInstance,
    isNoneTypeClass,
    isTupleClass,
    isTypeAliasPlaceholder,
    isUnboundedTupleClass,
    isVarianceOfTypeArgCompatible,
    requiresSpecialization,
    specializeTupleClass,
    synthesizeTypeVarForSelfCls,
    transformPossibleRecursiveTypeAlias,
    validateTypeVarDefault,
} from '../typeUtils';

interface Context {
    readonly addDiagnostic: TypeEvaluator['addDiagnostic'];
    readonly applyUnpackToTupleLike: (type: Type) => Type | undefined;
    readonly getScopeIdForNode: (node: ParseNode) => string;
    readonly getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    readonly getTupleClassType: () => ClassType | undefined;
    readonly getTypeVarScopesForNode: (node: ParseNode) => string[];
    readonly getTypingType: (node: ParseNode, symbolName: string) => Type | undefined;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly prefetched: Partial<PrefetchedTypes> | undefined;
    readonly validateTypeMetadata: (errorNode: ExpressionNode, baseType: Type, metaArg: TypeResultWithNode) => boolean;
    readonly assignType: TypeEvaluator['assignType'];
    readonly convertTypeArgToInstance: (type: Type, flags: EvalFlags) => Type;
    readonly getTypeOfAnnotation: (node: ExpressionNode, options?: ExpectedTypeOptions) => Type;
    readonly makeTopLevelTypeVarsConcrete: (
        type: Type,
        makeParamSpecsConcrete?: boolean,
        conditionFilter?: TypeCondition[]
    ) => Type;
    readonly printType: TypeEvaluator['printType'];
    readonly getBuiltInType: TypeEvaluator['getBuiltInType'];
    readonly solveAndApplyConstraints: TypeEvaluator['solveAndApplyConstraints'];
    readonly getTypeOfExpression: TypeEvaluator['getTypeOfExpression'];
}

// Synthesizes typing special forms and validates their arguments through evaluator callbacks.
export function createSpecialFormCreation(context: Context) {
    const {
        addDiagnostic,
        applyUnpackToTupleLike,
        getScopeIdForNode,
        getTypeOfClass,
        getTupleClassType,
        getTypeVarScopesForNode,
        getTypingType,
        nodeInfo,
        validateTypeMetadata,
        assignType,
        convertTypeArgToInstance,
        getTypeOfAnnotation,
        makeTopLevelTypeVarsConcrete,
        printType,
        getBuiltInType,
        solveAndApplyConstraints,
        getTypeOfExpression,
    } = context;

    function reportUseOfTypeCheckOnly(type: Type, node: ExpressionNode) {
        let isTypeCheckingOnly = false;
        let name = '';

        if (isInstantiableClass(type) && !type.priv.includeSubclasses) {
            isTypeCheckingOnly = ClassType.isTypeCheckOnly(type);
            name = type.shared.name;
        } else if (isFunction(type)) {
            isTypeCheckingOnly = FunctionType.isTypeCheckOnly(type);
            name = type.shared.name;
        }

        if (isTypeCheckingOnly) {
            const fileInfo = nodeInfo.getFileInfo(node);

            if (!fileInfo.isStubFile) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeCheckOnly().format({ name }),
                    node
                );
            }
        }
    }

    function enforceClassTypeVarScope(node: ExpressionNode, type: TypeVarType): boolean {
        const scopeId = type.priv.freeTypeVar?.priv.scopeId ?? type.priv.scopeId;
        if (!scopeId) {
            return true;
        }

        const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
        if (enclosingClass) {
            const liveTypeVarScopeIds = getTypeVarScopesForNode(enclosingClass);
            if (!liveTypeVarScopeIds.includes(scopeId)) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeVarInvalidForMemberVariable().format({
                        name: TypeVarType.getReadableName(type),
                    }),
                    node
                );

                return false;
            }
        }

        return true;
    }

    function adjustTypeArgsForTypeVarTuple(
        typeArgs: TypeResultWithNode[],
        typeParams: TypeVarType[],
        errorNode: ExpressionNode
    ): TypeResultWithNode[] {
        const variadicIndex = typeParams.findIndex((param) => isTypeVarTuple(param));

        // Is there a *tuple[T, ...] somewhere in the type arguments that we can expand if needed?
        let srcUnboundedTupleType: Type | undefined;
        const findUnboundedTupleIndex = (startArgIndex: number) => {
            return typeArgs.findIndex((arg, index) => {
                if (index < startArgIndex) {
                    return false;
                }
                if (
                    isUnpackedClass(arg.type) &&
                    arg.type.priv.tupleTypeArgs &&
                    arg.type.priv.tupleTypeArgs.length === 1 &&
                    arg.type.priv.tupleTypeArgs[0].isUnbounded
                ) {
                    srcUnboundedTupleType = arg.type.priv.tupleTypeArgs[0].type;
                    return true;
                }

                return false;
            });
        };
        let srcUnboundedTupleIndex = findUnboundedTupleIndex(0);

        // Allow only one unpacked tuple that maps to a TypeVarTuple.
        if (srcUnboundedTupleIndex >= 0) {
            const secondUnboundedTupleIndex = findUnboundedTupleIndex(srcUnboundedTupleIndex + 1);
            if (secondUnboundedTupleIndex >= 0) {
                addDiagnostic(
                    DiagnosticRule.reportInvalidTypeForm,
                    LocMessage.variadicTypeArgsTooMany(),
                    typeArgs[secondUnboundedTupleIndex].node
                );
            }
        }

        if (
            srcUnboundedTupleType &&
            srcUnboundedTupleIndex >= 0 &&
            variadicIndex >= 0 &&
            typeArgs.length < typeParams.length
        ) {
            // "Smear" the tuple type across type argument slots prior to the TypeVarTuple.
            while (variadicIndex > srcUnboundedTupleIndex) {
                typeArgs = [
                    ...typeArgs.slice(0, srcUnboundedTupleIndex),
                    { node: typeArgs[srcUnboundedTupleIndex].node, type: srcUnboundedTupleType },
                    ...typeArgs.slice(srcUnboundedTupleIndex),
                ];
                srcUnboundedTupleIndex++;
            }

            // "Smear" the tuple type across type argument slots following the TypeVarTuple.
            while (typeArgs.length < typeParams.length) {
                typeArgs = [
                    ...typeArgs.slice(0, srcUnboundedTupleIndex + 1),
                    { node: typeArgs[srcUnboundedTupleIndex].node, type: srcUnboundedTupleType },
                    ...typeArgs.slice(srcUnboundedTupleIndex + 1),
                ];
            }
        }

        // Do we need to adjust the type arguments to map to a variadic type
        // param somewhere in the list?
        if (variadicIndex >= 0) {
            const variadicTypeVar = typeParams[variadicIndex];

            // If the type param list ends with a ParamSpec with a default value,
            // we can ignore it for purposes of finding type args that map to the
            // TypeVarTuple.
            let typeParamCount = typeParams.length;
            while (typeParamCount > 0) {
                const lastTypeParam = typeParams[typeParamCount - 1];
                if (!isParamSpec(lastTypeParam) || !lastTypeParam.shared.isDefaultExplicit) {
                    break;
                }

                typeParamCount--;
            }

            if (variadicIndex < typeArgs.length) {
                // If there are typeArg lists at the end, these should map to ParamSpecs rather
                // than the TypeVarTuple, so exclude them.
                let variadicEndIndex = variadicIndex + 1 + typeArgs.length - typeParamCount;
                while (variadicEndIndex > variadicIndex) {
                    if (!typeArgs[variadicEndIndex - 1].typeList) {
                        break;
                    }
                    variadicEndIndex--;
                }
                const variadicTypeResults = typeArgs.slice(variadicIndex, variadicEndIndex);

                // If the type args consist of a lone TypeVarTuple, don't wrap it in a tuple.
                if (variadicTypeResults.length === 1 && isTypeVarTuple(variadicTypeResults[0].type)) {
                    validateTypeVarTupleIsUnpacked(variadicTypeResults[0].type, variadicTypeResults[0].node);
                } else {
                    variadicTypeResults.forEach((arg, index) => {
                        validateTypeArg(arg, {
                            allowEmptyTuple: index === 0,
                            allowTypeVarTuple: true,
                            allowUnpackedTuples: true,
                        });
                    });

                    const variadicTypes: TupleTypeArg[] = [];
                    if (variadicTypeResults.length !== 1 || !variadicTypeResults[0].isEmptyTupleShorthand) {
                        variadicTypeResults.forEach((typeResult) => {
                            if (isUnpackedClass(typeResult.type) && typeResult.type.priv.tupleTypeArgs) {
                                appendArray(variadicTypes, typeResult.type.priv.tupleTypeArgs);
                            } else {
                                variadicTypes.push({
                                    type: convertToInstance(typeResult.type),
                                    isUnbounded: false,
                                });
                            }
                        });
                    }

                    const tupleObject = makeTupleObject(context, variadicTypes, /* isUnpacked */ true);

                    typeArgs = [
                        ...typeArgs.slice(0, variadicIndex),
                        { node: typeArgs[variadicIndex].node, type: tupleObject },
                        ...typeArgs.slice(variadicEndIndex, typeArgs.length),
                    ];
                }
            } else if (!variadicTypeVar.shared.isDefaultExplicit) {
                // Add an empty tuple that maps to the TypeVarTuple type parameter.
                typeArgs.push({
                    node: errorNode,
                    type: makeTupleObject(context, [], /* isUnpacked */ true),
                });
            }
        }

        return typeArgs;
    }

    function validateTypeVarTupleIsUnpacked(type: TypeVarTupleType, node: ParseNode) {
        if (!type.priv.isUnpacked) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.unpackedTypeVarTupleExpected().format({
                    name1: type.shared.name,
                    name2: type.shared.name,
                }),
                node
            );
            return false;
        }

        return true;
    }

    function validateTypeArg(argResult: TypeResultWithNode, options?: ValidateTypeArgsOptions): boolean {
        if (argResult.typeList) {
            if (!options?.allowTypeArgList) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeArgListNotAllowed(), argResult.node);
                return false;
            } else {
                argResult.typeList.forEach((typeArg) => {
                    validateTypeArg(typeArg);
                });
            }
        }

        if (isEllipsisType(argResult.type)) {
            if (!options?.allowTypeArgList) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.ellipsisContext(), argResult.node);
                return false;
            }
        }

        if (isModule(argResult.type)) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.moduleAsType(), argResult.node);
            return false;
        }

        if (isParamSpec(argResult.type)) {
            if (!options?.allowParamSpec) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.paramSpecContext(), argResult.node);
                return false;
            }
        }

        if (isTypeVarTuple(argResult.type) && !argResult.type.priv.isInUnion) {
            if (!options?.allowTypeVarTuple) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeVarTupleContext(), argResult.node);
                return false;
            } else {
                validateTypeVarTupleIsUnpacked(argResult.type, argResult.node);
            }
        }

        if (!options?.allowEmptyTuple && argResult.isEmptyTupleShorthand) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.zeroLengthTupleNotAllowed(), argResult.node);
            return false;
        }

        if (isUnpackedClass(argResult.type)) {
            if (!options?.allowUnpackedTuples) {
                addDiagnostic(
                    DiagnosticRule.reportInvalidTypeForm,
                    LocMessage.unpackedArgInTypeArgument(),
                    argResult.node
                );
                return false;
            }
        }

        return true;
    }

    function createCallableType(
        classType: ClassType,
        typeArgs: TypeResultWithNode[] | undefined,
        errorNode: ParseNode
    ): FunctionType {
        let functionType = FunctionType.createInstantiable(FunctionTypeFlags.None);
        let paramSpec: ParamSpecType | undefined;
        let isValidTypeForm = true;

        TypeBase.setSpecialForm(functionType, ClassType.cloneAsInstance(classType));
        functionType.shared.declaredReturnType = UnknownType.create();
        functionType.shared.typeVarScopeId = getScopeIdForNode(errorNode);

        if (typeArgs && typeArgs.length > 0) {
            functionType.priv.isCallableWithTypeArgs = true;

            if (typeArgs[0].typeList) {
                const typeList = typeArgs[0].typeList;
                let sawUnpacked = false;
                let reportedUnpackedError = false;
                const noteSawUnpacked = (entry: TypeResultWithNode) => {
                    // Make sure we have at most one unpacked TypeVarTuple.
                    if (sawUnpacked) {
                        if (!reportedUnpackedError) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.variadicTypeArgsTooMany(),
                                entry.node
                            );
                            reportedUnpackedError = true;
                            isValidTypeForm = false;
                        }
                    }
                    sawUnpacked = true;
                };

                typeList.forEach((entry, index) => {
                    let entryType = entry.type;
                    let paramCategory: ParamCategory = ParamCategory.Simple;
                    const paramName = `__p${index.toString()}`;

                    if (isTypeVarTuple(entryType)) {
                        validateTypeVarTupleIsUnpacked(entryType, entry.node);
                        paramCategory = ParamCategory.ArgsList;
                        noteSawUnpacked(entry);
                    } else if (validateTypeArg(entry, { allowUnpackedTuples: true })) {
                        if (isUnpackedClass(entryType)) {
                            paramCategory = ParamCategory.ArgsList;

                            if (
                                entryType.priv.tupleTypeArgs?.some(
                                    (typeArg) => isTypeVarTuple(typeArg.type) || typeArg.isUnbounded
                                )
                            ) {
                                noteSawUnpacked(entry);
                            }
                        } else if (isUnpackedTypeVar(entryType)) {
                            paramCategory = ParamCategory.ArgsList;
                            noteSawUnpacked(entry);
                        }
                    } else {
                        entryType = UnknownType.create();
                    }

                    FunctionType.addParam(
                        functionType,
                        FunctionParam.create(
                            paramCategory,
                            convertToInstance(entryType),
                            FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                            paramName
                        )
                    );
                });

                if (typeList.length > 0) {
                    FunctionType.addPositionOnlyParamSeparator(functionType);
                }
            } else if (isEllipsisType(typeArgs[0].type)) {
                FunctionType.addDefaultParams(functionType);
                functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
            } else if (isParamSpec(typeArgs[0].type)) {
                paramSpec = typeArgs[0].type;
            } else {
                if (isInstantiableClass(typeArgs[0].type) && ClassType.isBuiltIn(typeArgs[0].type, 'Concatenate')) {
                    const concatTypeArgs = typeArgs[0].type.priv.typeArgs;
                    if (concatTypeArgs && concatTypeArgs.length > 0) {
                        concatTypeArgs.forEach((typeArg, index) => {
                            if (index === concatTypeArgs.length - 1) {
                                FunctionType.addPositionOnlyParamSeparator(functionType);

                                if (isParamSpec(typeArg)) {
                                    paramSpec = typeArg;
                                } else if (isEllipsisType(typeArg)) {
                                    FunctionType.addDefaultParams(functionType);
                                    functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
                                }
                            } else {
                                FunctionType.addParam(
                                    functionType,
                                    FunctionParam.create(
                                        ParamCategory.Simple,
                                        typeArg,
                                        FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                                        `__p${index}`
                                    )
                                );
                            }
                        });
                    }
                } else {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.callableFirstArg(),
                        typeArgs[0].node
                    );
                    isValidTypeForm = false;
                }
            }

            if (typeArgs.length > 1) {
                let typeArg1Type = typeArgs[1].type;
                if (!validateTypeArg(typeArgs[1])) {
                    typeArg1Type = UnknownType.create();
                }
                functionType.shared.declaredReturnType = convertToInstance(typeArg1Type);
            } else {
                addDiagnostic(DiagnosticRule.reportMissingTypeArgument, LocMessage.callableSecondArg(), errorNode);

                functionType.shared.declaredReturnType = UnknownType.create();
                isValidTypeForm = false;
            }

            if (typeArgs.length > 2) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.callableExtraArgs(), typeArgs[2].node);
                isValidTypeForm = false;
            }
        } else {
            FunctionType.addDefaultParams(functionType, /* useUnknown */ true);
            functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;

            if (typeArgs && typeArgs.length === 0) {
                isValidTypeForm = false;
            }
        }

        if (paramSpec) {
            FunctionType.addParamSpecVariadics(functionType, convertToInstance(paramSpec));
        }

        if (isValidTypeForm) {
            functionType = TypeBase.cloneWithTypeForm(functionType, convertToInstance(functionType));
        }

        return functionType;
    }

    function createOptionalType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type {
        if (!typeArgs) {
            // If no type arguments are provided, the resulting type
            // depends on whether we're evaluating a type annotation or
            // we're in some other context.
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.optionalExtraArgs(), errorNode);
                return UnknownType.create();
            }

            return classType;
        }

        if (typeArgs.length !== 1) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.optionalExtraArgs(), errorNode);
            return UnknownType.create();
        }

        let typeArg0Type = typeArgs[0].type;
        if (!validateTypeArg(typeArgs[0])) {
            typeArg0Type = UnknownType.create();
        }

        let optionalType = combineTypes([typeArg0Type, context.prefetched?.noneTypeClass ?? UnknownType.create()]);
        if (context.prefetched?.unionTypeClass && isInstantiableClass(context.prefetched.unionTypeClass)) {
            optionalType = TypeBase.cloneAsSpecialForm(
                optionalType,
                ClassType.cloneAsInstance(context.prefetched.unionTypeClass)
            );
        }

        if (typeArg0Type.props?.typeForm) {
            const typeFormType = combineTypes([
                typeArg0Type.props.typeForm,
                convertToInstance(context.prefetched?.noneTypeClass ?? UnknownType.create()),
            ]);
            optionalType = TypeBase.cloneWithTypeForm(optionalType, typeFormType);
        }

        return optionalType;
    }

    function createClassVarType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type {
        if (flags & (EvalFlags.NoClassVar | EvalFlags.TypeFormArg)) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.classVarNotAllowed(), errorNode);
            return (flags & EvalFlags.TypeFormArg) !== 0 ? UnknownType.create() : AnyType.create();
        }

        if (!typeArgs) {
            return classType;
        } else if (typeArgs.length === 0) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.classVarFirstArgMissing(), errorNode);
            return UnknownType.create();
        } else if (typeArgs.length > 1) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.classVarTooManyArgs(), typeArgs[1].node);
            return UnknownType.create();
        }

        const type = typeArgs[0].type;

        // A ClassVar should not allow TypeVars or generic types parameterized
        // by TypeVars.
        if (requiresSpecialization(type, { ignorePseudoGeneric: true, ignoreSelf: true })) {
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.classVarWithTypeVar(),
                typeArgs[0].node ?? errorNode
            );
        }

        return type;
    }

    function createTypeFormType(
        classType: ClassType,
        errorNode: ExpressionNode,
        typeArgs: TypeResultWithNode[] | undefined
    ): Type {
        if (!typeArgs) {
            const specializedType = ClassType.specialize(classType, [AnyType.create()]);
            return TypeBase.cloneWithTypeForm(specializedType, ClassType.cloneAsInstance(specializedType));
        }

        if (typeArgs.length === 0) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typeArgsTooFew().format({
                    name: classType.priv.aliasName || classType.shared.name,
                    expected: 1,
                    received: 0,
                }),
                errorNode
            );
            return UnknownType.create();
        }

        if (typeArgs.length > 1) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.typeArgsTooMany().format({
                    name: classType.priv.aliasName || classType.shared.name,
                    expected: 1,
                    received: typeArgs.length,
                }),
                typeArgs[1].node
            );
            return UnknownType.create();
        }

        const convertedTypeArgs = typeArgs.map((typeArg) => {
            return convertToInstance(validateTypeArg(typeArg) ? typeArg.type : UnknownType.create());
        });
        let resultType = ClassType.specialize(classType, convertedTypeArgs);

        resultType = TypeBase.cloneWithTypeForm(resultType, convertToInstance(resultType));

        return resultType;
    }

    function createTypeGuardType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type {
        // If no type arguments are provided, the resulting type
        // depends on whether we're evaluating a type annotation or
        // we're in some other context.
        if (!typeArgs) {
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeGuardArgCount(), errorNode);
            }

            return (flags & EvalFlags.TypeFormArg) !== 0 ? UnknownType.create() : classType;
        } else if (typeArgs.length !== 1) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeGuardArgCount(), errorNode);
            return UnknownType.create();
        }

        const convertedTypeArgs = typeArgs.map((typeArg) => {
            return convertToInstance(validateTypeArg(typeArg) ? typeArg.type : UnknownType.create());
        });

        let resultType = ClassType.specialize(classType, convertedTypeArgs);

        resultType = TypeBase.cloneWithTypeForm(resultType, convertToInstance(resultType));

        return resultType;
    }

    function createRequiredOrReadOnlyType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): TypeResult {
        // If no type arguments are provided, the resulting type
        // depends on whether we're evaluating a type annotation or
        // we're in some other context.
        const typeExpressionFlags = EvalFlags.TypeExpression | EvalFlags.TypeFormArg;

        if (!typeArgs && (flags & typeExpressionFlags) === 0) {
            return { type: classType };
        }

        if (!typeArgs || typeArgs.length !== 1) {
            if ((flags & typeExpressionFlags) !== 0) {
                addDiagnostic(
                    DiagnosticRule.reportInvalidTypeForm,
                    classType.shared.name === 'ReadOnly'
                        ? LocMessage.readOnlyArgCount()
                        : classType.shared.name === 'Required'
                        ? LocMessage.requiredArgCount()
                        : LocMessage.notRequiredArgCount(),
                    errorNode
                );
            }

            return { type: (flags & EvalFlags.TypeFormArg) !== 0 ? UnknownType.create() : classType };
        }

        const typeArgType = typeArgs[0].type;

        // Make sure this is used only in a dataclass.
        const containingClassNode = ParseTreeUtils.getEnclosingClass(errorNode, /* stopAtFunction */ true);
        const classTypeInfo = containingClassNode ? getTypeOfClass(containingClassNode) : undefined;

        let isUsageLegal = false;

        if (
            classTypeInfo &&
            isInstantiableClass(classTypeInfo.classType) &&
            ClassType.isTypedDictClass(classTypeInfo.classType)
        ) {
            // The only legal usage is when used in a type annotation statement.
            if (ParseTreeUtils.isNodeContainedWithinNodeType(errorNode, ParseNodeType.TypeAnnotation)) {
                isUsageLegal = true;
            }
        }

        let isReadOnly = typeArgs[0].isReadOnly;
        let isRequired = typeArgs[0].isRequired;
        let isNotRequired = typeArgs[0].isNotRequired;

        if (classType.shared.name === 'ReadOnly') {
            if ((flags & EvalFlags.AllowReadOnly) !== 0) {
                isUsageLegal = true;
            }

            // Nested ReadOnly are not allowed.
            if (typeArgs[0].isReadOnly) {
                isUsageLegal = false;
            }

            isReadOnly = true;
        } else {
            if ((flags & EvalFlags.AllowRequired) !== 0) {
                isUsageLegal = true;
            }

            // Nested Required/NotRequired are not allowed.
            if (typeArgs[0].isRequired || typeArgs[0].isNotRequired) {
                isUsageLegal = false;
            }

            isRequired = classType.shared.name === 'Required';
            isNotRequired = classType.shared.name === 'NotRequired';
        }

        if (!isUsageLegal) {
            if ((flags & typeExpressionFlags) !== 0) {
                addDiagnostic(
                    DiagnosticRule.reportInvalidTypeForm,
                    classType.shared.name === 'ReadOnly'
                        ? LocMessage.readOnlyNotInTypedDict()
                        : classType.shared.name === 'Required'
                        ? LocMessage.requiredNotInTypedDict()
                        : LocMessage.notRequiredNotInTypedDict(),
                    errorNode
                );
            }

            return { type: (flags & EvalFlags.TypeFormArg) !== 0 ? UnknownType.create() : classType };
        }

        return { type: typeArgType, isReadOnly, isRequired, isNotRequired };
    }

    function createUnpackType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.unpackArgCount(), errorNode);
            }
            return (flags & EvalFlags.TypeFormArg) !== 0 ? UnknownType.create() : classType;
        }

        const typeArgType = typeArgs[0].type;

        if ((flags & EvalFlags.AllowUnpackedTuple) !== 0) {
            const unpackedType = applyUnpackToTupleLike(typeArgType);
            if (unpackedType) {
                return unpackedType;
            }

            if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) === 0) {
                return classType;
            }
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.unpackExpectedTypeVarTuple(), errorNode);
            return UnknownType.create();
        }

        if ((flags & EvalFlags.AllowUnpackedTypedDict) !== 0) {
            if (isInstantiableClass(typeArgType) && ClassType.isTypedDictClass(typeArgType)) {
                return ClassType.cloneForUnpacked(typeArgType);
            }

            if ((flags & EvalFlags.TypeExpression) === 0) {
                return classType;
            }
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.unpackExpectedTypedDict(), errorNode);
            return UnknownType.create();
        }

        if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) === 0) {
            return classType;
        }
        if ((flags & EvalFlags.TypeFormArg) !== 0) {
            if (isUnknown(typeArgType)) {
                return typeArgType;
            }
            if (isTypeVar(typeArgType) && !typeArgType.priv.scopeId) {
                return UnknownType.create();
            }
        }
        addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.unpackNotAllowed(), errorNode);
        return UnknownType.create();
    }

    function createFinalType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type {
        if (flags & (EvalFlags.NoFinal | EvalFlags.TypeFormArg)) {
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.finalContext(), errorNode);
            }
            return (flags & EvalFlags.TypeFormArg) !== 0 ? UnknownType.create() : classType;
        }

        if ((flags & EvalFlags.TypeExpression) === 0 || !typeArgs || typeArgs.length === 0) {
            return classType;
        }

        if (typeArgs.length > 1) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.finalTooManyArgs(), errorNode);
        }

        return TypeBase.cloneAsSpecialForm(typeArgs[0].type, classType);
    }

    function createConcatenateType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type {
        if ((flags & EvalFlags.AllowConcatenate) === 0) {
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.concatenateContext(), errorNode);
            }
            return (flags & EvalFlags.TypeFormArg) !== 0 ? UnknownType.create() : classType;
        }

        if (!typeArgs || typeArgs.length === 0) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.concatenateTypeArgsMissing(), errorNode);
        } else {
            typeArgs.forEach((typeArg, index) => {
                if (index === typeArgs.length - 1) {
                    if (!isParamSpec(typeArg.type) && !isEllipsisType(typeArg.type)) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.concatenateParamSpecMissing(),
                            typeArg.node
                        );
                    }
                } else {
                    if (isParamSpec(typeArg.type)) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.paramSpecContext(),
                            typeArg.node
                        );
                    } else if (isUnpackedTypeVarTuple(typeArg.type)) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.typeVarTupleContext(),
                            typeArg.node
                        );
                    } else if (isUnpackedClass(typeArg.type)) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.unpackedArgInTypeArgument(),
                            typeArg.node
                        );
                    }
                }
            });
        }

        return createSpecialType(classType, typeArgs, /* paramLimit */ undefined, /* allowParamSpec */ true);
    }

    function createAnnotatedType(
        classType: ClassType,
        errorNode: ExpressionNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): TypeResult {
        let type: Type | undefined;

        const typeExprFlags = EvalFlags.TypeExpression | EvalFlags.NoConvertSpecialForm;
        if ((flags & typeExprFlags) === 0) {
            type = ClassType.cloneAsInstance(classType);

            if (typeArgs && typeArgs.length >= 1 && typeArgs[0].type.props?.typeForm) {
                type = TypeBase.cloneWithTypeForm(type, typeArgs[0].type.props.typeForm);
            }

            return { type };
        }

        if (typeArgs && typeArgs.length > 0) {
            type = typeArgs[0].type;

            if (typeArgs.length < 2) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.annotatedTypeArgMissing(), errorNode);
            } else {
                type = validateAnnotatedMetadata(errorNode, typeArgs[0].type, typeArgs.slice(1));
            }
        }

        if (!type || !typeArgs || typeArgs.length === 0) {
            return { type: AnyType.create() };
        }

        if (typeArgs[0].typeList) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeArgListNotAllowed(), typeArgs[0].node);
        }

        return {
            type: TypeBase.cloneAsSpecialForm(type, ClassType.cloneAsInstance(classType)),
            isReadOnly: typeArgs[0].isReadOnly,
            isRequired: typeArgs[0].isRequired,
            isNotRequired: typeArgs[0].isNotRequired,
        };
    }

    function validateAnnotatedMetadata(
        errorNode: ExpressionNode,
        baseType: Type,
        metaArgs: TypeResultWithNode[]
    ): Type {
        for (const metaArg of metaArgs) {
            validateTypeMetadata(errorNode, baseType, metaArg);
        }

        return baseType;
    }

    function createSpecialType(
        classType: ClassType,
        typeArgs: TypeResultWithNode[] | undefined,
        paramLimit?: number,
        allowParamSpec = false,
        isSpecialForm = true
    ): Type {
        const isTupleTypeParam = ClassType.isTupleClass(classType);

        if (typeArgs) {
            if (isTupleTypeParam && typeArgs.length === 1 && typeArgs[0].isEmptyTupleShorthand) {
                typeArgs = [];
            } else {
                let sawUnpacked = false;
                const noteSawUnpacked = (typeArg: TypeResultWithNode) => {
                    if (sawUnpacked) {
                        if (!reportedUnpackedError) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.variadicTypeArgsTooMany(),
                                typeArg.node
                            );
                            reportedUnpackedError = true;
                        }
                    }
                    sawUnpacked = true;
                };
                let reportedUnpackedError = false;

                // Verify that we didn't receive any inappropriate types.
                typeArgs.forEach((typeArg, index) => {
                    assert(typeArgs !== undefined);
                    if (isEllipsisType(typeArg.type)) {
                        if (!isTupleTypeParam) {
                            if (!allowParamSpec) {
                                addDiagnostic(
                                    DiagnosticRule.reportInvalidTypeForm,
                                    LocMessage.ellipsisContext(),
                                    typeArg.node
                                );
                            }
                        } else if (typeArgs.length !== 2 || index !== 1) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.ellipsisSecondArg(),
                                typeArg.node
                            );
                        } else {
                            if (isTypeVarTuple(typeArgs[0].type) && !typeArgs[0].type.priv.isInUnion) {
                                addDiagnostic(
                                    DiagnosticRule.reportInvalidTypeForm,
                                    LocMessage.typeVarTupleContext(),
                                    typeArgs[0].node
                                );
                            } else if (isUnpackedClass(typeArgs[0].type) || isUnpackedTypeVar(typeArgs[0].type)) {
                                addDiagnostic(
                                    DiagnosticRule.reportInvalidTypeForm,
                                    LocMessage.ellipsisAfterUnpacked(),
                                    typeArg.node
                                );
                            }
                        }
                    } else if (isParamSpec(typeArg.type) && allowParamSpec) {
                        // Nothing to do - this is allowed.
                    } else if (paramLimit === undefined && isTypeVarTuple(typeArg.type)) {
                        if (!typeArg.type.priv.isInUnion) {
                            noteSawUnpacked(typeArg);
                        }
                        validateTypeVarTupleIsUnpacked(typeArg.type, typeArg.node);
                    } else if (paramLimit === undefined && isUnpackedTypeVar(typeArg.type)) {
                        noteSawUnpacked(typeArg);
                    } else if (paramLimit === undefined && isUnpackedClass(typeArg.type)) {
                        if (isUnboundedTupleClass(typeArg.type)) {
                            noteSawUnpacked(typeArg);
                        }
                        validateTypeArg(typeArg, { allowUnpackedTuples: true });
                    } else {
                        validateTypeArg(typeArg);
                    }
                });
            }
        }

        let typeArgTypes = typeArgs ? typeArgs.map((t) => convertToInstance(t.type)) : [];

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined) {
            if (typeArgs && typeArgTypes.length > paramLimit) {
                addDiagnostic(
                    DiagnosticRule.reportInvalidTypeForm,
                    LocMessage.typeArgsTooMany().format({
                        name: classType.priv.aliasName || classType.shared.name,
                        expected: paramLimit,
                        received: typeArgTypes.length,
                    }),
                    typeArgs[paramLimit].node
                );
                typeArgTypes = typeArgTypes.slice(0, paramLimit);
            } else if (typeArgTypes.length < paramLimit) {
                // Fill up the remainder of the slots with unknown types.
                while (typeArgTypes.length < paramLimit) {
                    typeArgTypes.push(UnknownType.create());
                }
            }
        }

        // Handle tuple type params as a special case.
        let returnType: Type;
        if (isTupleTypeParam) {
            const tupleTypeArgTypes: TupleTypeArg[] = [];

            // If no type args are provided and it's a tuple, default to [Unknown, ...].
            if (!typeArgs) {
                tupleTypeArgTypes.push({ type: UnknownType.create(), isUnbounded: true });
            } else {
                typeArgs.forEach((typeArg, index) => {
                    if (index === 1 && isEllipsisType(typeArgTypes[index])) {
                        if (tupleTypeArgTypes.length === 1 && !tupleTypeArgTypes[0].isUnbounded) {
                            tupleTypeArgTypes[0] = { type: tupleTypeArgTypes[0].type, isUnbounded: true };
                        }
                    } else if (isUnpackedClass(typeArg.type) && typeArg.type.priv.tupleTypeArgs) {
                        appendArray(tupleTypeArgTypes, typeArg.type.priv.tupleTypeArgs);
                    } else {
                        tupleTypeArgTypes.push({ type: typeArgTypes[index], isUnbounded: false });
                    }
                });
            }

            returnType = specializeTupleClass(classType, tupleTypeArgTypes, typeArgs !== undefined);
        } else {
            returnType = ClassType.specialize(classType, typeArgTypes, typeArgs !== undefined);
        }

        if (isSpecialForm) {
            returnType = TypeBase.cloneAsSpecialForm(returnType, classType);
        }

        return returnType;
    }

    function createUnionType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type {
        const fileInfo = nodeInfo.getFileInfo(errorNode);
        const types: Type[] = [];
        let allowSingleTypeArg = false;
        let isValidTypeForm = true;

        if (!typeArgs) {
            // If no type arguments are provided, the resulting type
            // depends on whether we're evaluating a type annotation or
            // we're in some other context.
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.unionTypeArgCount(), errorNode);
                return NeverType.createNever();
            }

            return classType;
        }

        for (const typeArg of typeArgs) {
            let typeArgType = typeArg.type;

            // This is an experimental feature because Unions of unpacked TypeVarTuples are not officially supported.
            if (
                !validateTypeArg(typeArg, {
                    allowTypeVarTuple: fileInfo.diagnosticRuleSet.enableExperimentalFeatures,
                })
            ) {
                typeArgType = UnknownType.create();
            }

            if (isTypeVar(typeArgType) && isUnpackedTypeVarTuple(typeArgType)) {
                // This is an experimental feature because Unions of unpacked TypeVarTuples are not officially supported.
                if (fileInfo.diagnosticRuleSet.enableExperimentalFeatures) {
                    // If this is an unpacked TypeVar, note that it is in a union so we can
                    // differentiate between Unpack[Vs] and Union[Unpack[Vs]].
                    typeArgType = TypeVarType.cloneForUnpacked(typeArgType, /* isInUnion */ true);
                    allowSingleTypeArg = true;
                } else {
                    addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.unionUnpackedTypeVarTuple(),
                        errorNode
                    );

                    typeArgType = UnknownType.create();
                    isValidTypeForm = false;
                }
            }

            types.push(typeArgType);
        }

        // Validate that we received at least two type arguments. One type argument
        // is allowed if it's an unpacked TypeVarTuple or tuple. None is also allowed
        // since it is used to define NoReturn in typeshed stubs). No type arguments,
        // as in "Union[()]", is a runtime error.
        if (types.length === 0 || (types.length === 1 && !allowSingleTypeArg && !isNoneInstance(types[0]))) {
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeArguments, LocMessage.unionTypeArgCount(), errorNode);
            }
            isValidTypeForm = false;
        }

        let unionType = combineTypes(types, { skipElideRedundantLiterals: true });
        if (context.prefetched?.unionTypeClass && isInstantiableClass(context.prefetched.unionTypeClass)) {
            unionType = TypeBase.cloneAsSpecialForm(
                unionType,
                ClassType.cloneAsInstance(context.prefetched.unionTypeClass)
            );
        }

        if (!isValidTypeForm || types.some((t) => !t.props?.typeForm)) {
            if (unionType.props?.typeForm) {
                unionType = TypeBase.cloneWithTypeForm(unionType, undefined);
            }
        } else {
            const typeFormType = combineTypes(types.map((t) => t.props!.typeForm!));
            unionType = TypeBase.cloneWithTypeForm(unionType, typeFormType);
        }

        return unionType;
    }

    function createGenericType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type {
        if (!typeArgs) {
            // If no type arguments are provided, the resulting type
            // depends on whether we're evaluating a type annotation or
            // we're in some other context.
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.NoNakedGeneric | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.genericTypeArgMissing(), errorNode);
            }

            return (flags & EvalFlags.TypeFormArg) !== 0 ? UnknownType.create() : classType;
        }

        if ((flags & EvalFlags.TypeFormArg) !== 0) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.genericNotAllowed(), errorNode);
            return UnknownType.create();
        }

        const uniqueTypeVars: TypeVarType[] = [];
        if (typeArgs) {
            // Make sure there's at least one type arg.
            if (typeArgs.length === 0) {
                addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.genericTypeArgMissing(), errorNode);
            }

            // Make sure that all of the type args are typeVars and are unique.
            typeArgs.forEach((typeArg) => {
                if (!isTypeVar(typeArg.type)) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.genericTypeArgTypeVar(),
                        typeArg.node
                    );
                } else {
                    if (uniqueTypeVars.some((t) => isTypeSame(t, typeArg.type))) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.genericTypeArgUnique(),
                            typeArg.node
                        );
                    }

                    uniqueTypeVars.push(typeArg.type);
                }
            });
        }

        return createSpecialType(classType, typeArgs, /* paramLimit */ undefined, /* allowParamSpec */ true);
    }

    function transformTypeForTypeAlias(
        type: Type,
        errorNode: ExpressionNode,
        typeAliasPlaceholder: TypeVarType,
        isPep695TypeVarType: boolean,
        typeParamNodes?: TypeParameterNode[]
    ): Type {
        // If this is a recursive type alias that hasn't yet been fully resolved
        // (i.e. there is no boundType associated with it), don't apply the transform.
        if (isTypeAliasPlaceholder(type)) {
            return type;
        }

        const sharedInfo = typeAliasPlaceholder.shared.recursiveAlias;
        assert(sharedInfo !== undefined);

        let typeParams: TypeVarType[] | undefined = sharedInfo.typeParams;
        if (!typeParams) {
            // Determine if there are any generic type parameters associated
            // with this type alias.
            typeParams = [];

            addTypeVarsToListIfUnique(typeParams, getTypeVarArgsRecursive(type));

            // Don't include any synthesized type variables.
            typeParams = typeParams.filter((typeVar) => !typeVar.shared.isSynthesized);
        }

        // Convert all type variables to instances.
        typeParams = typeParams.map((typeVar) => {
            if (TypeBase.isInstance(typeVar)) {
                return typeVar;
            }
            return convertToInstance(typeVar);
        });

        // See if the type alias includes a TypeVarTuple followed by a TypeVar
        // with a default value. This isn't allowed.
        const firstTypeVarTupleIndex = typeParams.findIndex((typeVar) => isTypeVarTuple(typeVar));
        if (firstTypeVarTupleIndex >= 0) {
            const typeVarWithDefaultIndex = typeParams.findIndex(
                (typeVar, index) =>
                    index > firstTypeVarTupleIndex && !isParamSpec(typeVar) && typeVar.shared.isDefaultExplicit
            );

            if (typeVarWithDefaultIndex >= 0) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeVarWithDefaultFollowsVariadic().format({
                        typeVarName: typeParams[typeVarWithDefaultIndex].shared.name,
                        variadicName: typeParams[firstTypeVarTupleIndex].shared.name,
                    }),
                    typeParamNodes ? typeParamNodes[typeVarWithDefaultIndex].d.name : errorNode
                );
            }
        }

        // Validate the default types for all type parameters.
        typeParams.forEach((typeParam, index) => {
            assert(typeParams !== undefined);
            let bestErrorNode = errorNode;
            if (typeParamNodes && index < typeParamNodes.length) {
                bestErrorNode = typeParamNodes[index].d.defaultExpr ?? typeParamNodes[index].d.name;
            }
            validateTypeParamDefault(bestErrorNode, typeParam, typeParams.slice(0, index), sharedInfo.typeVarScopeId);
        });

        // Verify that we have at most one TypeVarTuple.
        const variadics = typeParams.filter((param) => isTypeVarTuple(param));
        if (variadics.length > 1) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.variadicTypeParamTooManyAlias().format({
                    names: variadics.map((v) => `"${v.shared.name}"`).join(', '),
                }),
                errorNode
            );
        }

        if (!sharedInfo.isTypeAliasType && !isPep695TypeVarType) {
            const boundTypeVars = typeParams.filter(
                (typeVar) =>
                    typeVar.priv.scopeId !== sharedInfo.typeVarScopeId &&
                    typeVar.priv.scopeType === TypeVarScopeType.Class
            );

            if (boundTypeVars.length > 0) {
                addDiagnostic(
                    DiagnosticRule.reportInvalidTypeForm,
                    LocMessage.genericTypeAliasBoundTypeVar().format({
                        names: boundTypeVars.map((t) => `${t.shared.name}`).join(', '),
                    }),
                    errorNode
                );
            }
        }

        if (!TypeBase.isInstantiable(type)) {
            return type;
        }

        sharedInfo.typeParams = typeParams.length > 0 ? typeParams : undefined;

        let typeAlias = TypeBase.cloneForTypeAlias(type, {
            shared: sharedInfo,
            typeArgs: undefined,
        });

        // All PEP 695 type aliases are special forms because they are
        // TypeAliasType objects at runtime.
        if (sharedInfo.isTypeAliasType || isPep695TypeVarType) {
            const typeAliasTypeClass = getTypingType(errorNode, 'TypeAliasType');
            if (typeAliasTypeClass && isInstantiableClass(typeAliasTypeClass)) {
                typeAlias = TypeBase.cloneAsSpecialForm(typeAlias, ClassType.cloneAsInstance(typeAliasTypeClass));
            }
        }

        // Delete the TypeForm info. The type alias serves as its own TypeForm info.
        if (typeAlias.props?.typeForm) {
            typeAlias = TypeBase.cloneWithTypeForm(typeAlias, undefined);
        }

        return typeAlias;
    }

    function validateTypeParamDefault(
        errorNode: ExpressionNode,
        typeParam: TypeVarType,
        otherLiveTypeParams: TypeVarType[],
        scopeId: TypeVarScopeId
    ) {
        if (!typeParam.shared.isDefaultExplicit && !typeParam.shared.isSynthesized && !TypeVarType.isSelf(typeParam)) {
            const typeVarWithDefault = otherLiveTypeParams.find(
                (param) => param.shared.isDefaultExplicit && param.priv.scopeId === scopeId
            );

            if (typeVarWithDefault) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.typeVarWithoutDefault().format({
                        name: typeParam.shared.name,
                        other: typeVarWithDefault.shared.name,
                    }),
                    errorNode
                );
            }
            return;
        }

        const invalidTypeVars = new Set<string>();
        validateTypeVarDefault(typeParam, otherLiveTypeParams, invalidTypeVars);

        // If we found one or more unapplied type variable, report an error.
        if (invalidTypeVars.size > 0) {
            const diag = new DiagnosticAddendum();
            invalidTypeVars.forEach((name) => {
                diag.addMessage(LocAddendum.typeVarDefaultOutOfScope().format({ name }));
            });

            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeVarDefaultInvalidTypeVar().format({
                    name: typeParam.shared.name,
                }) + diag.getString(),
                errorNode
            );
        }
    }

    function verifyGenericTypeParams(
        errorNode: ExpressionNode,
        typeVars: TypeVarType[],
        genericTypeVars: TypeVarType[]
    ) {
        const missingFromGeneric = typeVars.filter((typeVar) => {
            return !genericTypeVars.some((genericTypeVar) => genericTypeVar.shared.name === typeVar.shared.name);
        });

        if (missingFromGeneric.length > 0) {
            const diag = new DiagnosticAddendum();
            diag.addMessage(
                LocAddendum.typeVarsMissing().format({
                    names: missingFromGeneric.map((typeVar) => `"${typeVar.shared.name}"`).join(', '),
                })
            );
            addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.typeVarsNotInGenericOrProtocol() + diag.getString(),
                errorNode
            );
        }
    }

    function transformTypeArgsForParamSpec(
        typeParams: TypeVarType[],
        typeArgs: TypeResultWithNode[] | undefined,
        errorNode: ExpressionNode
    ): TypeResultWithNode[] | undefined {
        if (typeParams.length !== 1 || !isParamSpec(typeParams[0]) || !typeArgs) {
            return typeArgs;
        }

        if (typeArgs.length > 1) {
            for (const typeArg of typeArgs) {
                if (isParamSpec(typeArg.type)) {
                    addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.paramSpecContext(), typeArg.node);
                    return undefined;
                }

                if (isEllipsisType(typeArg.type)) {
                    addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.ellipsisContext(), typeArg.node);
                    return undefined;
                }

                if (isInstantiableClass(typeArg.type) && ClassType.isBuiltIn(typeArg.type, 'Concatenate')) {
                    addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.concatenateContext(), typeArg.node);
                    return undefined;
                }

                if (typeArg.typeList) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.typeArgListNotAllowed(),
                        typeArg.node
                    );
                    return undefined;
                }
            }
        }

        if (typeArgs.length === 1) {
            // Don't transform a type list.
            if (typeArgs[0].typeList) {
                return typeArgs;
            }

            const typeArgType = typeArgs[0].type;

            // Don't transform a single ParamSpec or ellipsis.
            if (isParamSpec(typeArgType) || isEllipsisType(typeArgType)) {
                return typeArgs;
            }

            // Don't transform a Concatenate.
            if (isInstantiableClass(typeArgType) && ClassType.isBuiltIn(typeArgType, 'Concatenate')) {
                return typeArgs;
            }
        }

        // Package up the type arguments into a type list.
        return [
            {
                type: UnknownType.create(),
                node: typeArgs.length > 0 ? typeArgs[0].node : errorNode,
                typeList: typeArgs,
            },
        ];
    }

    function createSpecializedClassType(
        classType: ClassType,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags,
        errorNode: ExpressionNode
    ): TypeResult {
        let isValidTypeForm = true;

        // Handle the special-case classes that are not defined
        // in the type stubs.
        if (ClassType.isSpecialBuiltIn(classType)) {
            const aliasedName = classType.priv.aliasName || classType.shared.name;
            switch (aliasedName) {
                case 'Callable': {
                    return { type: createCallableType(classType, typeArgs, errorNode) };
                }

                case 'Never':
                case 'NoReturn': {
                    if (typeArgs && typeArgs.length > 0) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.typeArgsExpectingNone().format({ name: aliasedName }),
                            typeArgs[0].node
                        );
                    }

                    let resultType = aliasedName === 'Never' ? NeverType.createNever() : NeverType.createNoReturn();
                    resultType = TypeBase.cloneAsSpecialForm(resultType, classType);
                    resultType = TypeBase.cloneWithTypeForm(resultType, convertToInstance(resultType));

                    return { type: resultType };
                }

                case 'Optional': {
                    return { type: createOptionalType(classType, errorNode, typeArgs, flags) };
                }

                case 'Type': {
                    let typeType = createSpecialType(
                        classType,
                        typeArgs,
                        1,
                        /* allowParamSpec */ undefined,
                        /* isSpecialForm */ false
                    );

                    if (isInstantiableClass(typeType)) {
                        typeType = explodeGenericClass(typeType);
                    }

                    typeType = TypeBase.cloneWithTypeForm(typeType, convertToInstance(typeType));

                    return { type: typeType };
                }

                case 'ClassVar': {
                    return { type: createClassVarType(classType, errorNode, typeArgs, flags) };
                }

                case 'Protocol': {
                    if (
                        (flags &
                            (EvalFlags.NoNonTypeSpecialForms | EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !==
                        0
                    ) {
                        addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.protocolNotAllowed(), errorNode);
                    }

                    typeArgs?.forEach((typeArg) => {
                        if (typeArg.typeList || !isTypeVar(typeArg.type)) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.protocolTypeArgMustBeTypeParam(),
                                typeArg.node
                            );
                        }
                    });

                    return {
                        type: createSpecialType(
                            classType,
                            typeArgs,
                            /* paramLimit */ undefined,
                            /* allowParamSpec */ true
                        ),
                    };
                }

                case 'TypedDict': {
                    if (
                        (flags &
                            (EvalFlags.NoNonTypeSpecialForms | EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !==
                        0
                    ) {
                        const isInlinedTypedDict =
                            nodeInfo.getFileInfo(errorNode).diagnosticRuleSet.enableExperimentalFeatures && !!typeArgs;

                        if (!isInlinedTypedDict) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.typedDictNotAllowed(),
                                errorNode
                            );
                        }
                    }
                    isValidTypeForm = false;
                    break;
                }

                case 'Literal': {
                    if (
                        (flags &
                            (EvalFlags.NoNonTypeSpecialForms | EvalFlags.TypeExpression | EvalFlags.TypeFormArg)) !==
                        0
                    ) {
                        addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.literalNotAllowed(), errorNode);
                    }
                    isValidTypeForm = false;
                    break;
                }

                case 'TypeAlias': {
                    if ((flags & EvalFlags.TypeFormArg) !== 0) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.typeAnnotationVariable(),
                            errorNode
                        );
                    }
                    isValidTypeForm = false;
                    break;
                }

                case 'Tuple': {
                    return {
                        type: createSpecialType(
                            classType,
                            typeArgs,
                            /* paramLimit */ undefined,
                            /* allowParamSpec */ false,
                            /* isSpecialForm */ false
                        ),
                    };
                }

                case 'Union': {
                    return { type: createUnionType(classType, errorNode, typeArgs, flags) };
                }

                case 'Generic': {
                    return { type: createGenericType(classType, errorNode, typeArgs, flags) };
                }

                case 'Final': {
                    return { type: createFinalType(classType, errorNode, typeArgs, flags) };
                }

                case 'Annotated': {
                    return createAnnotatedType(classType, errorNode, typeArgs, flags);
                }

                case 'Concatenate': {
                    return { type: createConcatenateType(classType, errorNode, typeArgs, flags) };
                }

                case 'TypeGuard':
                case 'TypeIs': {
                    return { type: createTypeGuardType(classType, errorNode, typeArgs, flags) };
                }

                case 'Unpack': {
                    return { type: createUnpackType(classType, errorNode, typeArgs, flags) };
                }

                case 'Required':
                case 'NotRequired': {
                    return createRequiredOrReadOnlyType(classType, errorNode, typeArgs, flags);
                }

                case 'ReadOnly': {
                    return createRequiredOrReadOnlyType(classType, errorNode, typeArgs, flags);
                }

                case 'Self': {
                    return { type: createSelfType(classType, errorNode, typeArgs, flags) };
                }

                case 'LiteralString': {
                    return { type: createSpecialType(classType, typeArgs, 0) };
                }

                case 'TypeForm': {
                    return { type: createTypeFormType(classType, errorNode, typeArgs) };
                }
            }
        }

        const fileInfo = nodeInfo.getFileInfo(errorNode);
        if (
            fileInfo.isStubFile ||
            PythonVersion.isGreaterOrEqualTo(fileInfo.executionEnvironment.pythonVersion, pythonVersion3_9) ||
            isAnnotationEvaluationPostponed(nodeInfo.getFileInfo(errorNode)) ||
            (flags & EvalFlags.ForwardRefs) !== 0
        ) {
            // Handle "type" specially, since it needs to act like "Type"
            // in Python 3.9 and newer.
            if (ClassType.isBuiltIn(classType, 'type') && typeArgs) {
                if (typeArgs.length >= 1) {
                    // Treat type[function] as illegal.
                    if (isFunctionOrOverloaded(typeArgs[0].type)) {
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeForm,
                            LocMessage.typeAnnotationWithCallable(),
                            typeArgs[0].node
                        );

                        return { type: UnknownType.create() };
                    }
                }

                if (context.prefetched?.typeClass && isInstantiableClass(context.prefetched.typeClass)) {
                    let typeType = createSpecialType(
                        context.prefetched.typeClass,
                        typeArgs,
                        1,
                        /* allowParamSpec */ undefined,
                        /* isSpecialForm */ false
                    );

                    if (isInstantiableClass(typeType)) {
                        typeType = explodeGenericClass(typeType);
                    }

                    typeType = TypeBase.cloneWithTypeForm(typeType, convertToInstance(typeType));

                    return { type: typeType };
                }
            }

            // Handle "tuple" specially, since it needs to act like "Tuple"
            // in Python 3.9 and newer.
            if (isTupleClass(classType)) {
                let specializedClass = createSpecialType(
                    classType,
                    typeArgs,
                    /* paramLimit */ undefined,
                    /* allowParamSpec */ undefined,
                    /* isSpecialForm */ false
                );

                specializedClass = TypeBase.cloneWithTypeForm(specializedClass, convertToInstance(specializedClass));

                return { type: specializedClass };
            }
        }

        let typeArgCount = typeArgs ? typeArgs.length : 0;

        // Make sure the argument list count is correct.
        const typeParams = ClassType.isPseudoGenericClass(classType) ? [] : ClassType.getTypeParams(classType);

        // If there are no type parameters or args, the class is already specialized.
        // No need to do any more work.
        if (typeParams.length === 0 && typeArgCount === 0) {
            return { type: classType };
        }

        const variadicTypeParamIndex = typeParams.findIndex((param) => isTypeVarTuple(param));

        if (typeArgs) {
            let minTypeArgCount = typeParams.length;
            const firstDefaultParamIndex = typeParams.findIndex((param) => !!param.shared.isDefaultExplicit);

            if (firstDefaultParamIndex >= 0) {
                minTypeArgCount = firstDefaultParamIndex;
            }

            // Classes that accept inlined type dict type args allow only one.
            if (typeArgs.length > 0 && typeArgs[0].inlinedTypeDict) {
                if (typeArgs.length > 1) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeArguments,
                        LocMessage.typeArgsTooMany().format({
                            name: classType.priv.aliasName || classType.shared.name,
                            expected: 1,
                            received: typeArgCount,
                        }),
                        typeArgs[1].node
                    );
                }

                let inlinedTypeDict: Type = typeArgs[0].inlinedTypeDict;
                if ((flags & EvalFlags.TypeFormArg) !== 0) {
                    inlinedTypeDict = TypeBase.cloneWithTypeForm(inlinedTypeDict, convertToInstance(inlinedTypeDict));
                }

                return { type: inlinedTypeDict };
            } else if (typeArgCount > typeParams.length) {
                if (!ClassType.isPartiallyEvaluated(classType) && !ClassType.isTupleClass(classType)) {
                    if (typeParams.length === 0) {
                        isValidTypeForm = false;
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeArguments,
                            LocMessage.typeArgsExpectingNone().format({
                                name: classType.priv.aliasName || classType.shared.name,
                            }),
                            typeArgs[typeParams.length].node
                        );
                    } else if (typeParams.length !== 1 || !isParamSpec(typeParams[0])) {
                        isValidTypeForm = false;
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeArguments,
                            LocMessage.typeArgsTooMany().format({
                                name: classType.priv.aliasName || classType.shared.name,
                                expected: typeParams.length,
                                received: typeArgCount,
                            }),
                            typeArgs[typeParams.length].node
                        );
                    }

                    typeArgCount = typeParams.length;
                }
            } else if (typeArgCount < minTypeArgCount) {
                isValidTypeForm = false;
                addDiagnostic(
                    DiagnosticRule.reportInvalidTypeArguments,
                    LocMessage.typeArgsTooFew().format({
                        name: classType.priv.aliasName || classType.shared.name,
                        expected: minTypeArgCount,
                        received: typeArgCount,
                    }),
                    typeArgs.length > 0 ? typeArgs[0].node.parent! : errorNode
                );
            }

            typeArgs.forEach((typeArg, index) => {
                if (!typeArg.type.props?.typeForm) {
                    isValidTypeForm = false;
                }

                if (index === variadicTypeParamIndex) {
                    // The types that make up the tuple that maps to the
                    // TypeVarTuple have already been validated when the tuple
                    // object was created in adjustTypeArgsForTypeVarTuple.
                    if (isClassInstance(typeArg.type) && isTupleClass(typeArg.type)) {
                        return;
                    }

                    if (isTypeVarTuple(typeArg.type)) {
                        if (!validateTypeVarTupleIsUnpacked(typeArg.type, typeArg.node)) {
                            isValidTypeForm = false;
                        }
                        return;
                    }
                }

                const typeParam = index < typeParams.length ? typeParams[index] : undefined;
                const isParamSpecTarget = typeParam && isParamSpec(typeParam);

                if (
                    !validateTypeArg(typeArg, {
                        allowParamSpec: true,
                        allowTypeArgList: isParamSpecTarget,
                    })
                ) {
                    isValidTypeForm = false;
                }
            });
        }

        // Handle ParamSpec arguments and fill in any missing type arguments with Unknown.
        const fullTypeParams = ClassType.getTypeParams(classType);

        typeArgs = transformTypeArgsForParamSpec(fullTypeParams, typeArgs, errorNode);
        if (!typeArgs) {
            isValidTypeForm = false;
        }

        let typeArgTypes = resolveClassTypeArguments(classType, fullTypeParams, typeArgs, flags);

        typeArgTypes = typeArgTypes.map((typeArgType, index) => {
            if (index < typeArgCount) {
                const diag = new DiagnosticAddendum();
                let adjustedTypeArgType = applyTypeArgToTypeVar(typeParams[index], typeArgType, diag);

                // Determine if the variance must match.
                if (adjustedTypeArgType && (flags & EvalFlags.EnforceVarianceConsistency) !== 0) {
                    const destType = typeParams[index];
                    const declaredVariance = destType.shared.declaredVariance;

                    if (!isVarianceOfTypeArgCompatible(adjustedTypeArgType, declaredVariance)) {
                        diag.addMessage(
                            LocAddendum.varianceMismatchForClass().format({
                                typeVarName: printType(adjustedTypeArgType),
                                className: classType.shared.name,
                            })
                        );
                        adjustedTypeArgType = undefined;
                    }
                }

                if (adjustedTypeArgType) {
                    typeArgType = adjustedTypeArgType;
                } else {
                    // Avoid emitting this error for a partially-constructed class.
                    if (!isClassInstance(typeArgType) || !ClassType.isPartiallyEvaluated(typeArgType)) {
                        assert(typeArgs !== undefined);
                        isValidTypeForm = false;
                        addDiagnostic(
                            DiagnosticRule.reportInvalidTypeArguments,
                            LocMessage.typeVarAssignmentMismatch().format({
                                type: printType(typeArgType),
                                name: TypeVarType.getReadableName(typeParams[index]),
                            }) + diag.getString(),
                            typeArgs[index].node
                        );
                    }
                }
            }

            return typeArgType;
        });

        // If the class is partially constructed and doesn't yet have
        // type parameters, assume that the number and types of supplied type
        // arguments are correct.
        if (typeArgs && classType.shared.typeParams.length === 0 && ClassType.isPartiallyEvaluated(classType)) {
            typeArgTypes = typeArgs.map((t) => convertToInstance(t.type));
        }

        let specializedClass = ClassType.specialize(classType, typeArgTypes, typeArgs !== undefined);

        specializedClass = TypeBase.cloneWithTypeForm(
            specializedClass,
            isValidTypeForm ? convertToInstance(specializedClass) : undefined
        );

        return { type: specializedClass };
    }

    function resolveClassTypeArguments(
        classType: ClassType,
        typeParams: TypeVarType[],
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ): Type[] {
        const typeArgTypes: Type[] = [];
        const constraints = new ConstraintTracker();

        typeParams.forEach((typeParam, index) => {
            if (typeArgs && index < typeArgs.length) {
                if (isParamSpec(typeParam)) {
                    const typeArg = typeArgs[index];
                    const functionType = FunctionType.createSynthesizedInstance('', FunctionTypeFlags.ParamSpecValue);

                    if (isEllipsisType(typeArg.type)) {
                        FunctionType.addDefaultParams(functionType);
                        functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
                        typeArgTypes.push(functionType);
                        constraints.setBounds(typeParam, functionType);
                        return;
                    }

                    if (typeArg.typeList) {
                        typeArg.typeList!.forEach((paramType, paramIndex) => {
                            FunctionType.addParam(
                                functionType,
                                FunctionParam.create(
                                    ParamCategory.Simple,
                                    convertToInstance(paramType.type),
                                    FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                                    `__p${paramIndex}`
                                )
                            );
                        });

                        if (typeArg.typeList.length > 0) {
                            FunctionType.addPositionOnlyParamSeparator(functionType);
                        }

                        typeArgTypes.push(functionType);
                        constraints.setBounds(typeParam, functionType);
                        return;
                    }

                    if (isInstantiableClass(typeArg.type) && ClassType.isBuiltIn(typeArg.type, 'Concatenate')) {
                        const concatTypeArgs = typeArg.type.priv.typeArgs;
                        if (concatTypeArgs && concatTypeArgs.length > 0) {
                            concatTypeArgs.forEach((typeArg, index) => {
                                if (index === concatTypeArgs.length - 1) {
                                    if (isParamSpec(typeArg)) {
                                        FunctionType.addParamSpecVariadics(functionType, typeArg);
                                    } else if (isEllipsisType(typeArg)) {
                                        FunctionType.addDefaultParams(functionType);
                                        functionType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
                                    }
                                } else {
                                    FunctionType.addParam(
                                        functionType,
                                        FunctionParam.create(
                                            ParamCategory.Simple,
                                            typeArg,
                                            FunctionParamFlags.NameSynthesized | FunctionParamFlags.TypeDeclared,
                                            `__p${index}`
                                        )
                                    );
                                }
                            });
                        }

                        typeArgTypes.push(functionType);
                        return;
                    }
                }

                const typeArgType = convertTypeArgToInstance(typeArgs[index].type, flags);
                typeArgTypes.push(typeArgType);
                constraints.setBounds(typeParam, typeArgType);
                return;
            }

            const solvedDefaultType = solveAndApplyConstraints(typeParam, constraints, {
                replaceUnsolved: {
                    scopeIds: getTypeVarScopeIds(classType),
                    tupleClassType: getTupleClassType(),
                },
            });
            typeArgTypes.push(solvedDefaultType);
            constraints.setBounds(typeParam, solvedDefaultType);
        });

        return typeArgTypes;
    }

    function applyTypeArgToTypeVar(destType: TypeVarType, srcType: Type, diag: DiagnosticAddendum): Type | undefined {
        if (isAnyOrUnknown(srcType)) {
            return srcType;
        }

        let effectiveSrcType: Type = transformPossibleRecursiveTypeAlias(srcType);

        if (isTypeVar(srcType)) {
            if (isTypeSame(srcType, destType)) {
                return srcType;
            }

            effectiveSrcType = makeTopLevelTypeVarsConcrete(srcType);
        }

        // If this is a partially-evaluated class, don't perform any further
        // checks. Assume in this case that the type is compatible with the
        // bound or constraint.
        if (isClass(effectiveSrcType) && ClassType.isPartiallyEvaluated(effectiveSrcType)) {
            return srcType;
        }

        // If there's a bound type, make sure the source is derived from it.
        if (destType.shared.boundType && !isTypeAliasPlaceholder(effectiveSrcType)) {
            if (
                !assignType(
                    destType.shared.boundType,
                    effectiveSrcType,
                    diag.createAddendum(),
                    /* constraints */ undefined
                )
            ) {
                // Avoid adding a message that will confuse users if the TypeVar was
                // synthesized for internal purposes.
                if (!destType.shared.isSynthesized) {
                    diag.addMessage(
                        LocAddendum.typeBound().format({
                            sourceType: printType(effectiveSrcType),
                            destType: printType(destType.shared.boundType),
                            name: TypeVarType.getReadableName(destType),
                        })
                    );
                }
                return undefined;
            }
        }

        if (isParamSpec(destType)) {
            if (isParamSpec(srcType)) {
                return srcType;
            }

            if (isFunction(srcType) && FunctionType.isParamSpecValue(srcType)) {
                return srcType;
            }

            if (isClassInstance(srcType) && ClassType.isBuiltIn(srcType, 'Concatenate')) {
                return srcType;
            }

            diag.addMessage(
                LocAddendum.typeParamSpec().format({
                    type: printType(srcType),
                    name: TypeVarType.getReadableName(destType),
                })
            );

            return undefined;
        }

        if (isParamSpec(srcType)) {
            diag.addMessage(LocMessage.paramSpecContext());
            return undefined;
        }

        // If there are no constraints, we're done.
        const constraints = destType.shared.constraints;
        if (constraints.length === 0) {
            return srcType;
        }

        if (isTypeAliasPlaceholder(srcType)) {
            return srcType;
        }

        if (isTypeVar(srcType) && TypeVarType.hasConstraints(srcType)) {
            // Make sure all the source constraint types map to constraint types in the dest.
            if (
                srcType.shared.constraints.every((sourceConstraint) => {
                    return constraints.some((destConstraint) => assignType(destConstraint, sourceConstraint));
                })
            ) {
                return srcType;
            }
        } else {
            let bestConstraintSoFar: Type | undefined;

            // Try to find the best (narrowest) match among the constraints.
            for (const constraint of constraints) {
                if (assignType(constraint, effectiveSrcType)) {
                    // Don't allow Never to match unless the constraint is also explicitly Never.
                    if (!isNever(effectiveSrcType) || isNever(constraint)) {
                        if (!bestConstraintSoFar || assignType(bestConstraintSoFar, constraint)) {
                            bestConstraintSoFar = constraint;
                        }
                    }
                }
            }

            if (bestConstraintSoFar) {
                return bestConstraintSoFar;
            }
        }

        diag.addMessage(
            LocAddendum.typeConstrainedTypeVar().format({
                type: printType(srcType),
                name: TypeVarType.getReadableName(destType),
            })
        );

        return undefined;
    }

    function createSelfType(
        classType: ClassType,
        errorNode: ParseNode,
        typeArgs: TypeResultWithNode[] | undefined,
        flags: EvalFlags
    ) {
        // Self doesn't support any type arguments.
        if (typeArgs && typeArgs.length > 0) {
            addDiagnostic(
                DiagnosticRule.reportInvalidTypeArguments,
                LocMessage.typeArgsExpectingNone().format({
                    name: classType.shared.name,
                }),
                typeArgs[0].node ?? errorNode
            );
        }

        let enclosingClass = ParseTreeUtils.getEnclosingClass(errorNode);

        // If `Self` appears anywhere outside of the class body (e.g. a decorator,
        // base class list, metaclass argument, type parameter list), it is
        // considered illegal.
        if (enclosingClass && !ParseTreeUtils.isNodeContainedWithin(errorNode, enclosingClass.d.suite)) {
            enclosingClass = undefined;
        }

        const enclosingClassTypeResult = enclosingClass ? getTypeOfClass(enclosingClass) : undefined;
        if (!enclosingClassTypeResult) {
            if ((flags & (EvalFlags.TypeExpression | EvalFlags.InstantiableType | EvalFlags.TypeFormArg)) !== 0) {
                addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.selfTypeContext(), errorNode);
            }

            return UnknownType.create();
        } else if (isInstantiableMetaclass(enclosingClassTypeResult.classType)) {
            // If `Self` appears within a metaclass, it is considered illegal.
            addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.selfTypeMetaclass(), errorNode);

            return UnknownType.create();
        }

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(errorNode);
        if (enclosingFunction) {
            const functionInfo = getFunctionInfoFromDecorators(
                context,
                enclosingFunction,
                /* isInClass */ true,
                nodeInfo
            );

            const isInnerFunction = !!ParseTreeUtils.getEnclosingFunction(enclosingFunction);
            if (!isInnerFunction) {
                // Check for static methods.
                if (functionInfo.flags & FunctionTypeFlags.StaticMethod) {
                    addDiagnostic(DiagnosticRule.reportGeneralTypeIssues, LocMessage.selfTypeContext(), errorNode);

                    return UnknownType.create();
                }

                if (enclosingFunction.d.params.length > 0) {
                    const firstParamTypeAnnotation = ParseTreeUtils.getTypeAnnotationForParam(enclosingFunction, 0);
                    if (
                        firstParamTypeAnnotation &&
                        !ParseTreeUtils.isNodeContainedWithin(errorNode, firstParamTypeAnnotation)
                    ) {
                        const annotationType = getTypeOfAnnotation(firstParamTypeAnnotation, {
                            typeVarGetsCurScope: true,
                        });
                        if (!isTypeVar(annotationType) || !TypeVarType.isSelf(annotationType)) {
                            addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.selfTypeWithTypedSelfOrCls(),
                                errorNode
                            );
                        }
                    }
                }
            }
        }

        let result = synthesizeTypeVarForSelfCls(enclosingClassTypeResult.classType, /* isClsParam */ true);

        if (enclosingClass) {
            // If "Self" is used as a type expression within a function suite, it needs
            // to be marked as bound.
            const enclosingSuite = ParseTreeUtils.getEnclosingClassOrFunctionSuite(errorNode);

            if (enclosingSuite && ParseTreeUtils.isNodeContainedWithin(enclosingSuite, enclosingClass)) {
                if (enclosingClass.d.suite !== enclosingSuite) {
                    result = TypeVarType.cloneAsBound(result);
                }
            }
        }

        return result;
    }

    function cloneBuiltinClassWithLiteral(
        node: ParseNode,
        literalClassType: ClassType,
        builtInName: string,
        value: LiteralValue
    ): Type {
        const type = getBuiltInType(node, builtInName);
        if (isInstantiableClass(type)) {
            const literalType = ClassType.cloneWithLiteral(type, value);
            TypeBase.setSpecialForm(literalType, literalClassType);
            return literalType;
        }

        return UnknownType.create();
    }

    function createLiteralType(classType: ClassType, node: IndexNode, flags: EvalFlags): Type {
        if (node.d.items.length === 0) {
            addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.literalEmptyArgs(), node.d.leftExpr);
            return UnknownType.create();
        }

        // As per the specification, we support None, int, bool, str, bytes literals
        // plus enum values.
        const literalTypes: Type[] = [];
        let isValidTypeForm = true;

        for (const item of node.d.items) {
            let type: Type | undefined;
            const itemExpr = item.d.valueExpr;

            if (item.d.argCategory !== ArgCategory.Simple) {
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.unpackedArgInTypeArgument(),
                        itemExpr
                    );
                    type = UnknownType.create();
                    isValidTypeForm = false;
                }
            } else if (item.d.name) {
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    addDiagnostic(
                        DiagnosticRule.reportInvalidTypeForm,
                        LocMessage.keywordArgInTypeArgument(),
                        itemExpr
                    );
                    type = UnknownType.create();
                    isValidTypeForm = false;
                }
            } else if (
                itemExpr.nodeType === ParseNodeType.StringList &&
                itemExpr.d.strings.every((stringNode) => stringNode.nodeType === ParseNodeType.String)
            ) {
                const isBytes = (itemExpr.d.strings[0].d.token.flags & StringTokenFlags.Bytes) !== 0;
                const value = itemExpr.d.strings.map((s) => s.d.value).join('');
                if (isBytes) {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'bytes', value);
                } else {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'str', value);
                }

                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    itemExpr.d.strings.forEach((stringNode) => {
                        if ((stringNode.d.token.flags & StringTokenFlags.NamedUnicodeEscape) !== 0) {
                            addDiagnostic(
                                DiagnosticRule.reportInvalidTypeForm,
                                LocMessage.literalNamedUnicodeEscape(),
                                stringNode
                            );
                            isValidTypeForm = false;
                        }
                    });
                }
            } else if (itemExpr.nodeType === ParseNodeType.Number) {
                if (!itemExpr.d.isImaginary && itemExpr.d.isInteger) {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'int', itemExpr.d.value);
                }
            } else if (itemExpr.nodeType === ParseNodeType.Constant) {
                if (itemExpr.d.constType === KeywordType.True) {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'bool', true);
                } else if (itemExpr.d.constType === KeywordType.False) {
                    type = cloneBuiltinClassWithLiteral(node, classType, 'bool', false);
                } else if (itemExpr.d.constType === KeywordType.None) {
                    type = context.prefetched?.noneTypeClass ?? UnknownType.create();
                }
            } else if (itemExpr.nodeType === ParseNodeType.UnaryOperation) {
                if (itemExpr.d.operator === OperatorType.Subtract || itemExpr.d.operator === OperatorType.Add) {
                    if (itemExpr.d.expr.nodeType === ParseNodeType.Number) {
                        if (!itemExpr.d.expr.d.isImaginary && itemExpr.d.expr.d.isInteger) {
                            type = cloneBuiltinClassWithLiteral(
                                node,
                                classType,
                                'int',
                                itemExpr.d.operator === OperatorType.Subtract
                                    ? -itemExpr.d.expr.d.value
                                    : itemExpr.d.expr.d.value
                            );
                        }
                    }
                }
            }

            if (!type) {
                const exprType = getTypeOfExpression(
                    itemExpr,
                    (flags & (EvalFlags.ForwardRefs | EvalFlags.TypeExpression)) | EvalFlags.NoConvertSpecialForm
                );

                // Is this an enum type?
                if (
                    isClassInstance(exprType.type) &&
                    ClassType.isEnumClass(exprType.type) &&
                    exprType.type.priv.literalValue !== undefined
                ) {
                    type = ClassType.cloneAsInstantiable(exprType.type);
                } else {
                    // Is this a type alias to an existing literal type?
                    let isLiteralType = true;

                    doForEachSubtype(exprType.type, (subtype) => {
                        if (!isInstantiableClass(subtype) || subtype.priv.literalValue === undefined) {
                            if (!isNoneTypeClass(subtype)) {
                                isLiteralType = false;
                            }
                        }
                    });

                    if (isLiteralType) {
                        type = exprType.type;
                    }
                }
            }

            if (!type) {
                if ((flags & EvalFlags.TypeExpression) !== 0) {
                    addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.literalUnsupportedType(), item);
                    type = UnknownType.create();
                    isValidTypeForm = false;
                } else {
                    return ClassType.cloneAsInstance(classType);
                }
            }

            literalTypes.push(type);
        }

        let result = combineTypes(literalTypes, { skipElideRedundantLiterals: true });

        if (
            isUnion(result) &&
            context.prefetched?.unionTypeClass &&
            isInstantiableClass(context.prefetched.unionTypeClass)
        ) {
            result = TypeBase.cloneAsSpecialForm(result, ClassType.cloneAsInstance(context.prefetched.unionTypeClass));
        }

        if (isValidTypeForm) {
            result = TypeBase.cloneWithTypeForm(result, convertToInstance(result));
        }

        return result;
    }

    return {
        reportUseOfTypeCheckOnly,
        enforceClassTypeVarScope,
        adjustTypeArgsForTypeVarTuple,
        validateTypeArg,
        createTypeFormType,
        transformTypeForTypeAlias,
        validateTypeParamDefault,
        verifyGenericTypeParams,
        transformTypeArgsForParamSpec,
        createSpecializedClassType,
        createSelfType,
        createLiteralType,
    };
}
