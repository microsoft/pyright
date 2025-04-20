/*
 * dataClasses.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the construction of dataclass
 * classes and dataclass transform.
 */

import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { PythonVersion, pythonVersion3_13 } from '../common/pythonVersion';
import { LocMessage } from '../localization/localize';
import {
    ArgCategory,
    ArgumentNode,
    CallNode,
    ClassNode,
    ExpressionNode,
    NameNode,
    ParamCategory,
    ParseNode,
    ParseNodeType,
    TypeAnnotationNode,
} from '../parser/parseNodes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { getFileInfo } from './analyzerNodeInfo';
import { ConstraintSolution } from './constraintSolution';
import { ConstraintTracker } from './constraintTracker';
import { createFunctionFromConstructor, getBoundInitMethod } from './constructors';
import { DeclarationType } from './declaration';
import { updateNamedTupleBaseClass } from './namedTuples';
import {
    getClassFullName,
    getEnclosingClassOrFunction,
    getScopeIdForNode,
    getTypeSourceId,
    getTypeVarScopesForNode,
} from './parseTreeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol, SymbolFlags } from './symbol';
import { isPrivateName } from './symbolNameUtils';
import { Arg, EvalFlags, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    DataClassBehaviors,
    DataClassEntry,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isOverloaded,
    isUnion,
    OverloadedType,
    TupleTypeArg,
    Type,
    TypeVarScopeType,
    TypeVarType,
    UnknownType,
    Variance,
} from './types';
import {
    addSolutionForSelfType,
    applySolvedTypeVars,
    buildSolution,
    buildSolutionFromSpecializedClass,
    computeMroLinearization,
    convertToInstance,
    doForEachSignature,
    getTypeVarScopeId,
    getTypeVarScopeIds,
    isLiteralType,
    isMetaclassInstance,
    makeInferenceContext,
    makeTypeVarsBound,
    makeTypeVarsFree,
    requiresSpecialization,
    specializeTupleClass,
    synthesizeTypeVarForSelfCls,
} from './typeUtils';

