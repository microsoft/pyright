/*
 * memberResolution.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * memberResolution implementation, using evaluator-owned dependencies and state.
 */

import { appendArray } from '../../common/collectionUtils';
import { assert } from '../../common/debug';
import { DiagnosticAddendum } from '../../common/diagnostic';
import { DiagnosticRule } from '../../common/diagnosticRules';
import { LocAddendum, LocMessage } from '../../localization/localize';
import {
    ArgCategory,
    CallNode,
    ClassNode,
    ExpressionNode,
    FunctionNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    NameNode,
    ParseNode,
    ParseNodeType,
    StringNode,
} from '../../parser/parseNodes';
import { isAnnotationEvaluationPostponed } from '../analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzerNodeInfo';
import { CodeFlowEngine } from '../codeFlowEngine';
import { ConstraintTracker } from '../constraintTracker';
import { getBoundInitMethod } from '../constructors';
import { Declaration, DeclarationType } from '../declaration';
import {
    getDeclarationsWithUsesLocalNameRemoved,
    ResolvedAliasInfo,
    synthesizeAliasDeclaration,
} from '../declarationUtils';
import { getParamListDetails } from '../parameterUtils';
import * as ParseTreeUtils from '../parseTreeUtils';
import { Scope, ScopeType, SymbolWithScope } from '../scope';
import { Symbol, SynthesizedTypeInfo } from '../symbol';
import { EvaluatorOptions, MemberAccessTypeResult, SymbolResolutionStackEntry } from '../typeEvaluator/internals';
import {
    AbstractSymbol,
    Arg,
    CallResult,
    ClassTypeResult,
    EffectiveTypeResult,
    EvaluatorUsage,
    ExpectedTypeOptions,
    ExpectedTypeResult,
    FunctionTypeResult,
    PrefetchedTypes,
    Reachability,
    ResolveAliasOptions,
    SymbolDeclInfo,
    TypeEvaluator,
    TypeResult,
} from '../typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    findSubtype,
    FunctionType,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isModule,
    isOverloaded,
    isTypeSame,
    isUnknown,
    ModuleType,
    OverloadedType,
    Type,
    TypeBase,
    TypeCondition,
    TypeVarType,
    UnknownType,
} from '../types';
import {
    ClassMember,
    convertToInstantiable,
    doForEachSubtype,
    getDeclaredGeneratorReturnType,
    InferenceContext,
    isEllipsisType,
    isInstantiableMetaclass,
    isNoneInstance,
    lookUpClassMember,
    lookUpObjectMember,
    makeFunctionTypeVarsBound,
    mapSignatures,
    MemberAccessFlags,
    partiallySpecializeType,
    requiresSpecialization,
    selfSpecializeClass,
    specializeWithDefaultTypeArgs,
} from '../typeUtils';

interface Context {
    readonly addClassEntryDeclsForKeywordArgIfPresent: (
        baseType: ClassType,
        paramName: string,
        decls: Declaration[],
        synthesizedTypes: SynthesizedTypeInfo[]
    ) => void;
    readonly addSymbolDeclInfo: (
        symbol: Symbol,
        decls: Declaration[],
        synthesizedTypes: SynthesizedTypeInfo[],
        preferTypedDeclarations?: boolean
    ) => void;
    readonly shouldFallBackToClassEntryForKeywordArg: (baseType: ClassType, paramName: string) => boolean;
    readonly tryAddPartialKeywordParamDecls: (
        baseType: Type,
        callNode: CallNode,
        paramName: string,
        decls: Declaration[]
    ) => boolean;
    readonly addDiagnostic: TypeEvaluator['addDiagnostic'];
    readonly codeFlowEngine: CodeFlowEngine;
    readonly evaluateTypesForStatement: (node: ParseNode) => void;
    readonly evaluatorOptions: EvaluatorOptions;
    readonly getAbstractSymbolInfo: (classType: ClassType, symbolName: string) => AbstractSymbol | undefined;
    readonly getBoundMagicMethod: (
        classType: ClassType,
        memberName: string,
        selfType?: ClassType | TypeVarType | undefined,
        errorNode?: ExpressionNode | undefined,
        diag?: DiagnosticAddendum,
        recursionCount?: number
    ) => FunctionType | OverloadedType | undefined;
    readonly getEffectiveTypeOfSymbol: (symbol: Symbol) => Type;
    readonly getEffectiveTypeOfSymbolForUsage: (
        symbol: Symbol,
        usageNode?: NameNode,
        useLastDecl?: boolean
    ) => EffectiveTypeResult;
    readonly getExpectedType: (node: ExpressionNode) => ExpectedTypeResult | undefined;
    readonly getInferredTypeOfDeclaration: (symbol: Symbol, decl: Declaration) => Type | undefined;
    readonly getScopeForNode: (node: ParseNode) => Scope | undefined;
    readonly getScopeIdForNode: (node: ParseNode) => string;
    readonly getType: (node: ExpressionNode) => Type | undefined;
    readonly getTypeClassType: () => ClassType | undefined;
    readonly getTypeOfAnnotation: (node: ExpressionNode, options?: ExpectedTypeOptions) => Type;
    readonly getTypeOfBoundMember: (
        errorNode: ExpressionNode | undefined,
        objectType: ClassType,
        memberName: string,
        usage?: EvaluatorUsage,
        diag?: DiagnosticAddendum | undefined,
        flags?: MemberAccessFlags,
        selfType?: ClassType | TypeVarType,
        recursionCount?: number
    ) => TypeResult | undefined;
    readonly getTypeOfClass: (node: ClassNode) => ClassTypeResult | undefined;
    readonly getTypeOfFunction: (node: FunctionNode) => FunctionTypeResult | undefined;
    readonly inferReturnTypeIfNecessary: (type: Type) => void;
    readonly isFlowPathBetweenNodes: (sourceNode: ParseNode, sinkNode: ParseNode, allowSelf?: boolean) => boolean;
    readonly isLegalTypeAliasExpressionForm: (node: ExpressionNode, allowStrLiteral: boolean) => boolean;
    readonly isSymbolValidTypeExpression: (type: Type, includesVarDecl: boolean) => boolean;
    readonly makeTopLevelTypeVarsConcrete: (
        type: Type,
        makeParamSpecsConcrete?: boolean,
        conditionFilter?: TypeCondition[]
    ) => Type;
    readonly nodeInfo: AnalyzerNodeInfo.AnalyzerNodeInfoAccessor;
    readonly partiallySpecializeBoundMethod: (
        baseType: ClassType,
        memberType: FunctionType,
        diag: DiagnosticAddendum | undefined,
        recursionCount: number,
        firstParamType: ClassType | TypeVarType | undefined,
        stripFirstParam?: boolean
    ) => FunctionType | undefined;
    readonly prefetched: Partial<PrefetchedTypes> | undefined;
    readonly resolveAliasDeclarationWithInfo: (
        declaration: Declaration,
        resolveLocalNames: boolean,
        options?: ResolveAliasOptions
    ) => ResolvedAliasInfo | undefined;
    readonly symbolResolutionStack: SymbolResolutionStackEntry[];
    readonly validateCallArgs: (
        errorNode: ExpressionNode,
        argList: Arg[],
        callTypeResult: TypeResult,
        constraints: ConstraintTracker | undefined,
        skipUnknownArgCheck: boolean | undefined,
        inferenceContext: InferenceContext | undefined,
        recursionCount?: number
    ) => CallResult;
    readonly validateInitSubclassArgs: (node: ClassNode, classType: ClassType) => void;
}

