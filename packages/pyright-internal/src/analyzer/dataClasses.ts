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
import { LocMessage } from '../localization/localize';
import {
    ArgumentCategory,
    ArgumentNode,
    CallNode,
    ClassNode,
    ExpressionNode,
    NameNode,
    ParameterCategory,
    ParseNode,
    ParseNodeType,
    TypeAnnotationNode,
} from '../parser/parseNodes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { getFileInfo } from './analyzerNodeInfo';
import { createFunctionFromConstructor, getBoundInitMethod } from './constructors';
import { DeclarationType } from './declaration';
import { updateNamedTupleBaseClass } from './namedTuples';
import { getClassFullName, getEnclosingClassOrFunction, getScopeIdForNode, getTypeSourceId } from './parseTreeUtils';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol, SymbolFlags } from './symbol';
import { isPrivateName } from './symbolNameUtils';
import { EvaluatorFlags, FunctionArgument, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    DataClassBehaviors,
    DataClassEntry,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isOverloadedFunction,
    isUnion,
    OverloadedFunctionType,
    TupleTypeArgument,
    Type,
    TypeVarType,
    UnknownType,
} from './types';
import {
    applySolvedTypeVars,
    buildTypeVarContextFromSpecializedClass,
    computeMroLinearization,
    convertToInstance,
    doForEachSignature,
    getTypeVarScopeId,
    getTypeVarScopeIds,
    isLiteralType,
    isMetaclassInstance,
    populateTypeVarContextForSelfType,
    requiresSpecialization,
    specializeTupleClass,
    synthesizeTypeVarForSelfCls,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';

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
    assert(ClassType.isDataClass(classType));

    const classTypeVar = synthesizeTypeVarForSelfCls(classType, /* isClsParam */ true);
    const newType = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.ConstructorMethod);
    newType.details.constructorTypeVarScopeId = classType.details.typeVarScopeId;
    const initType = FunctionType.createSynthesizedInstance('__init__');
    initType.details.constructorTypeVarScopeId = classType.details.typeVarScopeId;

    // Generate both a __new__ and an __init__ method. The parameters of the
    // __new__ method are based on field definitions for NamedTuple classes,
    // and the parameters of the __init__ method are based on field definitions
    // in other cases.
    FunctionType.addParameter(newType, {
        category: ParameterCategory.Simple,
        name: 'cls',
        type: classTypeVar,
        hasDeclaredType: true,
    });
    if (!isNamedTuple) {
        FunctionType.addDefaultParameters(newType);
    }
    newType.details.declaredReturnType = convertToInstance(classTypeVar);

    const selfParam: FunctionParameter = {
        category: ParameterCategory.Simple,
        name: 'self',
        type: synthesizeTypeVarForSelfCls(classType, /* isClsParam */ false),
        hasDeclaredType: true,
    };
    FunctionType.addParameter(initType, selfParam);
    if (isNamedTuple) {
        FunctionType.addDefaultParameters(initType);
    }
    initType.details.declaredReturnType = evaluator.getNoneType();

    // Maintain a list of all dataclass entries (including
    // those from inherited classes) plus a list of only those
    // entries added by this class.
    const localDataClassEntries: DataClassEntry[] = [];
    const fullDataClassEntries: DataClassEntry[] = [];
    const allAncestorsKnown = addInheritedDataClassEntries(classType, fullDataClassEntries);

    if (!allAncestorsKnown) {
        // If one or more ancestor classes have an unknown type, we cannot
        // safely determine the parameter list, so we'll accept any parameters
        // to avoid a false positive.
        FunctionType.addDefaultParameters(initType);
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

        // Only variables (not functions, classes, etc.) are considered.
        const classVarDecl = symbol.getTypedDeclarations().find((decl) => {
            if (decl.type !== DeclarationType.Variable) {
                return false;
            }

            const container = getEnclosingClassOrFunction(decl.node);
            if (!container || container.nodeType !== ParseNodeType.Class) {
                return false;
            }

            return true;
        });

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
            let aliasName: string | undefined;
            let variableTypeEvaluator: EntryTypeEvaluator | undefined;
            let hasDefaultValue = false;
            let isKeywordOnly = ClassType.isDataClassKeywordOnlyParams(classType) || sawKeywordOnlySeparator;
            let defaultValueExpression: ExpressionNode | undefined;
            let includeInInit = true;
            let converter: ArgumentNode | undefined;

            if (statement.nodeType === ParseNodeType.Assignment) {
                if (
                    statement.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                    statement.leftExpression.valueExpression.nodeType === ParseNodeType.Name
                ) {
                    variableNameNode = statement.leftExpression.valueExpression;
                    const assignmentStatement = statement;
                    variableTypeEvaluator = () =>
                        evaluator.getTypeOfAnnotation(
                            (assignmentStatement.leftExpression as TypeAnnotationNode).typeAnnotation,
                            {
                                isVariableAnnotation: true,
                                allowFinal: true,
                                allowClassVar: true,
                            }
                        );
                }

                hasDefaultValue = true;
                defaultValueExpression = statement.rightExpression;

                // If the RHS of the assignment is assigning a field instance where the
                // "init" parameter is set to false, do not include it in the init method.
                if (statement.rightExpression.nodeType === ParseNodeType.Call) {
                    const callTypeResult = evaluator.getTypeOfExpression(
                        statement.rightExpression.leftExpression,
                        EvaluatorFlags.CallBaseDefaults
                    );
                    const callType = callTypeResult.type;

                    if (
                        !isNamedTuple &&
                        isDataclassFieldConstructor(
                            callType,
                            classType.details.dataClassBehaviors?.fieldDescriptorNames || []
                        )
                    ) {
                        const initArg = statement.rightExpression.arguments.find((arg) => arg.name?.value === 'init');
                        if (initArg && initArg.valueExpression) {
                            const fileInfo = AnalyzerNodeInfo.getFileInfo(node);
                            includeInInit =
                                evaluateStaticBoolExpression(
                                    initArg.valueExpression,
                                    fileInfo.executionEnvironment,
                                    fileInfo.definedConstants
                                ) ?? includeInInit;
                        } else {
                            includeInInit =
                                getDefaultArgValueForFieldSpecifier(
                                    evaluator,
                                    statement.rightExpression,
                                    callTypeResult,
                                    'init'
                                ) ?? includeInInit;
                        }

                        const kwOnlyArg = statement.rightExpression.arguments.find(
                            (arg) => arg.name?.value === 'kw_only'
                        );
                        if (kwOnlyArg && kwOnlyArg.valueExpression) {
                            const fileInfo = AnalyzerNodeInfo.getFileInfo(node);
                            isKeywordOnly =
                                evaluateStaticBoolExpression(
                                    kwOnlyArg.valueExpression,
                                    fileInfo.executionEnvironment,
                                    fileInfo.definedConstants
                                ) ?? isKeywordOnly;
                        } else {
                            isKeywordOnly =
                                getDefaultArgValueForFieldSpecifier(
                                    evaluator,
                                    statement.rightExpression,
                                    callTypeResult,
                                    'kw_only'
                                ) ?? isKeywordOnly;
                        }

                        const defaultArg = statement.rightExpression.arguments.find(
                            (arg) =>
                                arg.name?.value === 'default' ||
                                arg.name?.value === 'default_factory' ||
                                arg.name?.value === 'factory'
                        );

                        hasDefaultValue = !!defaultArg;
                        if (defaultArg?.valueExpression) {
                            defaultValueExpression = defaultArg.valueExpression;
                        }

                        const aliasArg = statement.rightExpression.arguments.find((arg) => arg.name?.value === 'alias');
                        if (aliasArg) {
                            const valueType = evaluator.getTypeOfExpression(aliasArg.valueExpression).type;
                            if (
                                isClassInstance(valueType) &&
                                ClassType.isBuiltIn(valueType, 'str') &&
                                isLiteralType(valueType)
                            ) {
                                aliasName = valueType.literalValue as string;
                            }
                        }

                        const converterArg = statement.rightExpression.arguments.find(
                            (arg) => arg.name?.value === 'converter'
                        );
                        if (converterArg && converterArg.valueExpression) {
                            // Converter support is dependent on PEP 712, which has not yet been approved.
                            if (AnalyzerNodeInfo.getFileInfo(node).diagnosticRuleSet.enableExperimentalFeatures) {
                                converter = converterArg;
                            }
                        }
                    }
                }
            } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                if (statement.valueExpression.nodeType === ParseNodeType.Name) {
                    variableNameNode = statement.valueExpression;
                    const annotationStatement = statement;
                    variableTypeEvaluator = () =>
                        evaluator.getTypeOfAnnotation(annotationStatement.typeAnnotation, {
                            isVariableAnnotation: true,
                            allowFinal: true,
                            allowClassVar: true,
                        });

                    // Is this a KW_ONLY separator introduced in Python 3.10?
                    if (!isNamedTuple && statement.valueExpression.value === '_') {
                        const annotatedType = variableTypeEvaluator();

                        if (isClassInstance(annotatedType) && ClassType.isBuiltIn(annotatedType, 'KW_ONLY')) {
                            sawKeywordOnlySeparator = true;
                            variableNameNode = undefined;
                            variableTypeEvaluator = undefined;
                        }
                    }
                }
            }

            if (variableNameNode && variableTypeEvaluator) {
                const variableName = variableNameNode.value;

                // Don't include class vars. PEP 557 indicates that they shouldn't
                // be considered data class entries.
                const variableSymbol = ClassType.getSymbolTable(classType).get(variableName);

                if (variableSymbol?.isClassVar() && !variableSymbol?.isFinalVarInClassBody()) {
                    // If an ancestor class declared an instance variable but this dataclass
                    // declares a ClassVar, delete the older one from the full data class entries.
                    // We exclude final variables here because a Final type annotation is implicitly
                    // considered a ClassVar by the binder, but dataclass rules are different.
                    const index = fullDataClassEntries.findIndex((p) => p.name === variableName);
                    if (index >= 0) {
                        fullDataClassEntries.splice(index, 1);
                    }
                    const dataClassEntry: DataClassEntry = {
                        name: variableName,
                        classType,
                        alias: aliasName,
                        isKeywordOnly: false,
                        hasDefault: hasDefaultValue,
                        defaultValueExpression,
                        includeInInit,
                        nameNode: variableNameNode,
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
                        hasDefault: hasDefaultValue,
                        defaultValueExpression,
                        includeInInit,
                        nameNode: variableNameNode,
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
                            dataClassEntry.defaultValueExpression = oldEntry.defaultValueExpression;
                            hasDefaultValue = true;

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
                    if (!isKeywordOnly && includeInInit && !skipSynthesizeInit && !hasDefaultValue) {
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
            if (statement.rightExpression.nodeType === ParseNodeType.Call) {
                const callType = evaluator.getTypeOfExpression(
                    statement.rightExpression.leftExpression,
                    EvaluatorFlags.CallBaseDefaults
                ).type;

                if (
                    isDataclassFieldConstructor(
                        callType,
                        classType.details.dataClassBehaviors?.fieldDescriptorNames || []
                    )
                ) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassFieldWithoutAnnotation(),
                        statement.rightExpression
                    );
                }
            }
        }
    });

    if (!isNamedTuple) {
        classType.details.dataClassEntries = localDataClassEntries;
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
    const keywordOnlyParams: FunctionParameter[] = [];

    if (!skipSynthesizeInit && !hasExistingInitMethod) {
        if (allAncestorsKnown) {
            fullDataClassEntries.forEach((entry) => {
                if (entry.includeInInit) {
                    // If the type refers to Self of the parent class, we need to
                    // transform it to refer to the Self of this subclass.
                    let effectiveType = entry.type;
                    if (entry.classType !== classType && requiresSpecialization(effectiveType)) {
                        const typeVarContext = new TypeVarContext(getTypeVarScopeId(entry.classType));
                        populateTypeVarContextForSelfType(typeVarContext, entry.classType, classType);
                        effectiveType = applySolvedTypeVars(effectiveType, typeVarContext);
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
                                node,
                                entry.converter,
                                entry.name,
                                fieldType,
                                effectiveType
                            )
                        );
                    }

                    const effectiveName = entry.alias || entry.name;

                    if (!entry.alias && entry.nameNode && isPrivateName(entry.nameNode.value)) {
                        evaluator.addDiagnostic(
                            DiagnosticRule.reportGeneralTypeIssues,
                            LocMessage.dataClassFieldWithPrivateName(),
                            entry.nameNode
                        );
                    }

                    const functionParam: FunctionParameter = {
                        category: ParameterCategory.Simple,
                        name: effectiveName,
                        hasDefault: entry.hasDefault,
                        defaultValueExpression: entry.defaultValueExpression,
                        type: effectiveType,
                        hasDeclaredType: true,
                    };

                    if (entry.isKeywordOnly) {
                        keywordOnlyParams.push(functionParam);
                    } else {
                        FunctionType.addParameter(constructorType, functionParam);
                    }
                }
            });

            if (keywordOnlyParams.length > 0) {
                FunctionType.addKeywordOnlyParameterSeparator(constructorType);
                keywordOnlyParams.forEach((param) => {
                    FunctionType.addParameter(constructorType, param);
                });
            }
        }

        symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
        symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));
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
        const literalTypes: TupleTypeArgument[] = matchArgsNames.map((name) => {
            return { type: ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strType, name)), isUnbounded: false };
        });
        const matchArgsType = ClassType.cloneAsInstance(specializeTupleClass(tupleClassType, literalTypes));
        symbolTable.set('__match_args__', Symbol.createWithType(SymbolFlags.ClassMember, matchArgsType));
    }

    const synthesizeComparisonMethod = (operator: string, paramType: Type) => {
        const operatorMethod = FunctionType.createSynthesizedInstance(operator);
        FunctionType.addParameter(operatorMethod, selfParam);
        FunctionType.addParameter(operatorMethod, {
            category: ParameterCategory.Simple,
            name: 'other',
            type: paramType,
            hasDeclaredType: true,
        });
        operatorMethod.details.declaredReturnType = evaluator.getBuiltInObject(node, 'bool');
        // If a method of this name already exists, don't override it.
        if (!symbolTable.get(operator)) {
            symbolTable.set(operator, Symbol.createWithType(SymbolFlags.ClassMember, operatorMethod));
        }
    };

    // Synthesize comparison operators.
    if (!ClassType.isSkipSynthesizedDataClassEq(classType)) {
        synthesizeComparisonMethod('__eq__', evaluator.getBuiltInObject(node, 'object'));
    }

    if (ClassType.isSynthesizedDataclassOrder(classType)) {
        const objType = ClassType.cloneAsInstance(classType);
        ['__lt__', '__le__', '__gt__', '__ge__'].forEach((operator) => {
            synthesizeComparisonMethod(operator, objType);
        });
    }

    let synthesizeHashFunction = ClassType.isFrozenDataClass(classType);
    const synthesizeHashNone =
        !ClassType.isSkipSynthesizedDataClassEq(classType) && !ClassType.isFrozenDataClass(classType);

    if (skipSynthesizeHash) {
        synthesizeHashFunction = false;
    }

    // If the user has indicated that a hash function should be generated even if it's unsafe
    // to do so or there is already a hash function present, override the default logic.
    if (ClassType.isSynthesizeDataClassUnsafeHash(classType)) {
        synthesizeHashFunction = true;
    }

    if (synthesizeHashFunction) {
        const hashMethod = FunctionType.createSynthesizedInstance('__hash__');
        FunctionType.addParameter(hashMethod, selfParam);
        hashMethod.details.declaredReturnType = evaluator.getBuiltInObject(node, 'int');
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
            ClassType.cloneForSpecialization(
                dictType,
                [evaluator.getBuiltInObject(node, 'str'), AnyType.create()],
                /* isTypeArgumentExplicit */ true
            )
        );
    }
    symbolTable.set(
        '__dataclass_fields__',
        Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.ClassVar, dictType)
    );

    if (ClassType.isGeneratedDataClassSlots(classType) && classType.details.localSlotsNames === undefined) {
        classType.details.localSlotsNames = localDataClassEntries.map((entry) => entry.name);
    }

    // Should we synthesize a __slots__ symbol?
    if (ClassType.isGeneratedDataClassSlots(classType)) {
        let iterableType = evaluator.getTypingType(node, 'Iterable') ?? UnknownType.create();

        if (isInstantiableClass(iterableType)) {
            iterableType = ClassType.cloneAsInstance(
                ClassType.cloneForSpecialization(
                    iterableType,
                    [evaluator.getBuiltInObject(node, 'str')],
                    /* isTypeArgumentExplicit */ true
                )
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
            /* isTypeArgumentExplicit */ true
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
    } else if (isOverloadedFunction(callType)) {
        callTarget = evaluator.getBestOverloadForArguments(
            callNode,
            { type: callType, isIncomplete: callTypeResult.isIncomplete },
            callNode.arguments
        );
    } else if (isInstantiableClass(callType)) {
        const initMethodResult = getBoundInitMethod(evaluator, callNode, callType);
        if (initMethodResult) {
            if (isFunction(initMethodResult.type)) {
                callTarget = initMethodResult.type;
            } else if (isOverloadedFunction(initMethodResult.type)) {
                callTarget = evaluator.getBestOverloadForArguments(
                    callNode,
                    { type: initMethodResult.type },
                    callNode.arguments
                );
            }
        }
    }

    if (callTarget) {
        const initParam = callTarget.details.parameters.find((p) => p.name === paramName);
        if (initParam) {
            // Is the parameter type a literal bool?
            if (
                initParam.hasDeclaredType &&
                isClass(initParam.type) &&
                typeof initParam.type.literalValue === 'boolean'
            ) {
                return initParam.type.literalValue;
            }

            // Is the default argument value a literal bool?
            if (
                initParam.defaultValueExpression &&
                initParam.defaultType &&
                isClass(initParam.defaultType) &&
                typeof initParam.defaultType.literalValue === 'boolean'
            ) {
                return initParam.defaultType.literalValue;
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
    const converterType = getConverterAsFunction(
        evaluator,
        evaluator.getTypeOfExpression(converterNode.valueExpression).type
    );

    if (!converterType) {
        return fieldType;
    }

    // Create synthesized function of the form Callable[[T], fieldType] which
    // will be used to check compatibility of the provided converter.
    const typeVar = TypeVarType.createInstance('__converterInput');
    typeVar.scopeId = getScopeIdForNode(converterNode);
    const targetFunction = FunctionType.createSynthesizedInstance('');
    targetFunction.details.typeVarScopeId = typeVar.scopeId;
    targetFunction.details.declaredReturnType = fieldType;
    FunctionType.addParameter(targetFunction, {
        category: ParameterCategory.Simple,
        name: '__input',
        type: typeVar,
        hasDeclaredType: true,
    });
    FunctionType.addPositionOnlyParameterSeparator(targetFunction);

    if (isFunction(converterType) || isOverloadedFunction(converterType)) {
        const acceptedTypes: Type[] = [];
        const diagAddendum = new DiagnosticAddendum();

        doForEachSignature(converterType, (signature) => {
            const returnTypeVarContext = new TypeVarContext(getTypeVarScopeIds(signature));

            if (
                evaluator.assignType(
                    FunctionType.getSpecializedReturnType(signature) ?? UnknownType.create(),
                    fieldType,
                    /* diag */ undefined,
                    returnTypeVarContext
                )
            ) {
                signature = applySolvedTypeVars(signature, returnTypeVarContext) as FunctionType;
            }

            const inputTypeVarContext = new TypeVarContext(typeVar.scopeId);

            if (evaluator.assignType(targetFunction, signature, diagAddendum, inputTypeVarContext)) {
                const overloadSolution = applySolvedTypeVars(typeVar, inputTypeVarContext, { unknownIfNotFound: true });
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
            evaluator.addDiagnostic(
                DiagnosticRule.reportGeneralTypeIssues,
                LocMessage.dataClassConverterOverloads().format({
                    funcName: converterType.overloads[0].details.name || '<anonymous function>',
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
): FunctionType | OverloadedFunctionType | undefined {
    if (isFunction(converterType) || isOverloadedFunction(converterType)) {
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
                fromConstructor = fromConstructor.subtypes[0];
            }

            if (isFunction(fromConstructor) || isOverloadedFunction(fromConstructor)) {
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
    dataclassNode: ParseNode,
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
    descriptorClass.details.baseClasses.push(evaluator.getBuiltInType(dataclassNode, 'object'));
    computeMroLinearization(descriptorClass);

    const fields = ClassType.getSymbolTable(descriptorClass);
    const selfType = synthesizeTypeVarForSelfCls(descriptorClass, /* isClsParam */ false);

    const setFunction = FunctionType.createSynthesizedInstance('__set__');
    FunctionType.addParameter(setFunction, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: selfType,
        hasDeclaredType: true,
    });
    FunctionType.addParameter(setFunction, {
        category: ParameterCategory.Simple,
        name: 'obj',
        type: AnyType.create(),
        hasDeclaredType: true,
    });
    FunctionType.addParameter(setFunction, {
        category: ParameterCategory.Simple,
        name: 'value',
        type: setType,
        hasDeclaredType: true,
    });
    setFunction.details.declaredReturnType = evaluator.getNoneType();
    const setSymbol = Symbol.createWithType(SymbolFlags.ClassMember, setFunction);
    fields.set('__set__', setSymbol);

    const getFunction = FunctionType.createSynthesizedInstance('__get__');
    FunctionType.addParameter(getFunction, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: selfType,
        hasDeclaredType: true,
    });
    FunctionType.addParameter(getFunction, {
        category: ParameterCategory.Simple,
        name: 'obj',
        type: AnyType.create(),
        hasDeclaredType: true,
    });
    FunctionType.addParameter(getFunction, {
        category: ParameterCategory.Simple,
        name: 'objtype',
        type: AnyType.create(),
        hasDeclaredType: true,
    });
    getFunction.details.declaredReturnType = getType;
    const getSymbol = Symbol.createWithType(SymbolFlags.ClassMember, getFunction);
    fields.set('__get__', getSymbol);

    return Symbol.createWithType(SymbolFlags.ClassMember, ClassType.cloneAsInstance(descriptorClass));
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
    return FunctionType.getEffectiveParameterType(setMethodType, 1);
}

// Builds a sorted list of dataclass entries that are inherited by
// the specified class. These entries must be unique and in reverse-MRO
// order. Returns true if all of the class types in the hierarchy are
// known, false if one or more are unknown.
function addInheritedDataClassEntries(classType: ClassType, entries: DataClassEntry[]) {
    let allAncestorsAreKnown = true;

    ClassType.getReverseMro(classType).forEach((mroClass) => {
        if (isInstantiableClass(mroClass)) {
            const typeVarContext = buildTypeVarContextFromSpecializedClass(mroClass);
            const dataClassEntries = ClassType.getDataClassEntries(mroClass);

            // Add the entries to the end of the list, replacing same-named
            // entries if found.
            dataClassEntries.forEach((entry) => {
                const existingIndex = entries.findIndex((e) => e.name === entry.name);

                // If the type from the parent class is generic, we need to convert
                // to the type parameter namespace of child class.
                const updatedEntry = { ...entry };
                updatedEntry.type = applySolvedTypeVars(updatedEntry.type, typeVarContext);

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
        callName = type.details.fullName;
    } else if (isOverloadedFunction(type)) {
        callName = type.overloads[0].details.fullName;
    } else if (isInstantiableClass(type)) {
        callName = type.details.fullName;
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
        keywordOnlyParams: false,
        generateEq: true,
        generateOrder: false,
        frozen: false,
        fieldDescriptorNames: [],
    };

    const fileInfo = AnalyzerNodeInfo.getFileInfo(node);

    // Parse the arguments to the call.
    node.arguments.forEach((arg) => {
        if (!arg.name || arg.argumentCategory !== ArgumentCategory.Simple) {
            evaluator.addDiagnostic(
                DiagnosticRule.reportCallIssue,
                LocMessage.dataClassTransformPositionalParam(),
                arg
            );
            return;
        }

        switch (arg.name.value) {
            case 'kw_only_default': {
                const value = evaluateStaticBoolExpression(
                    arg.valueExpression,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );
                if (value === undefined) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformExpectedBoolLiteral(),
                        arg.valueExpression
                    );
                    return;
                }

                behaviors.keywordOnlyParams = value;
                break;
            }

            case 'eq_default': {
                const value = evaluateStaticBoolExpression(
                    arg.valueExpression,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );
                if (value === undefined) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformExpectedBoolLiteral(),
                        arg.valueExpression
                    );
                    return;
                }

                behaviors.generateEq = value;
                break;
            }

            case 'order_default': {
                const value = evaluateStaticBoolExpression(
                    arg.valueExpression,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );
                if (value === undefined) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformExpectedBoolLiteral(),
                        arg.valueExpression
                    );
                    return;
                }

                behaviors.generateOrder = value;
                break;
            }

            case 'frozen_default': {
                const value = evaluateStaticBoolExpression(
                    arg.valueExpression,
                    fileInfo.executionEnvironment,
                    fileInfo.definedConstants
                );
                if (value === undefined) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformExpectedBoolLiteral(),
                        arg.valueExpression
                    );
                    return;
                }

                behaviors.frozen = value;
                break;
            }

            // Earlier versions of the dataclass_transform spec used the name "field_descriptors"
            // rather than "field_specifiers". The older name is now deprecated but still supported
            // for the time being because some libraries shipped with the older __dataclass_transform__
            // form that supported this older parameter name.
            case 'field_descriptors':
            case 'field_specifiers': {
                const valueType = evaluator.getTypeOfExpression(arg.valueExpression).type;
                if (
                    !isClassInstance(valueType) ||
                    !ClassType.isBuiltIn(valueType, 'tuple') ||
                    !valueType.tupleTypeArguments ||
                    valueType.tupleTypeArguments.some(
                        (entry) =>
                            !isInstantiableClass(entry.type) &&
                            !isFunction(entry.type) &&
                            !isOverloadedFunction(entry.type)
                    )
                ) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassTransformFieldSpecifier().format({
                            type: evaluator.printType(valueType),
                        }),
                        arg.valueExpression
                    );
                    return;
                }

                if (!behaviors.fieldDescriptorNames) {
                    behaviors.fieldDescriptorNames = [];
                }
                valueType.tupleTypeArguments.forEach((arg) => {
                    if (isInstantiableClass(arg.type) || isFunction(arg.type)) {
                        behaviors.fieldDescriptorNames.push(arg.type.details.fullName);
                    } else if (isOverloadedFunction(arg.type)) {
                        behaviors.fieldDescriptorNames.push(arg.type.overloads[0].details.fullName);
                    }
                });
                break;
            }

            default:
                evaluator.addDiagnostic(
                    DiagnosticRule.reportGeneralTypeIssues,
                    LocMessage.dataClassTransformUnknownArgument().format({ name: arg.name.value }),
                    arg.valueExpression
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
    } else if (isOverloadedFunction(type)) {
        // Find the first overload or implementation that contains a
        // dataclass_transform decorator. If more than one have such a decorator,
        // only the first one will be honored, as per PEP 681.
        functionType =
            type.overloads.find((overload) => !!overload.details.decoratorDataClassBehaviors) ?? type.overloads[0];
    }

    if (!functionType) {
        return undefined;
    }

    if (functionType.details.decoratorDataClassBehaviors) {
        return functionType.details.decoratorDataClassBehaviors;
    }

    // Is this the built-in dataclass? If so, return the default behaviors.
    if (functionType.details.fullName === 'dataclasses.dataclass') {
        return {
            keywordOnlyParams: false,
            generateEq: true,
            generateOrder: false,
            frozen: false,
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
    argValueExpr: ExpressionNode
) {
    const fileInfo = AnalyzerNodeInfo.getFileInfo(errorNode);
    const value = evaluateStaticBoolExpression(argValueExpr, fileInfo.executionEnvironment, fileInfo.definedConstants);

    applyDataClassBehaviorOverrideValue(evaluator, errorNode, classType, argName, value);
}

function applyDataClassBehaviorOverrideValue(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    argName: string,
    argValue: boolean | undefined
) {
    switch (argName) {
        case 'order':
            if (argValue === true) {
                classType.details.flags |= ClassTypeFlags.SynthesizedDataClassOrder;
            } else if (argValue === false) {
                classType.details.flags &= ~ClassTypeFlags.SynthesizedDataClassOrder;
            }
            break;

        case 'kw_only':
            if (argValue === false) {
                classType.details.flags &= ~ClassTypeFlags.DataClassKeywordOnlyParams;
            } else if (argValue === true) {
                classType.details.flags |= ClassTypeFlags.DataClassKeywordOnlyParams;
            }
            break;

        case 'frozen': {
            let hasUnfrozenBaseClass = false;
            let hasFrozenBaseClass = false;

            if (argValue === false) {
                classType.details.flags &= ~ClassTypeFlags.FrozenDataClass;
            } else if (argValue === true) {
                classType.details.flags |= ClassTypeFlags.FrozenDataClass;
            }

            classType.details.baseClasses.forEach((baseClass) => {
                if (isInstantiableClass(baseClass) && ClassType.isDataClass(baseClass)) {
                    if (ClassType.isFrozenDataClass(baseClass)) {
                        hasFrozenBaseClass = true;
                    } else if (
                        !baseClass.details.classDataClassTransform &&
                        !(
                            baseClass.details.declaredMetaclass &&
                            isInstantiableClass(baseClass.details.declaredMetaclass) &&
                            !!baseClass.details.declaredMetaclass.details.classDataClassTransform
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
            if (argValue === false) {
                classType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassInit;
            } else if (argValue === true) {
                classType.details.flags &= ~ClassTypeFlags.SkipSynthesizedDataClassInit;
            }
            break;

        case 'eq':
            if (argValue === false) {
                classType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassEq;
            } else if (argValue === true) {
                classType.details.flags &= ~ClassTypeFlags.SkipSynthesizedDataClassEq;
            }
            break;

        case 'slots':
            if (argValue === true) {
                classType.details.flags |= ClassTypeFlags.GenerateDataClassSlots;

                if (classType.details.localSlotsNames) {
                    evaluator.addDiagnostic(
                        DiagnosticRule.reportGeneralTypeIssues,
                        LocMessage.dataClassSlotsOverwrite(),
                        errorNode
                    );
                }
            } else if (argValue === false) {
                classType.details.flags &= ~ClassTypeFlags.GenerateDataClassSlots;
            }
            break;

        case 'hash':
        case 'unsafe_hash':
            if (argValue === true) {
                classType.details.flags |= ClassTypeFlags.SynthesizeDataClassUnsafeHash;
            }
            break;
    }
}

export function applyDataClassClassBehaviorOverrides(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    args: FunctionArgument[],
    defaultBehaviors: DataClassBehaviors
) {
    let sawFrozenArg = false;

    args.forEach((arg) => {
        if (arg.valueExpression && arg.name) {
            applyDataClassBehaviorOverride(evaluator, arg.name, classType, arg.name.value, arg.valueExpression);

            if (arg.name.value === 'frozen') {
                sawFrozenArg = true;
            }
        }
    });

    // If there was no frozen argument, it is implicitly false. This will
    // validate that we're not overriding a frozen class with a non-frozen class.
    if (!sawFrozenArg) {
        applyDataClassBehaviorOverrideValue(evaluator, errorNode, classType, 'frozen', defaultBehaviors.frozen);
    }
}

export function applyDataClassDefaultBehaviors(classType: ClassType, defaultBehaviors: DataClassBehaviors) {
    classType.details.dataClassBehaviors = defaultBehaviors;
    classType.details.flags |= ClassTypeFlags.DataClass;

    if (defaultBehaviors.keywordOnlyParams) {
        classType.details.flags |= ClassTypeFlags.DataClassKeywordOnlyParams;
    }

    if (!defaultBehaviors.generateEq) {
        classType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassEq;
    }

    if (defaultBehaviors.generateOrder) {
        classType.details.flags |= ClassTypeFlags.SynthesizedDataClassOrder;
    }

    if (defaultBehaviors.frozen) {
        classType.details.flags |= ClassTypeFlags.FrozenDataClass;
    }
}

export function applyDataClassDecorator(
    evaluator: TypeEvaluator,
    errorNode: ParseNode,
    classType: ClassType,
    defaultBehaviors: DataClassBehaviors,
    callNode: CallNode | undefined
) {
    applyDataClassDefaultBehaviors(classType, defaultBehaviors);

    applyDataClassClassBehaviorOverrides(evaluator, errorNode, classType, callNode?.arguments ?? [], defaultBehaviors);
}