// Validates fields for compatibility with a dataclass and synthesizes
// an appropriate __new__ and __init__ methods plus __dataclass_fields__
// and __match_args__ class variables.
export function synthesizeDataClassMethods(
    evaluator: TypeEvaluator,
    node: ClassNode,
    classType: ClassType,
    isNamedTuple: boolean,
    skipSynthesizeInit: boolean,
    hasExistingInitMethod: boolean,
    skipSynthesizeHash: boolean
) {
    assert(ClassType.isDataClass(classType) || isNamedTuple);

    const classTypeVar = synthesizeTypeVarForSelfCls(classType, /* isClsParam */ true);
    const newType = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.ConstructorMethod);
    newType.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);
    const initType = FunctionType.createSynthesizedInstance('__init__');
    initType.priv.constructorTypeVarScopeId = getTypeVarScopeId(classType);

    // Generate both a __new__ and an __init__ method. The parameters of the
    // __new__ method are based on field definitions for NamedTuple classes,
    // and the parameters of the __init__ method are based on field definitions
    // in other cases.
    FunctionType.addParam(
        newType,
        FunctionParam.create(ParamCategory.Simple, classTypeVar, FunctionParamFlags.TypeDeclared, 'cls')
    );
    if (!isNamedTuple) {
        FunctionType.addDefaultParams(newType);
        newType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
    }
    newType.shared.declaredReturnType = convertToInstance(classTypeVar);

    const selfType = synthesizeTypeVarForSelfCls(classType, /* isClsParam */ false);
    const selfParam = FunctionParam.create(ParamCategory.Simple, selfType, FunctionParamFlags.TypeDeclared, 'self');
    FunctionType.addParam(initType, selfParam);
    if (isNamedTuple) {
        FunctionType.addDefaultParams(initType);
        initType.shared.flags |= FunctionTypeFlags.GradualCallableForm;
    }
    initType.shared.declaredReturnType = evaluator.getNoneType();

    // For Python 3.13 and newer, synthesize a __replace__ method.
    let replaceType: FunctionType | undefined;
    if (
        PythonVersion.isGreaterOrEqualTo(
            AnalyzerNodeInfo.getFileInfo(node).executionEnvironment.pythonVersion,
            pythonVersion3_13
        )
    ) {
        replaceType = FunctionType.createSynthesizedInstance('__replace__');
        FunctionType.addParam(replaceType, selfParam);
        FunctionType.addKeywordOnlyParamSeparator(replaceType);
        replaceType.shared.declaredReturnType = selfType;
    }

    // Maintain a list of all dataclass entries (including
    // those from inherited classes) plus a list of only those
    // entries added by this class.
    const localDataClassEntries: DataClassEntry[] = [];
    const fullDataClassEntries: DataClassEntry[] = [];
    const namedTupleEntries = new Set<string>();
    const allAncestorsKnown = addInheritedDataClassEntries(classType, fullDataClassEntries);

    if (!allAncestorsKnown) {
        // If one or more ancestor classes have an unknown type, we cannot
        // safely determine the parameter list, so we'll accept any parameters
        // to avoid a false positive.
        FunctionType.addDefaultParams(initType);

        if (replaceType) {
            FunctionType.addDefaultParams(replaceType);
        }
    }

    // Add field-based parameters to either the __new__ or __init__ method
    // based on whether this is a NamedTuple or a dataclass.
    const constructorType = isNamedTuple ? newType : initType;

    // Maintain a list of "type evaluators".
    type EntryTypeEvaluator = () => Type;
    const localEntryTypeEvaluator: { entry: DataClassEntry; evaluator: EntryTypeEvaluator }[] = [];
    let sawKeywordOnlySeparator = false;

    ClassType.getSymbolTable(classType).forEach((symbol, name) => {
        if (symbol.isIgnoredForProtocolMatch()) {
            return;
        }

        // Apparently, `__hash__` is special-cased in a dataclass. I can't find
        // this in the spec, but the runtime seems to treat is specially.
        if (name === '__hash__') {
            return;
        }

        let isInferredFinal = false;

        // Only variables (not functions, classes, etc.) are considered.
        let classVarDecl = symbol.getTypedDeclarations().find((decl) => {
            if (decl.type !== DeclarationType.Variable) {
                return false;
            }

            const container = getEnclosingClassOrFunction(decl.node);
            if (!container || container.nodeType !== ParseNodeType.Class) {
                return false;
            }

            return true;
        });

        // See if this is an unannotated (inferred) Final value.
        if (!classVarDecl) {
            classVarDecl = symbol.getDeclarations().find((decl) => {
                return decl.type === DeclarationType.Variable && !decl.typeAnnotationNode && decl.isFinal;
            });

            isInferredFinal = true;
        }

        if (classVarDecl) {
            let statement: ParseNode | undefined = classVarDecl.node;

            while (statement) {
                if (statement.nodeType === ParseNodeType.Assignment) {
                    break;
                }

                if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                    if (statement.parent?.nodeType === ParseNodeType.Assignment) {
                        statement = statement.parent;
                    }
                    break;
                }

                statement = statement.parent;
            }

            if (!statement) {
                return;
            }

            let variableNameNode: NameNode | undefined;
            let typeAnnotationNode: TypeAnnotationNode | undefined;
            let aliasName: string | undefined;
            let variableTypeEvaluator: EntryTypeEvaluator | undefined;
            let hasDefault = false;
            let isDefaultFactory = false;
            let isKeywordOnly = ClassType.isDataClassKeywordOnly(classType) || sawKeywordOnlySeparator;
            let defaultExpr: ExpressionNode | undefined;
            let includeInInit = true;
            let converter: ArgumentNode | undefined;

            if (statement.nodeType === ParseNodeType.Assignment) {
                if (
                    statement.d.leftExpr.nodeType === ParseNodeType.TypeAnnotation &&
                    statement.d.leftExpr.d.valueExpr.nodeType === ParseNodeType.Name
                ) {
                    variableNameNode = statement.d.leftExpr.d.valueExpr;
                    typeAnnotationNode = statement.d.leftExpr;
                    const assignmentStatement = statement;
                    variableTypeEvaluator = () => {
                        if (isInferredFinal && defaultExpr) {
                            return evaluator.getTypeOfExpression(defaultExpr).type;
                        }

                        return evaluator.getTypeOfAnnotation(
                            (assignmentStatement.d.leftExpr as TypeAnnotationNode).d.annotation,
                            {
                                varTypeAnnotation: true,
                                allowFinal: !isNamedTuple,
                                allowClassVar: !isNamedTuple,
                            }
                        );
                    };
                }

                hasDefault = true;
                defaultExpr = statement.d.rightExpr;

                // If the RHS of the assignment is assigning a field instance where the
                // "init" parameter is set to false, do not include it in the init method.
                if (!isNamedTuple && statement.d.rightExpr.nodeType === ParseNodeType.Call) {
                    const callTypeResult = evaluator.getTypeOfExpression(
                        statement.d.rightExpr.d.leftExpr,
                        EvalFlags.CallBaseDefaults
                    );
                    const callType = callTypeResult.type;

                    if (
                        !isNamedTuple &&
                        isDataclassFieldConstructor(
                            callType,
                            classType.shared.dataClassBehaviors?.fieldDescriptorNames || []
                        )
                    ) {
                        const initArg = statement.d.rightExpr.d.args.find((arg) => arg.d.name?.d.value === 'init');
                        if (initArg && initArg.d.valueExpr) {
                            const fileInfo = AnalyzerNodeInfo.getFileInfo(node);
                            includeInInit =
                                evaluateStaticBoolExpression(
                                    initArg.d.valueExpr,
                                    fileInfo.executionEnvironment,
                                    fileInfo.definedConstants
                                ) ?? includeInInit;
                        } else {
                            includeInInit =
                                getDefaultArgValueForFieldSpecifier(
                                    evaluator,
                                    statement.d.rightExpr,
                                    callTypeResult,
                                    'init'
                                ) ?? includeInInit;
                        }

                        const kwOnlyArg = statement.d.rightExpr.d.args.find((arg) => arg.d.name?.d.value === 'kw_only');
                        if (kwOnlyArg && kwOnlyArg.d.valueExpr) {
                            const fileInfo = AnalyzerNodeInfo.getFileInfo(node);
                            isKeywordOnly =
                                evaluateStaticBoolExpression(
                                    kwOnlyArg.d.valueExpr,
                                    fileInfo.executionEnvironment,
                                    fileInfo.definedConstants
                                ) ?? isKeywordOnly;
                        } else {
                            isKeywordOnly =
                                getDefaultArgValueForFieldSpecifier(
                                    evaluator,
                                    statement.d.rightExpr,
                                    callTypeResult,
                                    'kw_only'
                                ) ?? isKeywordOnly;
                        }

                        const defaultValueArg = statement.d.rightExpr.d.args.find(
                            (arg) => arg.d.name?.d.value === 'default'
                        );
                        hasDefault = !!defaultValueArg;
                        if (defaultValueArg?.d.valueExpr) {
                            defaultExpr = defaultValueArg.d.valueExpr;
                        }

                        const defaultFactoryArg = statement.d.rightExpr.d.args.find(
                            (arg) => arg.d.name?.d.value === 'default_factory' || arg.d.name?.d.value === 'factory'
                        );
                        if (defaultFactoryArg) {
                            hasDefault = true;
                            isDefaultFactory = true;
                        }
                        if (defaultFactoryArg?.d.valueExpr) {
                            defaultExpr = defaultFactoryArg.d.valueExpr;
                        }

                        const aliasArg = statement.d.rightExpr.d.args.find((arg) => arg.d.name?.d.value === 'alias');
                        if (aliasArg) {
                            const valueType = evaluator.getTypeOfExpression(aliasArg.d.valueExpr).type;
                            if (
                                isClassInstance(valueType) &&
                                ClassType.isBuiltIn(valueType, 'str') &&
                                isLiteralType(valueType)
                            ) {
                                aliasName = valueType.priv.literalValue as string;
                            }
                        }

                        const converterArg = statement.d.rightExpr.d.args.find(
                            (arg) => arg.d.name?.d.value === 'converter'
                        );
                        if (converterArg && converterArg.d.valueExpr) {
                            converter = converterArg;
                        }
                    }
                }
            } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                if (statement.d.valueExpr.nodeType === ParseNodeType.Name) {
                    variableNameNode = statement.d.valueExpr;
                    typeAnnotationNode = statement;
                    const annotationStatement = statement;
                    variableTypeEvaluator = () =>
                        evaluator.getTypeOfAnnotation(annotationStatement.d.annotation, {
                            varTypeAnnotation: true,
                            allowFinal: !isNamedTuple,
                            allowClassVar: !isNamedTuple,
                        });

                    // Is this a KW_ONLY separator introduced in Python 3.10?
                    if (!isNamedTuple && statement.d.valueExpr.d.value === '_') {
                        const annotatedType = variableTypeEvaluator();

                        if (isClassInstance(annotatedType) && ClassType.isBuiltIn(annotatedType, 'KW_ONLY')) {
                            sawKeywordOnlySeparator = true;
                            variableNameNode = undefined;
                            typeAnnotationNode = undefined;
                            variableTypeEvaluator = undefined;
                        }
                    }
                }
            }

            if (variableNameNode && variableTypeEvaluator) {
                const variableName = variableNameNode.d.value;

                // Named tuples don't allow attributes that begin with an underscore.
                if (isNamedTuple && variableName.startsWith('_')) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.namedTupleFieldUnderscore(),
                        variableNameNode
                    );
                    return;
                }

                // Don't include class vars. PEP 557 indicates that they shouldn't
                // be considered data class entries.
                const variableSymbol = ClassType.getSymbolTable(classType).get(variableName);
                namedTupleEntries.add(variableName);

                if (variableSymbol?.isClassVar()) {
                    // If an ancestor class declared an instance variable but this dataclass
                    // declares a ClassVar, delete the older one from the full data class entries.
                    const index = fullDataClassEntries.findIndex((p) => p.name === variableName);
                    if (index >= 0) {
                        fullDataClassEntries.splice(index, 1);
                    }
                    const dataClassEntry: DataClassEntry = {
                        name: variableName,
                        classType,
                        alias: aliasName,
                        isKeywordOnly: false,
                        hasDefault,
                        isDefaultFactory,
                        defaultExpr,
                        includeInInit,
                        nameNode: variableNameNode,
                        typeAnnotationNode: typeAnnotationNode,
                        type: UnknownType.create(),
                        isClassVar: true,
                        converter,
                    };
                    localDataClassEntries.push(dataClassEntry);
                } else {
                    // Create a new data class entry, but defer evaluation of the type until
                    // we've compiled the full list of data class entries for this class. This
                    // allows us to handle circular references in types.
                    const dataClassEntry: DataClassEntry = {
                        name: variableName,
                        classType,
                        alias: aliasName,
                        isKeywordOnly,
                        hasDefault,
                        isDefaultFactory,
                        defaultExpr,
                        includeInInit,
                        nameNode: variableNameNode,
                        typeAnnotationNode: typeAnnotationNode,
                        type: UnknownType.create(),
                        isClassVar: false,
                        converter,
                    };
                    localEntryTypeEvaluator.push({ entry: dataClassEntry, evaluator: variableTypeEvaluator });

                    // Add the new entry to the local entry list.
                    let insertIndex = localDataClassEntries.findIndex((e) => e.name === variableName);
                    if (insertIndex >= 0) {
                        localDataClassEntries[insertIndex] = dataClassEntry;
                    } else {
                        localDataClassEntries.push(dataClassEntry);
                    }

                    // Add the new entry to the full entry list.
                    insertIndex = fullDataClassEntries.findIndex((p) => p.name === variableName);
                    if (insertIndex >= 0) {
                        const oldEntry = fullDataClassEntries[insertIndex];

                        // While this isn't documented behavior, it appears that the dataclass implementation
                        // causes overridden variables to "inherit" default values from parent classes.
                        if (!dataClassEntry.hasDefault && oldEntry.hasDefault && oldEntry.includeInInit) {
                            dataClassEntry.hasDefault = true;
                            dataClassEntry.defaultExpr = oldEntry.defaultExpr;
                            hasDefault = true;

                            // Warn the user of this case because it can result in type errors if the
                            // default value is incompatible with the new type.
                            evaluator.addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.dataClassFieldInheritedDefault().format({ fieldName: variableName }),
                                variableNameNode
                            );
                        }

                        fullDataClassEntries[insertIndex] = dataClassEntry;
                    } else {
                        fullDataClassEntries.push(dataClassEntry);
                        insertIndex = fullDataClassEntries.length - 1;
                    }

                    // If we've already seen a entry with a default value defined,
                    // all subsequent entries must also have default values.
                    if (!isKeywordOnly && includeInInit && !skipSynthesizeInit && !hasDefault) {
                        const firstDefaultValueIndex = fullDataClassEntries.findIndex(
                            (p) => p.hasDefault && p.includeInInit && !p.isKeywordOnly
                        );
                        if (firstDefaultValueIndex >= 0 && firstDefaultValueIndex < insertIndex) {
                            evaluator.addDiagnostic(
                                DiagnosticRule.reportGeneralTypeIssues,
                                LocMessage.dataClassFieldWithDefault(),
                                variableNameNode
                            );
                        }
                    }
                }
            }
        } else {
            // The symbol had no declared type, so it is (mostly) ignored by dataclasses.
            // However, if it is assigned a field descriptor, it will result in a
            // runtime exception.
            const declarations = symbol.getDeclarations();
            if (declarations.length === 0) {
                return;
            }
            const lastDecl = declarations[declarations.length - 1];
            if (lastDecl.type !== DeclarationType.Variable) {
                return;
            }

            const statement = lastDecl.node.parent;
            if (!statement || statement.nodeType !== ParseNodeType.Assignment) {
                return;
            }

            // If the RHS of the assignment is assigning a field instance where the
            // "init" parameter is set to false, do not include it in the init method.
            if (!isNamedTuple && statement.d.rightExpr.nodeType === ParseNodeType.Call) {
                const callType = evaluator.getTypeOfExpression(
                    statement.d.rightExpr.d.leftExpr,
                    EvalFlags.CallBaseDefaults
                ).type;

                if (
                    isDataclassFieldConstructor(
                        callType,
                        classType.shared.dataClassBehaviors?.fieldDescriptorNames || []
                    )
                ) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassFieldWithoutAnnotation(),
                        statement.d.rightExpr
                    );
                }
            }
        }
    });

    if (isNamedTuple) {
        classType.shared.namedTupleEntries = namedTupleEntries;
    } else {
        classType.shared.dataClassEntries = localDataClassEntries;
    }

    // Now that the dataClassEntries field has been set with a complete list
    // of local data class entries for this class, perform deferred type
    // evaluations. This could involve circular type dependencies, so it's
    // required that the list be complete (even if types are not yet accurate)
    // before we perform the type evaluations.
    localEntryTypeEvaluator.forEach((entryEvaluator) => {
        entryEvaluator.entry.type = entryEvaluator.evaluator();
    });

    const symbolTable = ClassType.getSymbolTable(classType);
    const keywordOnlyParams: FunctionParam[] = [];

    if (!skipSynthesizeInit && !hasExistingInitMethod) {
        if (allAncestorsKnown) {
            fullDataClassEntries.forEach((entry) => {
                if (entry.includeInInit) {
                    let defaultType: Type | undefined;

                    // If the type refers to Self of the parent class, we need to
                    // transform it to refer to the Self of this subclass.
                    let effectiveType = entry.type;
                    if (entry.classType !== classType && requiresSpecialization(effectiveType)) {
                        const solution = new ConstraintSolution();
                        addSolutionForSelfType(solution, entry.classType, classType);
                        effectiveType = applySolvedTypeVars(effectiveType, solution);
                    }

                    // Is the field type a descriptor object? If so, we need to extract the corresponding
                    // type of the __init__ method parameter from the __set__ method.
                    effectiveType = transformDescriptorType(evaluator, effectiveType);

                    if (entry.converter) {
                        const fieldType = effectiveType;
                        effectiveType = getConverterInputType(evaluator, entry.converter, effectiveType, entry.name);
                        symbolTable.set(
                            entry.name,
                            getDescriptorForConverterField(
                                evaluator,
                                classType,
                                node,
                                entry.nameNode,
                                entry.converter,
                                entry.name,
                                fieldType,
                                effectiveType
                            )
                        );

                        if (entry.hasDefault) {
                            defaultType = entry.type;
                        }
                    } else {
                        if (entry.hasDefault) {
                            if (entry.isDefaultFactory || !entry.defaultExpr) {
                                defaultType = entry.type;
                            } else {
                                const defaultExpr = entry.defaultExpr;
                                const fileInfo = AnalyzerNodeInfo.getFileInfo(node);
                                const flags = fileInfo.isStubFile ? EvalFlags.ConvertEllipsisToAny : EvalFlags.None;
                                const liveTypeVars = getTypeVarScopesForNode(entry.defaultExpr);
                                const boundEffectiveType = makeTypeVarsBound(effectiveType, liveTypeVars);

                                // Use speculative mode here so we don't cache the results.
                                // We'll want to re-evaluate this expression later, potentially
                                // with different evaluation flags.
                                defaultType = evaluator.useSpeculativeMode(defaultExpr, () => {
                                    return evaluator.getTypeOfExpression(
                                        defaultExpr,
                                        flags,
                                        makeInferenceContext(boundEffectiveType)
                                    ).type;
                                });

                                defaultType = makeTypeVarsFree(defaultType, liveTypeVars);

                                if (entry.mroClass && requiresSpecialization(defaultType)) {
                                    const solution = buildSolutionFromSpecializedClass(entry.mroClass);
                                    defaultType = applySolvedTypeVars(defaultType, solution);
                                }
                            }
                        }
                    }

                    const effectiveName = entry.alias || entry.name;

                    if (!entry.alias && entry.nameNode && isPrivateName(entry.nameNode.d.value)) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.dataClassFieldWithPrivateName(),
                            entry.nameNode
                        );
                    }

                    const param = FunctionParam.create(
                        ParamCategory.Simple,
                        effectiveType,
                        FunctionParamFlags.TypeDeclared,
                        effectiveName,
                        defaultType,
                        entry.defaultExpr
                    );

                    if (entry.isKeywordOnly) {
                        keywordOnlyParams.push(param);
                    } else {
                        FunctionType.addParam(constructorType, param);
                    }

                    if (replaceType) {
                        const paramWithDefault = FunctionParam.create(
                            param.category,
                            param._type,
                            param.flags,
                            param.name,
                            AnyType.create(/* isEllipsis */ true)
                        );

                        FunctionType.addParam(replaceType, paramWithDefault);
                    }
                }
            });

            if (keywordOnlyParams.length > 0) {
                FunctionType.addKeywordOnlyParamSeparator(constructorType);
                keywordOnlyParams.forEach((param) => {
                    FunctionType.addParam(constructorType, param);
                });
            }
        }

        symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
        symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));

        if (replaceType) {
            symbolTable.set('__replace__', Symbol.createWithType(SymbolFlags.ClassMember, replaceType));
        }
    }

    // Synthesize the __match_args__ class variable if it doesn't exist.
    const strType = evaluator.getBuiltInType(node, 'str');
    const tupleClassType = evaluator.getBuiltInType(node, 'tuple');
    if (
        tupleClassType &&
        isInstantiableClass(tupleClassType) &&
        strType &&
        isInstantiableClass(strType) &&
        !symbolTable.has('__match_args__')
    ) {
        const matchArgsNames: string[] = [];
        fullDataClassEntries.forEach((entry) => {
            if (entry.includeInInit && !entry.isKeywordOnly) {
                // Use the field name, not its alias (if it has one).
                matchArgsNames.push(entry.name);
            }
        });
        const literalTypes: TupleTypeArg[] = matchArgsNames.map((name) => {
            return { type: ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strType, name)), isUnbounded: false };
        });
        const matchArgsType = ClassType.cloneAsInstance(specializeTupleClass(tupleClassType, literalTypes));
        symbolTable.set('__match_args__', Symbol.createWithType(SymbolFlags.ClassMember, matchArgsType));
    }

    const synthesizeComparisonMethod = (operator: string, paramType: Type) => {
        const operatorMethod = FunctionType.createSynthesizedInstance(operator);
        FunctionType.addParam(operatorMethod, selfParam);
        FunctionType.addParam(
            operatorMethod,
            FunctionParam.create(ParamCategory.Simple, paramType, FunctionParamFlags.TypeDeclared, 'other')
        );
        operatorMethod.shared.declaredReturnType = evaluator.getBuiltInObject(node, 'bool');
        // If a method of this name already exists, don't override it.
        if (!symbolTable.get(operator)) {
            symbolTable.set(operator, Symbol.createWithType(SymbolFlags.ClassMember, operatorMethod));
        }
    };

    // Synthesize comparison operators.
    if (!ClassType.isDataClassSkipGenerateEq(classType)) {
        synthesizeComparisonMethod('__eq__', evaluator.getBuiltInObject(node, 'object'));
    }

    if (ClassType.isDataClassGenerateOrder(classType)) {
        ['__lt__', '__le__', '__gt__', '__ge__'].forEach((operator) => {
            synthesizeComparisonMethod(operator, selfType);
        });
    }

    let synthesizeHashFunction = ClassType.isDataClassFrozen(classType);
    const synthesizeHashNone =
        !isNamedTuple && !ClassType.isDataClassSkipGenerateEq(classType) && !ClassType.isDataClassFrozen(classType);

    if (skipSynthesizeHash) {
        synthesizeHashFunction = false;
    }

    // If the user has indicated that a hash function should be generated even if it's unsafe
    // to do so or there is already a hash function present, override the default logic.
    if (ClassType.isDataClassGenerateHash(classType)) {
        synthesizeHashFunction = true;
    }

    if (synthesizeHashFunction) {
        const hashMethod = FunctionType.createSynthesizedInstance('__hash__');
        FunctionType.addParam(hashMethod, selfParam);
        hashMethod.shared.declaredReturnType = evaluator.getBuiltInObject(node, 'int');
        symbolTable.set(
            '__hash__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForOverrideChecks, hashMethod)
        );
    } else if (synthesizeHashNone && !skipSynthesizeHash) {
        symbolTable.set(
            '__hash__',
            Symbol.createWithType(
                SymbolFlags.ClassMember | SymbolFlags.IgnoredForOverrideChecks,
                evaluator.getNoneType()
            )
        );
    }

    let dictType = evaluator.getBuiltInType(node, 'dict');
    if (isInstantiableClass(dictType)) {
        dictType = ClassType.cloneAsInstance(
            ClassType.specialize(dictType, [evaluator.getBuiltInObject(node, 'str'), AnyType.create()])
        );
    }

    if (!isNamedTuple) {
        symbolTable.set(
            '__dataclass_fields__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.ClassVar, dictType)
        );
    }

    if (ClassType.isDataClassGenerateSlots(classType) && classType.shared.localSlotsNames === undefined) {
        classType.shared.localSlotsNames = localDataClassEntries.map((entry) => entry.name);
    }

    // Should we synthesize a __slots__ symbol?
    if (ClassType.isDataClassGenerateSlots(classType)) {
        let iterableType = evaluator.getTypingType(node, 'Iterable') ?? UnknownType.create();

        if (isInstantiableClass(iterableType)) {
            iterableType = ClassType.cloneAsInstance(
                ClassType.specialize(iterableType, [evaluator.getBuiltInObject(node, 'str')])
            );
        }

        symbolTable.set(
            '__slots__',
            Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.ClassVar, iterableType)
        );
    }

    // If this dataclass derived from a NamedTuple, update the NamedTuple with
    // the specialized entry types.
    if (
        updateNamedTupleBaseClass(
            classType,
            fullDataClassEntries.map((entry) => entry.type),
            /* isTypeArgExplicit */ true
        )
    ) {
        // Recompute the MRO based on the updated NamedTuple base class.
        computeMroLinearization(classType);
    }
}