// Resolves names, members and declarations; member return types are inferred before specialization.
export function createMemberResolution(context: Context) {
    const {
        addClassEntryDeclsForKeywordArgIfPresent: _addClassEntryDeclsForKeywordArgIfPresent,
        addSymbolDeclInfo: _addSymbolDeclInfo,
        shouldFallBackToClassEntryForKeywordArg: _shouldFallBackToClassEntryForKeywordArg,
        tryAddPartialKeywordParamDecls: _tryAddPartialKeywordParamDecls,
        addDiagnostic,
        codeFlowEngine,
        evaluateTypesForStatement,
        evaluatorOptions,
        getAbstractSymbolInfo,
        getBoundMagicMethod,
        getEffectiveTypeOfSymbol,
        getEffectiveTypeOfSymbolForUsage,
        getExpectedType,
        getInferredTypeOfDeclaration,
        getScopeForNode,
        getScopeIdForNode,
        getType,
        getTypeClassType,
        getTypeOfAnnotation,
        getTypeOfBoundMember,
        getTypeOfClass,
        getTypeOfFunction,
        inferReturnTypeIfNecessary,
        isFlowPathBetweenNodes,
        isLegalTypeAliasExpressionForm,
        isSymbolValidTypeExpression,
        makeTopLevelTypeVarsConcrete,
        nodeInfo,
        partiallySpecializeBoundMethod,
        resolveAliasDeclarationWithInfo,
        symbolResolutionStack,
        validateCallArgs,
        validateInitSubclassArgs,
    } = context;

    function getIndexOfSymbolResolution(symbol: Symbol, declaration: Declaration) {
        return symbolResolutionStack.findIndex(
            (entry) => entry.symbolId === symbol.id && entry.declaration === declaration
        );
    }

    function pushSymbolResolution(symbol: Symbol, declaration: Declaration) {
        const index = getIndexOfSymbolResolution(symbol, declaration);
        if (index >= 0) {
            // Mark all of the entries between these two as invalid.
            for (let i = index + 1; i < symbolResolutionStack.length; i++) {
                symbolResolutionStack[i].isResultValid = false;
            }
            return false;
        }

        symbolResolutionStack.push({
            symbolId: symbol.id,
            declaration,
            isResultValid: true,
        });
        return true;
    }

    function popSymbolResolution(symbol: Symbol) {
        const poppedEntry = symbolResolutionStack.pop();
        assert(
            poppedEntry !== undefined && poppedEntry.symbolId === symbol.id,
            `Symbol resolution stack mismatch: expected symbol ${symbol.id}, got ${
                poppedEntry?.symbolId ?? 'empty stack'
            }`
        );
        return poppedEntry.isResultValid;
    }

    function setSymbolResolutionPartialType(symbol: Symbol, declaration: Declaration, type: Type) {
        const index = getIndexOfSymbolResolution(symbol, declaration);
        if (index >= 0) {
            symbolResolutionStack[index].partialType = type;
        }
    }

    function getSymbolResolutionPartialType(symbol: Symbol, declaration: Declaration): Type | undefined {
        const index = getIndexOfSymbolResolution(symbol, declaration);
        if (index >= 0) {
            return symbolResolutionStack[index].partialType;
        }

        return undefined;
    }

    function isDeclaredTypeAlias(expression: ExpressionNode): boolean {
        if (expression.nodeType === ParseNodeType.TypeAnnotation) {
            if (expression.d.valueExpr.nodeType === ParseNodeType.Name) {
                const symbolWithScope = lookUpSymbolRecursive(
                    expression,
                    expression.d.valueExpr.d.value,
                    /* honorCodeFlow */ false
                );
                if (symbolWithScope) {
                    const symbol = symbolWithScope.symbol;
                    return symbol.getDeclarations().find((decl) => isExplicitTypeAliasDeclaration(decl)) !== undefined;
                }
            }
        }

        return false;
    }

    function validateSymbolIsTypeExpression(node: ExpressionNode, type: Type, includesVarDecl: boolean): Type {
        if (isSymbolValidTypeExpression(type, includesVarDecl)) {
            return type;
        }

        // Disable for assignments in the typings.pyi file, since it defines special forms.
        const fileInfo = nodeInfo.getFileInfo(node);
        if (fileInfo.isTypingStubFile) {
            return type;
        }

        addDiagnostic(DiagnosticRule.reportInvalidTypeForm, LocMessage.typeAnnotationVariable(), node);
        return UnknownType.create();
    }

    function getTypeOfMember(member: ClassMember): Type {
        if (isInstantiableClass(member.classType)) {
            return partiallySpecializeType(
                getEffectiveTypeOfSymbol(member.symbol),
                member.classType,
                getTypeClassType(),
                /* selfClass */ undefined
            );
        }
        return UnknownType.create();
    }

    function getTypeOfMemberInternal(
        errorNode: ExpressionNode | undefined,
        member: ClassMember,
        selfClass: ClassType | TypeVarType | undefined,
        flags: MemberAccessFlags
    ): TypeResult | undefined {
        if (isAnyOrUnknown(member.classType)) {
            return {
                type: member.classType,
                isIncomplete: false,
            };
        }

        if (!isInstantiableClass(member.classType)) {
            return undefined;
        }

        const typeResult = getEffectiveTypeOfSymbolForUsage(member.symbol);

        if (!typeResult) {
            return undefined;
        }

        // Report inappropriate use of variables in type expressions.
        if ((flags & MemberAccessFlags.TypeExpression) !== 0 && errorNode) {
            typeResult.type = validateSymbolIsTypeExpression(
                errorNode,
                typeResult.type,
                !!typeResult.includesVariableDecl
            );
        }

        // If the type is a function or overloaded function, infer
        // and cache the return type if necessary. This needs to be done
        // prior to specializing.
        inferReturnTypeIfNecessary(typeResult.type);

        // Check for ambiguous accesses to attributes with generic types?
        if (
            errorNode &&
            selfClass &&
            isClass(selfClass) &&
            member.isInstanceMember &&
            isClass(member.unspecializedClassType) &&
            (flags & MemberAccessFlags.DisallowGenericInstanceVariableAccess) !== 0 &&
            requiresSpecialization(typeResult.type, { ignoreSelf: true, ignoreImplicitTypeArgs: true })
        ) {
            const specializedType = partiallySpecializeType(
                typeResult.type,
                member.unspecializedClassType,
                getTypeClassType(),
                selfSpecializeClass(selfClass, { overrideTypeArgs: true })
            );

            if (
                findSubtype(
                    specializedType,
                    (subtype) =>
                        !isFunctionOrOverloaded(subtype) &&
                        requiresSpecialization(subtype, { ignoreSelf: true, ignoreImplicitTypeArgs: true })
                )
            ) {
                addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.genericInstanceVariableAccess(),
                    errorNode
                );
            }
        }

        return {
            type: partiallySpecializeType(typeResult.type, member.classType, getTypeClassType(), selfClass),
            isIncomplete: !!typeResult.isIncomplete,
        };
    }

    function bindMethodForMemberAccess(
        type: Type,
        concreteType: FunctionType | OverloadedType,
        memberInfo: ClassMember | undefined,
        classType: ClassType,
        selfType: ClassType | TypeVarType | undefined,
        flags: MemberAccessFlags,
        memberName: string,
        usage: EvaluatorUsage,
        diag: DiagnosticAddendum | undefined,
        recursionCount = 0
    ): TypeResult {
        // Check for an attempt to overwrite a final method.
        if (usage.method === 'set') {
            const impl = isFunction(concreteType) ? concreteType : OverloadedType.getImplementation(concreteType);

            if (impl && isFunction(impl) && FunctionType.isFinal(impl) && memberInfo && isClass(memberInfo.classType)) {
                diag?.addMessage(
                    LocMessage.finalMethodOverride().format({
                        name: memberName,
                        className: memberInfo.classType.shared.name,
                    })
                );

                return { type: UnknownType.create(), typeErrors: true };
            }
        }

        // If this function is an instance member (e.g. a lambda that was
        // assigned to an instance variable), don't perform any binding.
        if (TypeBase.isInstance(classType)) {
            if (!memberInfo || memberInfo.isInstanceMember) {
                return { type: type };
            }
        }

        const boundType = bindFunctionToClassOrObject(
            classType,
            concreteType,
            memberInfo && isInstantiableClass(memberInfo.classType) ? memberInfo.classType : undefined,
            (flags & MemberAccessFlags.TreatConstructorAsClassMethod) !== 0,
            selfType && isClass(selfType) ? ClassType.cloneIncludeSubclasses(selfType) : selfType,
            diag,
            recursionCount
        );

        return { type: boundType ?? UnknownType.create(), typeErrors: !boundType };
    }

    function isAsymmetricDescriptorClass(classType: ClassType): boolean {
        // If the value has already been cached in this type, return the cached value.
        if (classType.priv.isAsymmetricDescriptor !== undefined) {
            return classType.priv.isAsymmetricDescriptor;
        }

        let isAsymmetric = false;

        // Accessors can be defined at different levels of the descriptor's MRO.
        // Ignore instance members so an instance attribute that happens to share
        // a dunder name doesn't shadow the descriptor protocol during this check.
        const accessorFlags = MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.SkipAttributeAccessOverride;
        const getterSymbolResult = lookUpClassMember(classType, '__get__', accessorFlags);
        const setterSymbolResult = lookUpClassMember(classType, '__set__', accessorFlags);

        if (!getterSymbolResult || !setterSymbolResult) {
            isAsymmetric = false;
        } else {
            let getterType = getTypeOfMember(getterSymbolResult);
            let setterType = getTypeOfMember(setterSymbolResult);

            // The getter and setter can be declared on different classes. Specialize
            // both against the concrete descriptor class so Self and inherited type
            // variables are compared in the same context.
            if (getterSymbolResult.classType && isInstantiableClass(getterSymbolResult.classType)) {
                getterType = partiallySpecializeType(
                    getterType,
                    getterSymbolResult.classType,
                    getTypeClassType(),
                    classType
                );
            }
            if (setterSymbolResult.classType && isInstantiableClass(setterSymbolResult.classType)) {
                setterType = partiallySpecializeType(
                    setterType,
                    setterSymbolResult.classType,
                    getTypeClassType(),
                    classType
                );
            }

            // If this is an overload, find the appropriate overload.
            if (isOverloaded(getterType)) {
                const getOverloads = OverloadedType.getOverloads(getterType).filter((overload) => {
                    if (overload.shared.parameters.length < 2) {
                        return false;
                    }
                    const param1Type = FunctionType.getParamType(overload, 1);
                    return !isNoneInstance(param1Type);
                });

                if (getOverloads.length === 1) {
                    getterType = getOverloads[0];
                } else {
                    isAsymmetric = true;
                }
            }

            // If this is an overload, find the appropriate overload.
            if (isOverloaded(setterType)) {
                isAsymmetric = true;
            }

            // If either the setter or getter is an overload (or some other non-function type),
            // conservatively assume that it's not asymmetric.
            if (isFunction(getterType) && isFunction(setterType)) {
                // If there's no declared return type on the getter, assume it's symmetric.
                if (setterType.shared.parameters.length >= 3 && getterType.shared.declaredReturnType) {
                    const setterValueType = FunctionType.getParamType(setterType, 2);
                    const getterReturnType = FunctionType.getEffectiveReturnType(getterType) ?? UnknownType.create();

                    if (!isTypeSame(setterValueType, getterReturnType)) {
                        isAsymmetric = true;
                    }
                }
            }
        }

        // Cache the value for next time.
        classType.priv.isAsymmetricDescriptor = isAsymmetric;
        return isAsymmetric;
    }

    function applyAttributeAccessOverride(
        errorNode: ExpressionNode,
        classType: ClassType,
        usage: EvaluatorUsage,
        memberName: string,
        selfType?: ClassType | TypeVarType
    ): MemberAccessTypeResult | undefined {
        const getAttributeAccessMember = (name: string) => {
            return getTypeOfBoundMember(
                errorNode,
                classType,
                name,
                /* usage */ undefined,
                /* diag */ undefined,
                MemberAccessFlags.SkipInstanceMembers |
                    MemberAccessFlags.SkipObjectBaseClass |
                    MemberAccessFlags.SkipTypeBaseClass |
                    MemberAccessFlags.SkipAttributeAccessOverride,
                selfType
            )?.type;
        };

        let accessMemberType: Type | undefined;
        if (usage.method === 'get') {
            accessMemberType = getAttributeAccessMember('__getattribute__') ?? getAttributeAccessMember('__getattr__');
        } else if (usage.method === 'set') {
            accessMemberType = getAttributeAccessMember('__setattr__');
        } else {
            assert(usage.method === 'del');
            accessMemberType = getAttributeAccessMember('__delattr__');
        }

        if (!accessMemberType) {
            return undefined;
        }

        const argList: Arg[] = [];

        // Provide "name" argument.
        argList.push({
            argCategory: ArgCategory.Simple,
            typeResult: {
                type:
                    context.prefetched?.strClass && isInstantiableClass(context.prefetched.strClass)
                        ? ClassType.cloneWithLiteral(ClassType.cloneAsInstance(context.prefetched.strClass), memberName)
                        : AnyType.create(),
            },
        });

        if (usage.method === 'set') {
            // Provide "value" argument.
            argList.push({
                argCategory: ArgCategory.Simple,
                typeResult: {
                    type: usage.setType?.type ?? UnknownType.create(),
                    isIncomplete: !!usage.setType?.isIncomplete,
                },
            });
        }

        if (!isFunctionOrOverloaded(accessMemberType)) {
            if (isAnyOrUnknown(accessMemberType)) {
                return { type: accessMemberType };
            }

            // TODO - emit an error for this condition.
            return undefined;
        }

        const callResult = validateCallArgs(
            errorNode,
            argList,
            { type: accessMemberType },
            /* constraints */ undefined,
            /* skipUnknownArgCheck */ true,
            /* inferenceContext */ undefined
        );

        let isAsymmetricAccessor = false;
        if (usage.method === 'set') {
            isAsymmetricAccessor = isClassWithAsymmetricAttributeAccessor(classType);
        }

        return {
            type: callResult.returnType ?? UnknownType.create(),
            typeErrors: callResult.argumentErrors,
            isAsymmetricAccessor,
        };
    }

    function synthesizeTypeAliasPlaceholder(nameNode: NameNode, isTypeAliasType: boolean = false): TypeVarType {
        const placeholder = TypeVarType.createInstantiable(`__type_alias_${nameNode.d.value}`);
        placeholder.shared.isSynthesized = true;
        const typeVarScopeId = getScopeIdForNode(nameNode);
        const fileInfo = nodeInfo.getFileInfo(nameNode);

        placeholder.shared.recursiveAlias = {
            name: nameNode.d.value,
            fullName: ParseTreeUtils.getClassFullName(nameNode, fileInfo.moduleName, nameNode.d.value),
            moduleName: fileInfo.moduleName,
            fileUri: fileInfo.fileUri,
            typeVarScopeId,
            isTypeAliasType,
            typeParams: undefined,
            computedVariance: undefined,
        };
        placeholder.priv.scopeId = typeVarScopeId;

        return placeholder;
    }

    function getAliasedSymbolTypeForName(
        node: ImportAsNode | ImportFromAsNode | ImportFromNode,
        name: string
    ): Type | undefined {
        const symbolWithScope = lookUpSymbolRecursive(node, name, /* honorCodeFlow */ true);
        if (!symbolWithScope) {
            return undefined;
        }

        // Normally there will be at most one decl associated with the import node, but
        // there can be multiple in the case of the "from .X import X" statement. In such
        // case, we want to choose the last declaration.
        const filteredDecls = symbolWithScope.symbol
            .getDeclarations()
            .filter(
                (decl) => ParseTreeUtils.isNodeContainedWithin(node, decl.node) && decl.type === DeclarationType.Alias
            );
        let aliasDecl = filteredDecls.length > 0 ? filteredDecls[filteredDecls.length - 1] : undefined;

        // If we didn't find an exact match, look for any alias associated with
        // this symbol. In cases where we have multiple ImportAs nodes that share
        // the same first-part name (e.g. "import asyncio" and "import asyncio.tasks"),
        // we may not find the declaration associated with this node.
        if (!aliasDecl) {
            aliasDecl = symbolWithScope.symbol.getDeclarations().find((decl) => decl.type === DeclarationType.Alias);
        }

        if (!aliasDecl) {
            return undefined;
        }

        assert(aliasDecl.type === DeclarationType.Alias);

        const fileInfo = nodeInfo.getFileInfo(node);

        // Try to resolve the alias while honoring external visibility.
        const resolvedAliasInfo = resolveAliasDeclarationWithInfo(aliasDecl, /* resolveLocalNames */ true, {
            allowExternallyHiddenAccess: fileInfo.isStubFile,
        });

        if (!resolvedAliasInfo) {
            return undefined;
        }

        if (!resolvedAliasInfo.declaration) {
            return evaluatorOptions.evaluateUnknownImportsAsAny ? AnyType.create() : UnknownType.create();
        }

        if (node.nodeType === ParseNodeType.ImportFromAs) {
            if (resolvedAliasInfo.isPrivate) {
                addDiagnostic(
                    DiagnosticRule.reportPrivateUsage,
                    LocMessage.privateUsedOutsideOfModule().format({
                        name: node.d.name.d.value,
                    }),
                    node.d.name
                );
            }

            if (resolvedAliasInfo.privatePyTypedImporter) {
                const diag = new DiagnosticAddendum();
                if (resolvedAliasInfo.privatePyTypedImported) {
                    diag.addMessage(
                        LocAddendum.privateImportFromPyTypedSource().format({
                            module: resolvedAliasInfo.privatePyTypedImported,
                        })
                    );
                }
                addDiagnostic(
                    DiagnosticRule.reportPrivateImportUsage,
                    LocMessage.privateImportFromPyTypedModule().format({
                        name: node.d.name.d.value,
                        module: resolvedAliasInfo.privatePyTypedImporter,
                    }) + diag.getString(),
                    node.d.name
                );
            }
        }

        return getInferredTypeOfDeclaration(symbolWithScope.symbol, aliasDecl);
    }

    function lookUpSymbolRecursive(
        node: ParseNode,
        name: string,
        honorCodeFlow: boolean,
        preferGlobalScope = false
    ): SymbolWithScope | undefined {
        const scopeNodeInfo = ParseTreeUtils.getEvaluationScopeNode(node, nodeInfo);
        const scope = nodeInfo.getScope(scopeNodeInfo.node);

        let symbolWithScope = scope?.lookUpSymbolRecursive(name, {
            useProxyScope: !!scopeNodeInfo.useProxyScope,
            useChainedModuleLevelScopes: !!scopeNodeInfo.useChainedModuleLevelScopes,
        });
        const scopeType = scope?.type ?? ScopeType.Module;

        // Functions and list comprehensions don't allow access to implicitly
        // aliased symbols in outer scopes if they haven't yet been assigned
        // within the local scope.
        let scopeTypeHonorsCodeFlow = scopeType !== ScopeType.Function && scopeType !== ScopeType.Comprehension;

        // Type parameter scopes don't honor code flow.
        if (symbolWithScope?.scope.type === ScopeType.TypeParameter) {
            scopeTypeHonorsCodeFlow = false;
        }

        if (symbolWithScope && honorCodeFlow && scopeTypeHonorsCodeFlow) {
            // Filter the declarations based on flow reachability.
            const reachableDecl = symbolWithScope.symbol.getDeclarations().find((decl) => {
                if (decl.type !== DeclarationType.Alias && decl.type !== DeclarationType.Intrinsic) {
                    // Determine if the declaration is in the same execution scope as the "usageNode" node.
                    let usageScopeNode = ParseTreeUtils.getExecutionScopeNode(node, nodeInfo);
                    const declNode: ParseNode =
                        decl.type === DeclarationType.Class ||
                        decl.type === DeclarationType.Function ||
                        decl.type === DeclarationType.TypeAlias
                            ? decl.node.d.name
                            : decl.node;
                    const declScopeNode = ParseTreeUtils.getExecutionScopeNode(declNode, nodeInfo);

                    // If this is a type parameter scope, it will be a proxy for its
                    // containing scope, so we need to use that instead.
                    const usageScope = nodeInfo.getScope(usageScopeNode);
                    if (usageScope?.proxy) {
                        const typeParamScope = nodeInfo.getScope(usageScopeNode);
                        if (!typeParamScope?.symbolTable.has(name) && usageScopeNode.parent) {
                            usageScopeNode = ParseTreeUtils.getExecutionScopeNode(usageScopeNode.parent, nodeInfo);
                        }
                    }

                    if (usageScopeNode === declScopeNode) {
                        if (!isFlowPathBetweenNodes(declNode, node)) {
                            // If there was no control flow path from the usage back
                            // to the source, see if the usage node is reachable by
                            // any path.
                            const flowNode = nodeInfo.getFlowNode(node);
                            const isReachable =
                                flowNode &&
                                codeFlowEngine.getFlowNodeReachability(
                                    flowNode,
                                    /* sourceFlowNode */ undefined,
                                    /* ignoreNoReturn */ true
                                ) === Reachability.Reachable;
                            return !isReachable;
                        }
                    }
                }
                return true;
            });

            // If none of the declarations are reachable from the current node,
            // search for the symbol in outer scopes.
            if (!reachableDecl) {
                if (symbolWithScope.scope.type !== ScopeType.Function) {
                    let nextScopeToSearch = symbolWithScope.scope.parent;
                    const isOutsideCallerModule =
                        symbolWithScope.isOutsideCallerModule || symbolWithScope.scope.type === ScopeType.Module;
                    let isBeyondExecutionScope =
                        symbolWithScope.isBeyondExecutionScope || symbolWithScope.scope.isIndependentlyExecutable();

                    if (symbolWithScope.scope.type === ScopeType.Class) {
                        // There is an odd documented behavior for classes in that
                        // symbol resolution skips to the global scope rather than
                        // the next scope in the chain.
                        const globalScopeResult = symbolWithScope.scope.getGlobalScope();
                        nextScopeToSearch = globalScopeResult.scope;
                        if (globalScopeResult.isBeyondExecutionScope) {
                            isBeyondExecutionScope = true;
                        }
                    }

                    if (nextScopeToSearch) {
                        symbolWithScope = nextScopeToSearch.lookUpSymbolRecursive(name, {
                            isOutsideCallerModule,
                            isBeyondExecutionScope,
                        });
                    } else {
                        symbolWithScope = undefined;
                    }
                } else {
                    symbolWithScope = undefined;
                }
            }
        }

        // PEP 563 indicates that if a forward reference can be resolved in the module
        // scope (or, by implication, in the builtins scope), it should prefer that
        // resolution over local resolutions. This doesn't apply to a PEP 695 "type"
        // statement's target, which binds synchronously in the scope where it appears
        // (including a class scope) rather than being deferred like other annotations.
        const isTypeAliasStatementTarget = symbolWithScope?.symbol
            .getDeclarations()
            .some((decl) => decl.type === DeclarationType.TypeAlias);

        // PEP 695 annotation scopes retain access to their enclosing class namespace.
        if (
            symbolWithScope &&
            preferGlobalScope &&
            !isTypeAliasStatementTarget &&
            !ParseTreeUtils.getParentNodeOfType(node, ParseNodeType.TypeAlias)
        ) {
            let curSymbolWithScope: SymbolWithScope | undefined = symbolWithScope;
            while (
                curSymbolWithScope.scope.type !== ScopeType.Module &&
                curSymbolWithScope.scope.type !== ScopeType.Builtin &&
                curSymbolWithScope.scope.type !== ScopeType.TypeParameter &&
                curSymbolWithScope.scope.parent
            ) {
                curSymbolWithScope = curSymbolWithScope.scope.parent.lookUpSymbolRecursive(name, {
                    isOutsideCallerModule: curSymbolWithScope.isOutsideCallerModule,
                    isBeyondExecutionScope:
                        curSymbolWithScope.isBeyondExecutionScope ||
                        curSymbolWithScope.scope.isIndependentlyExecutable(),
                });
                if (!curSymbolWithScope) {
                    break;
                }
            }

            if (
                curSymbolWithScope?.scope.type === ScopeType.Module ||
                curSymbolWithScope?.scope.type === ScopeType.Builtin
            ) {
                symbolWithScope = curSymbolWithScope;
            }
        }

        return symbolWithScope;
    }

    function getDeclarationFromKeywordParam(type: FunctionType, paramName: string): Declaration | undefined {
        if (isFunction(type)) {
            if (type.shared.declaration) {
                const functionDecl = type.shared.declaration;
                if (functionDecl.type === DeclarationType.Function) {
                    const functionNode = functionDecl.node;
                    const functionScope = nodeInfo.getScope(functionNode);
                    if (functionScope) {
                        const paramSymbol = functionScope.lookUpSymbol(paramName)!;
                        if (paramSymbol) {
                            return paramSymbol.getDeclarations().find((decl) => decl.type === DeclarationType.Param);
                        }

                        const parameterDetails = getParamListDetails(type);
                        if (parameterDetails.unpackedKwargsTypedDictType) {
                            const lookupResults = lookUpClassMember(
                                parameterDetails.unpackedKwargsTypedDictType,
                                paramName
                            );
                            if (lookupResults) {
                                return lookupResults.symbol
                                    .getDeclarations()
                                    .find((decl) => decl.type === DeclarationType.Variable);
                            }
                        }
                    }
                }
            }
        }

        return undefined;
    }

    function getAliasFromImport(node: NameNode): NameNode | undefined {
        if (
            node.parent &&
            node.parent.nodeType === ParseNodeType.ImportFromAs &&
            node.parent.d.alias &&
            node === node.parent.d.name
        ) {
            return node.parent.d.alias;
        }
        return undefined;
    }

    function getDeclInfoForStringNode(node: StringNode): SymbolDeclInfo | undefined {
        const decls: Declaration[] = [];
        const synthesizedTypes: SynthesizedTypeInfo[] = [];
        const expectedType = getExpectedType(node)?.type;

        if (expectedType) {
            doForEachSubtype(expectedType, (subtype) => {
                // If the expected type is a TypedDict then the node is either a key expression
                // or a single entry in a set. We then need to check that the value of the node
                // is a valid entry in the TypedDict to avoid resolving declarations for
                // synthesized symbols such as 'get'.
                if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
                    const entry = subtype.shared.typedDictEntries?.knownItems.get(node.d.value);
                    if (entry) {
                        const symbol = lookUpObjectMember(subtype, node.d.value)?.symbol;

                        if (symbol) {
                            _addSymbolDeclInfo(symbol, decls, synthesizedTypes);
                        }
                    }
                }
            });
        }

        return decls.length === 0 ? undefined : { decls, synthesizedTypes };
    }

    function getDeclInfoForNameNode(node: NameNode, skipUnreachableCode = true): SymbolDeclInfo | undefined {
        if (skipUnreachableCode && nodeInfo.isCodeUnreachable(node)) {
            return undefined;
        }

        const decls: Declaration[] = [];
        const synthesizedTypes: SynthesizedTypeInfo[] = [];

        // If the node is part of a "from X import Y as Z" statement and the node
        // is the "Y" (non-aliased) name, we need to look up the alias symbol
        // since the non-aliased name is not in the symbol table.
        const alias = getAliasFromImport(node);
        if (alias) {
            const scope = getScopeForNode(node);
            if (scope) {
                // Look up the alias symbol.
                const symbolInScope = scope.lookUpSymbolRecursive(alias.d.value);
                if (symbolInScope) {
                    // The alias could have more decls that don't refer to this import. Filter
                    // out the one(s) that specifically associated with this import statement.
                    const declsForThisImport = symbolInScope.symbol.getDeclarations().filter((decl) => {
                        return decl.type === DeclarationType.Alias && decl.node === node.parent;
                    });

                    appendArray(decls, getDeclarationsWithUsesLocalNameRemoved(declsForThisImport));
                }
            }
        } else if (
            node.parent &&
            node.parent.nodeType === ParseNodeType.MemberAccess &&
            node === node.parent.d.member
        ) {
            let baseType = getType(node.parent.d.leftExpr);
            if (baseType) {
                baseType = makeTopLevelTypeVarsConcrete(baseType);
                const memberName = node.parent.d.member.d.value;
                doForEachSubtype(baseType, (subtype) => {
                    let symbol: Symbol | undefined;

                    subtype = makeTopLevelTypeVarsConcrete(subtype);

                    if (isInstantiableClass(subtype)) {
                        // Try to find a member that has a declared type. If so, that
                        // overrides any inferred types.
                        let member = lookUpClassMember(subtype, memberName, MemberAccessFlags.DeclaredTypesOnly);
                        if (!member) {
                            member = lookUpClassMember(subtype, memberName);
                        }

                        if (!member) {
                            const metaclass = subtype.shared.effectiveMetaclass;
                            if (metaclass && isInstantiableClass(metaclass)) {
                                member = lookUpClassMember(metaclass, memberName);
                            }
                        }

                        if (member) {
                            symbol = member.symbol;
                        }
                    } else if (isClassInstance(subtype)) {
                        // Try to find a member that has a declared type. If so, that
                        // overrides any inferred types.
                        let member = lookUpObjectMember(subtype, memberName, MemberAccessFlags.DeclaredTypesOnly);
                        if (!member) {
                            member = lookUpObjectMember(subtype, memberName);
                        }
                        if (member) {
                            symbol = member.symbol;
                        }
                    } else if (isModule(subtype)) {
                        symbol = ModuleType.getField(subtype, memberName);
                    }

                    if (symbol) {
                        // By default, report only the declarations that have type annotations.
                        // If there are none, then report all of the unannotated declarations,
                        // which includes every assignment of that symbol.
                        _addSymbolDeclInfo(symbol, decls, synthesizedTypes, /* preferTypedDeclarations */ true);
                    }
                });
            }
        } else if (node.parent && node.parent.nodeType === ParseNodeType.ModuleName) {
            const namePartIndex = node.parent.d.nameParts.findIndex((part) => part === node);
            const importInfo = nodeInfo.getImportInfo(node.parent);
            if (
                namePartIndex >= 0 &&
                importInfo &&
                !importInfo.isNativeLib &&
                namePartIndex < importInfo.resolvedUris.length
            ) {
                if (importInfo.resolvedUris[namePartIndex]) {
                    evaluateTypesForStatement(node);

                    // Synthesize an alias declaration for this name part. The only
                    // time this case is used is for IDE services such as
                    // the find all references, hover provider and etc.
                    decls.push(synthesizeAliasDeclaration(importInfo.resolvedUris[namePartIndex]));
                }
            }
        } else if (node.parent && node.parent.nodeType === ParseNodeType.Argument && node === node.parent.d.name) {
            // The target node is the name in a keyword argument. We need to determine whether
            // the corresponding keyword parameter can be determined from the context.
            const argNode = node.parent;
            const paramName = node.d.value;
            if (argNode.parent?.nodeType === ParseNodeType.Call) {
                const baseType = getType(argNode.parent.d.leftExpr);

                if (baseType) {
                    if (_tryAddPartialKeywordParamDecls(baseType, argNode.parent, paramName, decls)) {
                        // functools.partial keyword args are resolved against the wrapped callable.
                    } else if (isFunction(baseType) && baseType.shared.declaration) {
                        const paramDecl = getDeclarationFromKeywordParam(baseType, paramName);
                        if (paramDecl) {
                            decls.push(paramDecl);
                        }
                    } else if (isOverloaded(baseType)) {
                        OverloadedType.getOverloads(baseType).forEach((f) => {
                            const paramDecl = getDeclarationFromKeywordParam(f, paramName);
                            if (paramDecl) {
                                decls.push(paramDecl);
                            }
                        });
                    } else if (isInstantiableClass(baseType)) {
                        const initMethodType = getBoundInitMethod(
                            context,
                            argNode.parent.d.leftExpr,
                            ClassType.cloneAsInstance(baseType)
                        )?.type;

                        if (initMethodType && isFunction(initMethodType)) {
                            const paramDecl = getDeclarationFromKeywordParam(initMethodType, paramName);
                            if (paramDecl) {
                                decls.push(paramDecl);
                            } else if (_shouldFallBackToClassEntryForKeywordArg(baseType, paramName)) {
                                _addClassEntryDeclsForKeywordArgIfPresent(baseType, paramName, decls, synthesizedTypes);
                            }
                        } else if (_shouldFallBackToClassEntryForKeywordArg(baseType, paramName)) {
                            // Some synthesized callables (notably TypedDict "constructors") don't have a
                            // meaningful __init__ signature we can map keyword arguments to. In these cases,
                            // treat the keyword as referring to the class entry so IDE features like
                            // go-to-definition and rename can bind to the field declaration.
                            _addClassEntryDeclsForKeywordArgIfPresent(baseType, paramName, decls, synthesizedTypes);
                        }
                    }
                }
            } else if (argNode.parent?.nodeType === ParseNodeType.Class) {
                const classTypeResult = getTypeOfClass(argNode.parent);

                // Validate the init subclass args for this class so we can properly
                // evaluate its custom keyword parameters.
                if (classTypeResult) {
                    validateInitSubclassArgs(argNode.parent, classTypeResult.classType);
                }
            }
        } else if (
            node.parent &&
            node.parent.nodeType === ParseNodeType.PatternClassArgument &&
            node === node.parent.d.name &&
            node.parent.parent?.nodeType === ParseNodeType.PatternClass
        ) {
            // The target node is the keyword name in a class pattern argument
            // (e.g. `case Foo(prop=...)`). Map it to the corresponding class member
            // declaration so that find-all-references and rename bind to the attribute.
            // Only the keyword (left of `=`) is handled here; the capture target on the
            // right (e.g. the second `prop` in `case Foo(prop=prop)`) is a separate local
            // binding that is resolved through the normal name-lookup path.
            const memberName = node.d.value;
            let classType = getType(node.parent.parent.d.className);
            if (classType) {
                classType = makeTopLevelTypeVarsConcrete(classType);
                doForEachSubtype(classType, (subtype) => {
                    subtype = makeTopLevelTypeVarsConcrete(subtype);

                    // The class name in a class pattern usually evaluates to an instantiable class,
                    // but analysis can still yield Unknown/Any (e.g. an unresolved class name), so
                    // the isInstantiableClass gate skips those subtypes rather than assuming
                    // every subtype is a class.
                    if (isInstantiableClass(subtype)) {
                        // Try to find a member that has a declared type. If so, that
                        // overrides any inferred types.
                        let member = lookUpClassMember(subtype, memberName, MemberAccessFlags.DeclaredTypesOnly);
                        if (!member) {
                            member = lookUpClassMember(subtype, memberName);
                        }

                        if (member) {
                            _addSymbolDeclInfo(
                                member.symbol,
                                decls,
                                synthesizedTypes,
                                /* preferTypedDeclarations */ true
                            );
                        }
                    }
                });
            }
        } else {
            const fileInfo = nodeInfo.getFileInfo(node);

            // Determine if this node is within a quoted type annotation.
            const isWithinTypeAnnotation = ParseTreeUtils.isWithinTypeAnnotation(
                node,
                !isAnnotationEvaluationPostponed(nodeInfo.getFileInfo(node)),
                nodeInfo
            );

            // Determine if this is part of a "type" statement.
            const isWithinTypeAliasStatement = !!ParseTreeUtils.getParentNodeOfType(node, ParseNodeType.TypeAlias);
            const allowForwardReferences = isWithinTypeAnnotation || isWithinTypeAliasStatement || fileInfo.isStubFile;

            const symbolWithScope = lookUpSymbolRecursive(
                node,
                node.d.value,
                !allowForwardReferences,
                isWithinTypeAnnotation
            );

            if (symbolWithScope) {
                _addSymbolDeclInfo(symbolWithScope.symbol, decls, synthesizedTypes);
            }
        }

        return { decls, synthesizedTypes };
    }

    function includesVariableTypeDecl(decls: Declaration[]): boolean {
        return decls.some((decl) => {
            if (decl.type === DeclarationType.Variable) {
                // Exempt typing.pyi and typingExtensions.pyi, which use variables to
                // define some special forms.
                const fileInfo = nodeInfo.getFileInfo(decl.node);

                if (!fileInfo.isTypingStubFile && !fileInfo.isTypingExtensionsStubFile) {
                    return true;
                }
            }

            if (decl.type === DeclarationType.Param) {
                return true;
            }

            return false;
        });
    }

    function getDeclaredReturnType(node: FunctionNode): Type | undefined {
        const functionTypeInfo = getTypeOfFunction(node);
        const returnType = functionTypeInfo?.functionType.shared.declaredReturnType;

        if (!returnType) {
            return undefined;
        }

        if (FunctionType.isGenerator(functionTypeInfo.functionType)) {
            return getDeclaredGeneratorReturnType(functionTypeInfo.functionType);
        }

        return returnType;
    }

    function getCallbackProtocolType(
        objType: ClassType,
        recursionCount = 0
    ): FunctionType | OverloadedType | undefined {
        if (!isClassInstance(objType) || !ClassType.isProtocolClass(objType)) {
            return undefined;
        }

        // Make sure that the protocol class doesn't define any fields that
        // a normal function wouldn't be compatible with.
        for (const mroClass of objType.shared.mro) {
            if (isClass(mroClass) && ClassType.isProtocolClass(mroClass)) {
                for (const field of ClassType.getSymbolTable(mroClass)) {
                    const fieldName = field[0];
                    const fieldSymbol = field[1];

                    // We're expecting a __call__ method. We will also ignore a
                    // __slots__ definition, which is (by convention) ignored for
                    // protocol matching.
                    if (fieldName === '__call__' || fieldName === '__slots__') {
                        continue;
                    }

                    if (fieldSymbol.isIgnoredForProtocolMatch()) {
                        continue;
                    }

                    let fieldIsPartOfFunction = false;

                    if (context.prefetched?.functionClass && isClass(context.prefetched.functionClass)) {
                        if (ClassType.getSymbolTable(context.prefetched.functionClass).has(field[0])) {
                            fieldIsPartOfFunction = true;
                        }
                    }

                    if (!fieldIsPartOfFunction) {
                        return undefined;
                    }
                }
            }
        }

        const callType = getBoundMagicMethod(
            objType,
            '__call__',
            /* selfType */ undefined,
            /* errorNode */ undefined,
            /* diag */ undefined,
            recursionCount
        );

        if (!callType) {
            return undefined;
        }

        return makeFunctionTypeVarsBound(callType);
    }

    function getAbstractSymbols(classType: ClassType): AbstractSymbol[] {
        const symbolTable = new Map<string, AbstractSymbol>();

        ClassType.getReverseMro(classType).forEach((mroClass) => {
            if (isInstantiableClass(mroClass)) {
                // See if this class is introducing a new abstract symbol that has not been
                // introduced previously or if it is overriding an abstract symbol with
                // a non-abstract one.
                ClassType.getSymbolTable(mroClass).forEach((symbol, symbolName) => {
                    const abstractSymbolInfo = getAbstractSymbolInfo(mroClass, symbolName);

                    if (abstractSymbolInfo) {
                        symbolTable.set(symbolName, abstractSymbolInfo);
                    } else {
                        symbolTable.delete(symbolName);
                    }
                });
            }
        });

        // Create a final list of symbols that are abstract.
        const symbolList: AbstractSymbol[] = [];
        symbolTable.forEach((method) => {
            symbolList.push(method);
        });

        return symbolList;
    }

    function bindFunctionToClassOrObject(
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedType,
        memberClass?: ClassType,
        treatConstructorAsClassMethod = false,
        selfType?: ClassType | TypeVarType,
        diag?: DiagnosticAddendum,
        recursionCount = 0
    ): FunctionType | OverloadedType | undefined {
        return mapSignatures(memberType, (functionType) => {
            // If the caller specified no base type, always strip the
            // first parameter. This is used in cases like constructors.
            if (!baseType) {
                return FunctionType.clone(functionType, /* stripFirstParam */ true);
            }

            // If the first parameter was already stripped, it has already been
            // bound. Don't attempt to rebind.
            if (functionType.priv.strippedFirstParamType) {
                return functionType;
            }

            if (FunctionType.isInstanceMethod(functionType) && !treatConstructorAsClassMethod) {
                // If the baseType is a metaclass, don't specialize the function.
                if (isInstantiableMetaclass(baseType)) {
                    return functionType;
                }

                const baseObj: ClassType = isClassInstance(baseType)
                    ? baseType
                    : ClassType.cloneAsInstance(specializeWithDefaultTypeArgs(baseType));

                let stripFirstParam = false;
                if (isClassInstance(baseType)) {
                    stripFirstParam = true;
                } else if (memberClass && isInstantiableMetaclass(memberClass)) {
                    stripFirstParam = true;
                }

                return partiallySpecializeBoundMethod(
                    baseType,
                    functionType,
                    diag,
                    recursionCount,
                    selfType ?? baseObj,
                    stripFirstParam
                );
            }

            if (FunctionType.isClassMethod(functionType) || treatConstructorAsClassMethod) {
                const baseClass = isInstantiableClass(baseType) ? baseType : ClassType.cloneAsInstantiable(baseType);
                const clsType = selfType ? (convertToInstantiable(selfType) as ClassType | TypeVarType) : undefined;

                return partiallySpecializeBoundMethod(
                    baseClass,
                    functionType,
                    diag,
                    recursionCount,
                    clsType ?? baseClass,
                    /* stripFirstParam */ true
                );
            }

            if (FunctionType.isStaticMethod(functionType)) {
                const baseClass = isInstantiableClass(baseType) ? baseType : ClassType.cloneAsInstantiable(baseType);

                return partiallySpecializeBoundMethod(
                    baseClass,
                    functionType,
                    diag,
                    recursionCount,
                    /* firstParamType */ undefined,
                    /* stripFirstParam */ false
                );
            }

            return functionType;
        });
    }

    function isExplicitTypeAliasDeclaration(decl: Declaration): boolean {
        if (decl.type !== DeclarationType.Variable || !decl.typeAnnotationNode) {
            return false;
        }

        if (
            decl.typeAnnotationNode.nodeType !== ParseNodeType.Name &&
            decl.typeAnnotationNode.nodeType !== ParseNodeType.MemberAccess &&
            decl.typeAnnotationNode.nodeType !== ParseNodeType.StringList
        ) {
            return false;
        }

        const type = getTypeOfAnnotation(decl.typeAnnotationNode, { varTypeAnnotation: true, allowClassVar: true });
        return isClassInstance(type) && ClassType.isBuiltIn(type, 'TypeAlias');
    }

    function isPossibleTypeAliasDeclaration(decl: Declaration): boolean {
        if (decl.type !== DeclarationType.Variable || !decl.typeAliasName || decl.typeAnnotationNode) {
            return false;
        }

        if (decl.node.parent?.nodeType !== ParseNodeType.Assignment) {
            return false;
        }

        // Perform a sanity check on the RHS expression. Some expression
        // forms should never be considered legitimate for type aliases.
        return isLegalTypeAliasExpressionForm(decl.node.parent.d.rightExpr, /* allowStrLiteral */ false);
    }

    function isLegalImplicitTypeAliasType(type: Type) {
        // We explicitly exclude "..." and "Unknown".
        if (isEllipsisType(type)) {
            return false;
        }

        if (isUnknown(type)) {
            // If this is a union type, we'll assume that it was meant as a type
            // alias even though all of the union subtypes are Unknown.
            if (type.props?.specialForm && ClassType.isBuiltIn(type.props.specialForm, 'UnionType')) {
                return true;
            }
            return false;
        }

        // Look at the subtypes within the union. If any of them are not
        // instantiable (other than "None" which is special-cased), it is
        // not a legal type alias type.
        let isLegal = true;
        doForEachSubtype(type, (subtype) => {
            if (!TypeBase.isInstantiable(subtype) && !isNoneInstance(subtype)) {
                isLegal = false;
            }
        });

        return isLegal;
    }

    function isClassWithAsymmetricAttributeAccessor(classType: ClassType): boolean {
        // If the value has already been cached in this type, return the cached value.
        if (classType.priv.isAsymmetricAttributeAccessor !== undefined) {
            return classType.priv.isAsymmetricAttributeAccessor;
        }

        let isAsymmetric = false;

        const getterSymbolResult = lookUpClassMember(classType, '__getattr__', MemberAccessFlags.SkipBaseClasses);
        const setterSymbolResult = lookUpClassMember(classType, '__setattr__', MemberAccessFlags.SkipBaseClasses);

        if (!getterSymbolResult || !setterSymbolResult) {
            isAsymmetric = false;
        } else {
            const getterType = getEffectiveTypeOfSymbol(getterSymbolResult.symbol);
            const setterType = getEffectiveTypeOfSymbol(setterSymbolResult.symbol);

            // If either the setter or getter is an overload (or some other non-function type),
            // conservatively assume that it's not asymmetric.
            if (isFunction(getterType) && isFunction(setterType)) {
                // If there's no declared return type on the getter, assume it's symmetric.
                if (setterType.shared.parameters.length >= 3 && getterType.shared.declaredReturnType) {
                    const setterValueType = FunctionType.getParamType(setterType, 2);
                    const getterReturnType = FunctionType.getEffectiveReturnType(getterType) ?? UnknownType.create();

                    if (!isTypeSame(setterValueType, getterReturnType)) {
                        isAsymmetric = true;
                    }
                }
            }
        }

        // Cache the value for next time.
        classType.priv.isAsymmetricAttributeAccessor = isAsymmetric;
        return isAsymmetric;
    }

    return {
        pushSymbolResolution,
        popSymbolResolution,
        setSymbolResolutionPartialType,
        getSymbolResolutionPartialType,
        isDeclaredTypeAlias,
        validateSymbolIsTypeExpression,
        bindMethodForMemberAccess,
        isAsymmetricDescriptorClass,
        applyAttributeAccessOverride,
        synthesizeTypeAliasPlaceholder,
        getAliasedSymbolTypeForName,
        lookUpSymbolRecursive,
        getDeclInfoForStringNode,
        getDeclInfoForNameNode,
        includesVariableTypeDecl,
        getDeclaredReturnType,
        getCallbackProtocolType,
        getAbstractSymbols,
        bindFunctionToClassOrObject,
        isExplicitTypeAliasDeclaration,
        isPossibleTypeAliasDeclaration,
        isLegalImplicitTypeAliasType,
        getTypeOfMember,
        getTypeOfMemberInternal,
        getIndexOfSymbolResolution,
        getDeclarationFromKeywordParam,
        getAliasFromImport,
    };
}