// If a field specifier is used to define a field, it may define a default
// argument value (either True or False) for a supported keyword parameter.
// This function extracts that default value if present and returns it. If
// it's not present, it returns undefined.
function getDefaultArgValueForFieldSpecifier(
    evaluator: TypeEvaluator,
    callNode: CallNode,
    callTypeResult: TypeResult,
    paramName: string
): boolean | undefined {
    const callType = callTypeResult.type;
    let callTarget: FunctionType | undefined;

    if (isFunction(callType)) {
        callTarget = callType;
    } else if (isOverloaded(callType)) {
        callTarget = evaluator.getBestOverloadForArgs(
            callNode,
            { type: callType, isIncomplete: callTypeResult.isIncomplete },
            callNode.d.args.map((arg) => evaluator.convertNodeToArg(arg))
        );
    } else if (isInstantiableClass(callType)) {
        const initMethodResult = getBoundInitMethod(evaluator, callNode, callType);
        if (initMethodResult) {
            if (isFunction(initMethodResult.type)) {
                callTarget = initMethodResult.type;
            } else if (isOverloaded(initMethodResult.type)) {
                callTarget = evaluator.getBestOverloadForArgs(
                    callNode,
                    { type: initMethodResult.type },
                    callNode.d.args.map((arg) => evaluator.convertNodeToArg(arg))
                );
            }
        }
    }

    if (callTarget) {
        const initParamIndex = callTarget.shared.parameters.findIndex((p) => p.name === paramName);
        if (initParamIndex >= 0) {
            const initParam = callTarget.shared.parameters[initParamIndex];

            // Is the parameter type a literal bool?
            const initParamType = FunctionType.getParamType(callTarget, initParamIndex);
            if (
                FunctionParam.isTypeDeclared(initParam) &&
                isClass(initParamType) &&
                typeof initParamType.priv.literalValue === 'boolean'
            ) {
                return initParamType.priv.literalValue;
            }

            // Is the default argument value a literal bool?
            const initParamDefaultType = FunctionType.getParamDefaultType(callTarget, initParamIndex);
            if (
                initParamDefaultType &&
                isClass(initParamDefaultType) &&
                typeof initParamDefaultType.priv.literalValue === 'boolean'
            ) {
                return initParamDefaultType.priv.literalValue;
            }
        }
    }

    return undefined;
}

// Validates converter and, if valid, returns its input type. If invalid,
// fieldType is returned.
function getConverterInputType(
    evaluator: TypeEvaluator,
    converterNode: ArgumentNode,
    fieldType: Type,
    fieldName: string
): Type {
    // Use speculative mode here so we don't cache the results.
    // We'll want to re-evaluate this expression later, potentially
    // with different evaluation flags.
    const valueType = evaluator.useSpeculativeMode(converterNode.d.valueExpr, () => {
        return evaluator.getTypeOfExpression(converterNode.d.valueExpr, EvalFlags.NoSpecialize).type;
    });

    const converterType = getConverterAsFunction(evaluator, valueType);

    if (!converterType) {
        return fieldType;
    }

    // Create synthesized function of the form Callable[[T], fieldType] which
    // will be used to check compatibility of the provided converter.
    const typeVar = TypeVarType.createInstance('__converterInput');
    typeVar.priv.scopeId = getScopeIdForNode(converterNode);
    const targetFunction = FunctionType.createSynthesizedInstance('');
    targetFunction.shared.typeVarScopeId = typeVar.priv.scopeId;
    targetFunction.shared.declaredReturnType = fieldType;
    FunctionType.addParam(
        targetFunction,
        FunctionParam.create(
            ParamCategory.Simple,
            typeVar,
            FunctionParamFlags.TypeDeclared | FunctionParamFlags.NameSynthesized,
            '__input'
        )
    );
    FunctionType.addPositionOnlyParamSeparator(targetFunction);

    if (isFunctionOrOverloaded(converterType)) {
        const acceptedTypes: Type[] = [];
        const diagAddendum = new DiagnosticAddendum();

        doForEachSignature(converterType, (signature) => {
            const returnConstraints = new ConstraintTracker();

            if (
                evaluator.assignType(
                    FunctionType.getEffectiveReturnType(signature) ?? UnknownType.create(),
                    fieldType,
                    /* diag */ undefined,
                    returnConstraints
                )
            ) {
                signature = evaluator.solveAndApplyConstraints(signature, returnConstraints) as FunctionType;
            }

            const inputConstraints = new ConstraintTracker();

            if (evaluator.assignType(targetFunction, signature, diagAddendum, inputConstraints)) {
                const overloadSolution = evaluator.solveAndApplyConstraints(typeVar, inputConstraints, {
                    replaceUnsolved: {
                        scopeIds: getTypeVarScopeIds(typeVar),
                        tupleClassType: evaluator.getTupleClassType(),
                    },
                });
                acceptedTypes.push(overloadSolution);
            }
        });

        if (acceptedTypes.length > 0) {
            return combineTypes(acceptedTypes);
        }

        if (isFunction(converterType)) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.dataClassConverterFunction().format({
                    argType: evaluator.printType(converterType),
                    fieldType: evaluator.printType(fieldType),
                    fieldName: fieldName,
                }) + diagAddendum.getString(),
                converterNode,
                diagAddendum.getEffectiveTextRange() ?? converterNode
            );
        } else {
            const overloads = OverloadedType.getOverloads(converterType);
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.dataClassConverterOverloads().format({
                    funcName:
                        overloads.length > 0 && overloads[0].shared.name
                            ? overloads[0].shared.name
                            : '<anonymous function>',
                    fieldType: evaluator.printType(fieldType),
                    fieldName: fieldName,
                }) + diagAddendum.getString(),
                converterNode
            );
        }
    }

    return fieldType;
}

function getConverterAsFunction(
    evaluator: TypeEvaluator,
    converterType: Type
): FunctionType | OverloadedType | undefined {
    if (isFunctionOrOverloaded(converterType)) {
        return converterType;
    }

    if (isClassInstance(converterType)) {
        return evaluator.getBoundMagicMethod(converterType, '__call__');
    }

    if (isInstantiableClass(converterType)) {
        let fromConstructor = createFunctionFromConstructor(evaluator, converterType);
        if (fromConstructor) {
            // If conversion to a constructor resulted in a union type, we'll
            // choose the first of the two subtypes, which typically corresponds
            // to the __init__ method (rather than the __new__ method).
            if (isUnion(fromConstructor)) {
                fromConstructor = fromConstructor.priv.subtypes[0];
            }

            if (isFunctionOrOverloaded(fromConstructor)) {
                return fromConstructor;
            }
        }
    }

    return undefined;
}

// Synthesizes an asymmetric descriptor class to be used in place of the
// annotated type of a field with a converter. The descriptor's __get__ method
// returns the declared type of the field and its __set__ method accepts the
// converter's input type. Returns the symbol for an instance of this descriptor
// type.
function getDescriptorForConverterField(
    evaluator: TypeEvaluator,
    dataclass: ClassType,
    dataclassNode: ParseNode,
    fieldNameNode: NameNode | undefined,
    converterNode: ParseNode,
    fieldName: string,
    getType: Type,
    setType: Type
): Symbol {
    const fileInfo = getFileInfo(dataclassNode);
    const typeMetaclass = evaluator.getBuiltInType(dataclassNode, 'type');
    const descriptorName = `__converterDescriptor_${fieldName}`;

    const descriptorClass = ClassType.createInstantiable(
        descriptorName,
        getClassFullName(converterNode, fileInfo.moduleName, descriptorName),
        fileInfo.moduleName,
        fileInfo.fileUri,
        ClassTypeFlags.None,
        getTypeSourceId(converterNode),
        /* declaredMetaclass */ undefined,
        isInstantiableClass(typeMetaclass) ? typeMetaclass : UnknownType.create()
    );

    const scopeId = getScopeIdForNode(converterNode);
    descriptorClass.shared.typeVarScopeId = scopeId;

    // Make the descriptor generic, copying the type parameters from the dataclass.
    descriptorClass.shared.typeParams = dataclass.shared.typeParams.map((typeParm) => {
        const typeParam = TypeVarType.cloneForScopeId(
            typeParm,
            scopeId,
            descriptorClass.shared.name,
            TypeVarScopeType.Class
        );
        typeParam.priv.computedVariance = Variance.Covariant;
        return typeParam;
    });

    const solution = buildSolution(dataclass.shared.typeParams, descriptorClass.shared.typeParams);
    getType = applySolvedTypeVars(getType, solution);
    setType = applySolvedTypeVars(setType, solution);

    descriptorClass.shared.baseClasses.push(evaluator.getBuiltInType(dataclassNode, 'object'));
    computeMroLinearization(descriptorClass);

    const fields = ClassType.getSymbolTable(descriptorClass);
    const selfType = synthesizeTypeVarForSelfCls(descriptorClass, /* isClsParam */ false);

    const setFunction = FunctionType.createSynthesizedInstance('__set__');
    FunctionType.addParam(
        setFunction,
        FunctionParam.create(ParamCategory.Simple, selfType, FunctionParamFlags.TypeDeclared, 'self')
    );
    FunctionType.addParam(
        setFunction,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'obj')
    );
    FunctionType.addParam(
        setFunction,
        FunctionParam.create(ParamCategory.Simple, setType, FunctionParamFlags.TypeDeclared, 'value')
    );
    setFunction.shared.declaredReturnType = evaluator.getNoneType();
    const setSymbol = Symbol.createWithType(SymbolFlags.ClassMember, setFunction);
    fields.set('__set__', setSymbol);

    const getFunction = FunctionType.createSynthesizedInstance('__get__');
    FunctionType.addParam(
        getFunction,
        FunctionParam.create(ParamCategory.Simple, selfType, FunctionParamFlags.TypeDeclared, 'self')
    );
    FunctionType.addParam(
        getFunction,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'obj')
    );
    FunctionType.addParam(
        getFunction,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'objtype')
    );
    getFunction.shared.declaredReturnType = getType;
    const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunction);
    fields.set('__get__', getSymbol);

    const descriptorInstance = ClassType.specialize(ClassType.cloneAsInstance(descriptorClass), [
        ...dataclass.shared.typeParams,
    ]);

    return Symbol.createWithType(SymbolFlags.ClassMember, descriptorInstance, fieldNameNode);
}

// If the specified type is a descriptor — in particular, if it implements a
// __set__ method, this method transforms the type into the input parameter
// for the set method.
function transformDescriptorType(evaluator: TypeEvaluator, type: Type): Type {
    if (!isClassInstance(type) || isMetaclassInstance(type)) {
        return type;
    }

    const setMethodType = evaluator.getBoundMagicMethod(type, '__set__');
    if (!setMethodType) {
        return type;
    }

    if (!isFunction(setMethodType)) {
        return type;
    }

    // The value parameter for a bound __set__ method is parameter index 1.
    return FunctionType.getParamType(setMethodType, 1);
}

// Builds a sorted list of dataclass entries that are inherited by
// the specified class. These entries must be unique and in reverse-MRO
// order. Returns true if all of the class types in the hierarchy are
// known, false if one or more are unknown.
export function addInheritedDataClassEntries(classType: ClassType, entries: DataClassEntry[]) {
    let allAncestorsAreKnown = true;

    ClassType.getReverseMro(classType).forEach((mroClass) => {
        if (isInstantiableClass(mroClass)) {
            const solution = buildSolutionFromSpecializedClass(mroClass);
            const dataClassEntries = ClassType.getDataClassEntries(mroClass);

            // Add the entries to the end of the list, replacing same-named
            // entries if found.
            dataClassEntries.forEach((entry) => {
                const existingIndex = entries.findIndex((e) => e.name === entry.name);

                // If the type from the parent class is generic, we need to convert
                // to the type parameter namespace of child class.
                const updatedEntry = { ...entry, mroClass };
                updatedEntry.type = applySolvedTypeVars(updatedEntry.type, solution);

                if (entry.isClassVar) {
                    // If this entry is a class variable, it overrides an existing
                    // instance variable, so delete it.
                    if (existingIndex >= 0) {
                        entries.splice(existingIndex, 1);
                    }
                } else if (existingIndex >= 0) {
                    entries[existingIndex] = updatedEntry;
                } else {
                    entries.push(updatedEntry);
                }
            });
        } else {
            allAncestorsAreKnown = false;
        }
    });

    return allAncestorsAreKnown;
}

function isDataclassFieldConstructor(type: Type, fieldDescriptorNames: string[]) {
    let callName: string | undefined;

    if (isFunction(type)) {
        callName = type.shared.fullName;
    } else if (isOverloaded(type)) {
        const overloads = OverloadedType.getOverloads(type);
        if (overloads.length > 0) {
            callName = overloads[0].shared.fullName;
        }
    } else if (isInstantiableClass(type)) {
        callName = type.shared.fullName;
    }

    if (!callName) {
        return false;
    }

    return fieldDescriptorNames.some((name) => name === callName);
}

export function validateDataClassTransformDecorator(
    evaluator: TypeEvaluator,
    node: CallNode
): DataClassBehaviors | undefined {
    const behaviors: DataClassBehaviors = {
        skipGenerateInit: false,
        skipGenerateEq: false,
        generateOrder: false,
        generateSlots: false,
        generateHash: false,
        keywordOnly: false,
        frozen: false,
        frozenDefault: false,
        fieldDescriptorNames: [],
    };

    const fileInfo = AnalyzerNodeInfo.getFileInfo(node);

    // Parse the arguments to the call.
    node.d.args.forEach((arg) => {
        if (!arg.d.name || arg.d.argCategory !== ArgCategory.Simple) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportCallIssue,
                LocMessage.dataClassTransformPositionalParam(),
                arg
            );
            return;
        }

        switch (arg.d.name.d.value) {
            case 'kw_only_default': {
                const value = evaluateStaticBoolExpression(
                    arg.d.valueExpr,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );
                if (value === undefined) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformExpectedBoolLiteral(),
                        arg.d.valueExpr
                    );
                    return;
                }

                behaviors.keywordOnly = value;
                break;
            }

            case 'eq_default': {
                const value = evaluateStaticBoolExpression(
                    arg.d.valueExpr,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );
                if (value === undefined) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformExpectedBoolLiteral(),
                        arg.d.valueExpr
                    );
                    return;
                }

                behaviors.skipGenerateEq = !value;
                break;
            }

            case 'order_default': {
                const value = evaluateStaticBoolExpression(
                    arg.d.valueExpr,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );
                if (value === undefined) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformExpectedBoolLiteral(),
                        arg.d.valueExpr
                    );
                    return;
                }

                behaviors.generateOrder = value;
                break;
            }

            case 'frozen_default': {
                const value = evaluateStaticBoolExpression(
                    arg.d.valueExpr,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );
                if (value === undefined) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformExpectedBoolLiteral(),
                        arg.d.valueExpr
                    );
                    return;
                }

                behaviors.frozen = value;

                // Store the frozen default separately because any class that
                // doesn't explicitly specify a frozen value will inherit this
                // value rather than the value from its parent.
                behaviors.frozenDefault = value;
                break;
            }

            // Earlier versions of the dataclass_transform spec used the name "field_descriptors"
            // rather than "field_specifiers". The older name is now deprecated but still supported
            // for the time being because some libraries shipped with the older __dataclass_transform__
            // form that supported this older parameter name.
            case 'field_descriptors':
            case 'field_specifiers': {
                const valueType = evaluator.getTypeOfExpression(arg.d.valueExpr).type;
                if (
                    !isClassInstance(valueType) ||
                    !ClassType.isBuiltIn(valueType, 'tuple') ||
                    !valueType.priv.tupleTypeArgs ||
                    valueType.priv.tupleTypeArgs.some(
                        (entry) => !isInstantiableClass(entry.type) && !isFunctionOrOverloaded(entry.type)
                    )
                ) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformFieldSpecifier().format({
                            type: evaluator.printType(valueType),
                        }),
                        arg.d.valueExpr
                    );
                    return;
                }

                valueType.priv.tupleTypeArgs.forEach((arg) => {
                    if (isInstantiableClass(arg.type) || isFunction(arg.type)) {
                        behaviors.fieldDescriptorNames.push(arg.type.shared.fullName);
                    } else if (isOverloaded(arg.type)) {
                        const overloads = OverloadedType.getOverloads(arg.type);
                        if (overloads.length > 0) {
                            behaviors.fieldDescriptorNames.push(overloads[0].shared.fullName);
                        }
                    }
                });
                break;
            }

            default:
                evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.dataClassTransformUnknownArgument().format({ name: arg.d.name.d.value }),
                    arg.d.valueExpr
                );
                break;
        }
    });

    return behaviors;
}

export function getDataclassDecoratorBehaviors(type: Type): DataClassBehaviors | undefined {
    let functionType: FunctionType | undefined;
    if (isFunction(type)) {
        functionType = type;
    } else if (isOverloaded(type)) {
        // Find the first overload or implementation that contains a
        // dataclass_transform decorator. If more than one have such a decorator,
        // only the first one will be honored, as per PEP 681.
        const overloads = OverloadedType.getOverloads(type);
        const impl = OverloadedType.getImplementation(type);

        functionType = overloads.find((overload) => !!overload.shared.decoratorDataClassBehaviors);

        if (!functionType && impl && isFunction(impl) && impl.shared.decoratorDataClassBehaviors) {
            functionType = impl;
        }

        if (!functionType && overloads.length > 0) {
            functionType = overloads[0];
        }
    }

    if (!functionType) {
        return undefined;
    }

    if (functionType.shared.decoratorDataClassBehaviors) {
        return functionType.shared.decoratorDataClassBehaviors;
    }

    // Is this the built-in dataclass? If so, return the default behaviors.
    if (functionType.shared.fullName === 'dataclasses.dataclass') {
        return {
            fieldDescriptorNames: ['dataclasses.field', 'dataclasses.Field'],
        };
    }

    return undefined;
}

function applyDataClassBehaviorOverride(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    argName: string,
    argValueExpr: ExpressionNode,
    behaviors: DataClassBehaviors
) {
    const fileInfo = AnalyzerNodeInfo.getFileInfo(errorNode);
    const value = evaluateStaticBoolExpression(argValueExpr, fileInfo.executionEnvironment, fileInfo.definedConstants);

    applyDataClassBehaviorOverrideValue(evaluator, errorNode, classType, argName, value, behaviors);
}

function applyDataClassBehaviorOverrideValue(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    argName: string,
    argValue: boolean | undefined,
    behaviors: DataClassBehaviors
) {
    switch (argName) {
        case 'order':
            if (argValue !== undefined) {
                behaviors.generateOrder = argValue;
            }
            break;

        case 'kw_only':
            if (argValue !== undefined) {
                behaviors.keywordOnly = argValue;
            }
            break;

        case 'frozen': {
            let hasUnfrozenBaseClass = false;
            let hasFrozenBaseClass = false;

            if (argValue !== undefined) {
                behaviors.frozen = argValue;
            }

            classType.shared.baseClasses.forEach((baseClass) => {
                if (isInstantiableClass(baseClass) && ClassType.isDataClass(baseClass)) {
                    if (ClassType.isDataClassFrozen(baseClass)) {
                        hasFrozenBaseClass = true;
                    } else if (
                        !baseClass.shared.classDataClassTransform &&
                        !(
                            baseClass.shared.declaredMetaclass &&
                            isInstantiableClass(baseClass.shared.declaredMetaclass) &&
                            !!baseClass.shared.declaredMetaclass.shared.classDataClassTransform
                        )
                    ) {
                        // If this base class is unfrozen and isn't the class that directly
                        // references the metaclass that provides dataclass-like behaviors,
                        // we'll assume we're deriving from an unfrozen dataclass.
                        hasUnfrozenBaseClass = true;
                    }
                }
            });

            if (argValue) {
                // A frozen dataclass cannot derive from a non-frozen dataclass.
                if (hasUnfrozenBaseClass) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassBaseClassNotFrozen(),
                        errorNode
                    );
                }
            } else {
                // A non-frozen dataclass cannot derive from a frozen dataclass.
                if (hasFrozenBaseClass) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassBaseClassFrozen(),
                        errorNode
                    );
                }
            }
            break;
        }

        case 'init':
            if (argValue !== undefined) {
                behaviors.skipGenerateInit = !argValue;
            }
            break;

        case 'eq':
            if (argValue !== undefined) {
                behaviors.skipGenerateEq = !argValue;
            }
            break;

        case 'slots':
            if (argValue === true) {
                behaviors.generateSlots = true;

                if (classType.shared.localSlotsNames) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassSlotsOverwrite(),
                        errorNode
                    );
                }
            } else if (argValue === false) {
                behaviors.generateSlots = false;
            }
            break;

        case 'hash':
        case 'unsafe_hash':
            if (argValue === true) {
                behaviors.generateHash = true;
            }
            break;
    }
}

export function applyDataClassClassBehaviorOverrides(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    args: Arg[],
    defaultBehaviors: DataClassBehaviors
) {
    let sawFrozenArg = false;

    const behaviors = { ...defaultBehaviors };

    // The "frozen" behavior is not inherited from the parent class.
    // Instead, it comes from the default.
    behaviors.frozen = behaviors.frozenDefault;

    classType.shared.dataClassBehaviors = behaviors;

    args.forEach((arg) => {
        if (arg.valueExpression && arg.name) {
            applyDataClassBehaviorOverride(
                evaluator,
                arg.name,
                classType,
                arg.name.d.value,
                arg.valueExpression,
                behaviors
            );

            if (arg.name.d.value === 'frozen') {
                sawFrozenArg = true;
            }
        }
    });

    // If there was no frozen argument, it is implicitly set to the frozenDefault.
    // This check validates that we're not overriding a frozen class with a
    // non-frozen class or vice versa.
    if (!sawFrozenArg) {
        applyDataClassBehaviorOverrideValue(
            evaluator,
            errorNode,
            classType,
            'frozen',
            defaultBehaviors.frozenDefault,
            behaviors
        );
    }
}

export function applyDataClassDecorator(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    defaultBehaviors: DataClassBehaviors,
    callNode: CallNode | undefined
) {
    applyDataClassClassBehaviorOverrides(
        evaluator,
        errorNode,
        classType,
        (callNode?.d.args ?? []).map((arg) => evaluator.convertNodeToArg(arg)),
        defaultBehaviors
    );
}
