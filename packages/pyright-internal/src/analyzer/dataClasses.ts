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
import { DiagnosticRule } from '../common/diagnosticRules';
import { Localizer } from '../localization/localize';
import {
    ArgumentCategory,
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
import { DeclarationType } from './declaration';
import { updateNamedTupleBaseClass } from './namedTuples';
import { evaluateStaticBoolExpression } from './staticExpressions';
import { Symbol, SymbolFlags } from './symbol';
import { FunctionArgument, TypeEvaluator } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
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
    NoneType,
    Type,
    UnknownType,
} from './types';
import {
    applySolvedTypeVars,
    buildTypeVarMapFromSpecializedClass,
    convertToInstance,
    isLiteralType,
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
    skipSynthesizeInit: boolean
) {
    assert(ClassType.isDataClass(classType));

    const classTypeVar = synthesizeTypeVarForSelfCls(classType, /* isClsParam */ true);
    const newType = FunctionType.createInstance(
        '__new__',
        '',
        '',
        FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
    );
    const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod);

    FunctionType.addParameter(newType, {
        category: ParameterCategory.Simple,
        name: 'cls',
        type: classTypeVar,
        hasDeclaredType: true,
    });
    FunctionType.addDefaultParameters(newType);
    newType.details.declaredReturnType = convertToInstance(classTypeVar);

    const selfParam: FunctionParameter = {
        category: ParameterCategory.Simple,
        name: 'self',
        type: synthesizeTypeVarForSelfCls(classType, /* isClsParam */ false),
        hasDeclaredType: true,
    };
    FunctionType.addParameter(initType, selfParam);
    initType.details.declaredReturnType = NoneType.createInstance();

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

    // Maintain a list of "type evaluators".
    type TypeEvaluator = () => Type;
    const localEntryTypeEvaluator: { entry: DataClassEntry; evaluator: TypeEvaluator }[] = [];
    let sawKeywordOnlySeparator = false;

    node.suite.statements.forEach((statementList) => {
        if (statementList.nodeType === ParseNodeType.StatementList) {
            statementList.statements.forEach((statement) => {
                let variableNameNode: NameNode | undefined;
                let aliasName: string | undefined;
                let variableTypeEvaluator: TypeEvaluator | undefined;
                let hasDefaultValue = false;
                let isKeywordOnly = ClassType.isDataClassKeywordOnlyParams(classType) || sawKeywordOnlySeparator;
                let defaultValueExpression: ExpressionNode | undefined;
                let includeInInit = true;

                if (statement.nodeType === ParseNodeType.Assignment) {
                    if (
                        statement.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                        statement.leftExpression.valueExpression.nodeType === ParseNodeType.Name
                    ) {
                        variableNameNode = statement.leftExpression.valueExpression;
                        variableTypeEvaluator = () =>
                            evaluator.getTypeOfAnnotation(
                                (statement.leftExpression as TypeAnnotationNode).typeAnnotation,
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
                        const callType = evaluator.getTypeOfExpression(statement.rightExpression.leftExpression).type;
                        if (
                            isDataclassFieldConstructor(
                                callType,
                                classType.details.dataClassBehaviors?.fieldDescriptorNames || []
                            )
                        ) {
                            const initArg = statement.rightExpression.arguments.find(
                                (arg) => arg.name?.value === 'init'
                            );
                            if (initArg && initArg.valueExpression) {
                                const value = evaluateStaticBoolExpression(
                                    initArg.valueExpression,
                                    AnalyzerNodeInfo.getFileInfo(node).executionEnvironment
                                );
                                if (value === false) {
                                    includeInInit = false;
                                }
                            } else {
                                // See if the field constructor has an `init` parameter with
                                // a default value.
                                let callTarget: FunctionType | undefined;
                                if (isFunction(callType)) {
                                    callTarget = callType;
                                } else if (isOverloadedFunction(callType)) {
                                    callTarget = evaluator.getBestOverloadForArguments(
                                        statement.rightExpression,
                                        callType,
                                        statement.rightExpression.arguments
                                    );
                                } else if (isInstantiableClass(callType)) {
                                    const initCall = evaluator.getBoundMethod(callType, '__init__');
                                    if (initCall) {
                                        if (isFunction(initCall)) {
                                            callTarget = initCall;
                                        } else if (isOverloadedFunction(initCall)) {
                                            callTarget = evaluator.getBestOverloadForArguments(
                                                statement.rightExpression,
                                                initCall,
                                                statement.rightExpression.arguments
                                            );
                                        }
                                    }
                                }

                                if (callTarget) {
                                    const initParam = callTarget.details.parameters.find((p) => p.name === 'init');
                                    if (initParam && initParam.defaultValueExpression && initParam.hasDeclaredType) {
                                        if (
                                            isClass(initParam.type) &&
                                            ClassType.isBuiltIn(initParam.type, 'bool') &&
                                            isLiteralType(initParam.type)
                                        ) {
                                            if (initParam.type.literalValue === false) {
                                                includeInInit = false;
                                            }
                                        }
                                    }
                                }
                            }

                            const kwOnlyArg = statement.rightExpression.arguments.find(
                                (arg) => arg.name?.value === 'kw_only'
                            );
                            if (kwOnlyArg && kwOnlyArg.valueExpression) {
                                const value = evaluateStaticBoolExpression(
                                    kwOnlyArg.valueExpression,
                                    AnalyzerNodeInfo.getFileInfo(node).executionEnvironment
                                );
                                if (value === false) {
                                    isKeywordOnly = false;
                                } else if (value === true) {
                                    isKeywordOnly = true;
                                }
                            }

                            hasDefaultValue = statement.rightExpression.arguments.some(
                                (arg) =>
                                    arg.name?.value === 'default' ||
                                    arg.name?.value === 'default_factory' ||
                                    arg.name?.value === 'factory'
                            );

                            const aliasArg = statement.rightExpression.arguments.find(
                                (arg) => arg.name?.value === 'alias'
                            );
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
                        }
                    }
                } else if (statement.nodeType === ParseNodeType.TypeAnnotation) {
                    if (statement.valueExpression.nodeType === ParseNodeType.Name) {
                        variableNameNode = statement.valueExpression;
                        variableTypeEvaluator = () =>
                            evaluator.getTypeOfAnnotation(statement.typeAnnotation, {
                                isVariableAnnotation: true,
                                allowFinal: true,
                                allowClassVar: true,
                            });

                        // Is this a KW_ONLY separator introduced in Python 3.10?
                        if (statement.valueExpression.value === '_') {
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
                    const variableSymbol = classType.details.fields.get(variableName);
                    const isFinal = variableSymbol
                        ?.getDeclarations()
                        .some((decl) => decl.type === DeclarationType.Variable && decl.isFinal);

                    if (variableSymbol?.isClassVar() && !isFinal) {
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
                            alias: aliasName,
                            isKeywordOnly: false,
                            hasDefault: hasDefaultValue,
                            defaultValueExpression,
                            includeInInit,
                            type: UnknownType.create(),
                            isClassVar: true,
                        };
                        localDataClassEntries.push(dataClassEntry);
                    } else {
                        // Create a new data class entry, but defer evaluation of the type until
                        // we've compiled the full list of data class entries for this class. This
                        // allows us to handle circular references in types.
                        const dataClassEntry: DataClassEntry = {
                            name: variableName,
                            alias: aliasName,
                            isKeywordOnly,
                            hasDefault: hasDefaultValue,
                            defaultValueExpression,
                            includeInInit,
                            type: UnknownType.create(),
                            isClassVar: false,
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
                                evaluator.addError(Localizer.Diagnostic.dataClassFieldWithDefault(), variableNameNode);
                            }
                        }
                    }
                }
            });
        }
    });

    classType.details.dataClassEntries = localDataClassEntries;

    // Now that the dataClassEntries field has been set with a complete list
    // of local data class entries for this class, perform deferred type
    // evaluations. This could involve circular type dependencies, so it's
    // required that the list be complete (even if types are not yet accurate)
    // before we perform the type evaluations.
    localEntryTypeEvaluator.forEach((entryEvaluator) => {
        entryEvaluator.entry.type = entryEvaluator.evaluator();
    });

    const symbolTable = classType.details.fields;
    const keywordOnlyParams: FunctionParameter[] = [];

    if (!skipSynthesizeInit && allAncestorsKnown) {
        fullDataClassEntries.forEach((entry) => {
            if (entry.includeInInit) {
                const functionParam: FunctionParameter = {
                    category: ParameterCategory.Simple,
                    name: entry.alias || entry.name,
                    hasDefault: entry.hasDefault,
                    defaultValueExpression: entry.defaultValueExpression,
                    type: entry.type,
                    hasDeclaredType: true,
                };

                if (entry.isKeywordOnly) {
                    keywordOnlyParams.push(functionParam);
                } else {
                    FunctionType.addParameter(initType, functionParam);
                }
            }
        });

        if (keywordOnlyParams.length > 0) {
            FunctionType.addParameter(initType, {
                category: ParameterCategory.VarArgList,
                type: AnyType.create(),
            });
            keywordOnlyParams.forEach((param) => {
                FunctionType.addParameter(initType, param);
            });
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
            if (entry.includeInInit) {
                // Use the field name, not its alias (if it has one).
                matchArgsNames.push(entry.name);
            }
        });
        const literalTypes = matchArgsNames.map((name) => {
            return ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strType, name));
        });
        const matchArgsType = ClassType.cloneAsInstance(specializeTupleClass(tupleClassType, literalTypes));
        symbolTable.set('__match_args__', Symbol.createWithType(SymbolFlags.ClassMember, matchArgsType));
    }

    const synthesizeComparisonMethod = (operator: string, paramType: Type) => {
        const operatorMethod = FunctionType.createInstance(operator, '', '', FunctionTypeFlags.SynthesizedMethod);
        FunctionType.addParameter(operatorMethod, selfParam);
        FunctionType.addParameter(operatorMethod, {
            category: ParameterCategory.Simple,
            name: 'x',
            type: paramType,
            hasDeclaredType: true,
        });
        operatorMethod.details.declaredReturnType = evaluator.getBuiltInObject(node, 'bool');
        symbolTable.set(operator, Symbol.createWithType(SymbolFlags.ClassMember, operatorMethod));
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
    symbolTable.set('__dataclass_fields__', Symbol.createWithType(SymbolFlags.ClassMember, dictType));

    if (ClassType.isGeneratedDataClassSlots(classType) && classType.details.localSlotsNames === undefined) {
        classType.details.localSlotsNames = localDataClassEntries.map((entry) => entry.name);
    }

    // If this dataclass derived from a NamedTuple, update the NamedTuple with
    // the specialized entry types.
    updateNamedTupleBaseClass(
        classType,
        fullDataClassEntries.map((entry) => entry.type),
        /* isTypeArgumentExplicit */ true
    );
}

// Builds a sorted list of dataclass entries that are inherited by
// the specified class. These entries must be unique and in reverse-MRO
// order. Returns true if all of the class types in the hierarchy are
// known, false if one or more are unknown.
function addInheritedDataClassEntries(classType: ClassType, entries: DataClassEntry[]) {
    let allAncestorsAreKnown = true;

    for (let i = classType.details.mro.length - 1; i >= 0; i--) {
        const mroClass = classType.details.mro[i];

        if (isInstantiableClass(mroClass)) {
            const typeVarMap = buildTypeVarMapFromSpecializedClass(mroClass, /* makeConcrete */ false);
            const dataClassEntries = ClassType.getDataClassEntries(mroClass);

            // Add the entries to the end of the list, replacing same-named
            // entries if found.
            dataClassEntries.forEach((entry) => {
                const existingIndex = entries.findIndex((e) => e.name === entry.name);

                // If the type from the parent class is generic, we need to convert
                // to the type parameter namespace of child class.
                const updatedEntry = { ...entry };
                updatedEntry.type = applySolvedTypeVars(updatedEntry.type, typeVarMap);

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
    }

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
    node: ExpressionNode
): DataClassBehaviors | undefined {
    if (node.nodeType !== ParseNodeType.Call) {
        // TODO - emit diagnostic
        return undefined;
    }

    const behaviors: DataClassBehaviors = {
        keywordOnlyParams: false,
        generateEq: true,
        generateOrder: false,
        fieldDescriptorNames: [],
    };

    const fileInfo = AnalyzerNodeInfo.getFileInfo(node);

    // Parse the arguments to the call.
    node.arguments.forEach((arg) => {
        if (!arg.name) {
            // TODO - emit diagnostic
            return;
        }

        if (arg.argumentCategory !== ArgumentCategory.Simple) {
            // TODO - emit diagnostic
            return;
        }

        switch (arg.name.value) {
            case 'kw_only_default': {
                const value = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
                if (value === undefined) {
                    // TODO - emit diagnostic
                    return;
                }

                behaviors.keywordOnlyParams = value;
                break;
            }

            case 'eq_default': {
                const value = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
                if (value === undefined) {
                    // TODO - emit diagnostic
                    return;
                }

                behaviors.generateEq = value;
                break;
            }

            case 'order_default': {
                const value = evaluateStaticBoolExpression(arg.valueExpression, fileInfo.executionEnvironment);
                if (value === undefined) {
                    // TODO - emit diagnostic
                    return;
                }

                behaviors.generateOrder = value;
                break;
            }

            case 'field_descriptors': {
                const valueType = evaluator.getTypeOfExpression(arg.valueExpression).type;
                if (
                    !isClassInstance(valueType) ||
                    !ClassType.isBuiltIn(valueType, 'tuple') ||
                    !valueType.tupleTypeArguments ||
                    valueType.tupleTypeArguments.some(
                        (entry) => !isInstantiableClass(entry) && !isFunction(entry) && !isOverloadedFunction(entry)
                    )
                ) {
                    // TODO - emit diagnostic
                    return;
                }

                if (!behaviors.fieldDescriptorNames) {
                    behaviors.fieldDescriptorNames = [];
                }
                valueType.tupleTypeArguments.forEach((arg) => {
                    if (isInstantiableClass(arg) || isFunction(arg)) {
                        behaviors.fieldDescriptorNames.push(arg.details.fullName);
                    } else if (isOverloadedFunction(arg)) {
                        behaviors.fieldDescriptorNames.push(arg.overloads[0].details.fullName);
                    }
                });
                break;
            }

            default:
                // TODO - emit diagnostic
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
        functionType = type.overloads[0];
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
    argValue: ExpressionNode
) {
    const fileInfo = AnalyzerNodeInfo.getFileInfo(errorNode);
    const value = evaluateStaticBoolExpression(argValue, fileInfo.executionEnvironment);

    switch (argName) {
        case 'order':
            if (value === true) {
                classType.details.flags |= ClassTypeFlags.SynthesizedDataClassOrder;
            } else if (value === false) {
                classType.details.flags &= ~ClassTypeFlags.SynthesizedDataClassOrder;
            }
            break;

        case 'kw_only':
            if (value === false) {
                classType.details.flags &= ~ClassTypeFlags.DataClassKeywordOnlyParams;
            } else if (value === true) {
                classType.details.flags |= ClassTypeFlags.DataClassKeywordOnlyParams;
            }
            break;

        case 'frozen': {
            let hasUnfrozenBaseClass = false;
            let hasFrozenBaseClass = false;

            classType.details.baseClasses.forEach((baseClass) => {
                if (isInstantiableClass(baseClass) && ClassType.isDataClass(baseClass)) {
                    if (ClassType.isFrozenDataClass(baseClass)) {
                        hasFrozenBaseClass = true;
                    } else if (
                        !baseClass.details.declaredMetaclass ||
                        !isInstantiableClass(baseClass.details.declaredMetaclass) ||
                        !baseClass.details.declaredMetaclass.details.metaclassDataClassTransform
                    ) {
                        // If this base class is unfrozen and isn't the class that directly
                        // references the metaclass that provides dataclass-like behaviors,
                        // we'll assume we're deriving from an unfrozen dataclass.
                        hasUnfrozenBaseClass = true;
                    }
                }
            });

            if (value === true || hasFrozenBaseClass) {
                classType.details.flags |= ClassTypeFlags.FrozenDataClass;

                // A frozen dataclass cannot derive from a non-frozen dataclass.
                if (hasUnfrozenBaseClass) {
                    evaluator.addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.dataClassBaseClassNotFrozen(),
                        errorNode
                    );
                }
            }
            break;
        }

        case 'init':
            if (value === false) {
                classType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassInit;
            } else if (value === true) {
                classType.details.flags &= ~ClassTypeFlags.SkipSynthesizedDataClassInit;
            }
            break;

        case 'eq':
            if (value === false) {
                classType.details.flags |= ClassTypeFlags.SkipSynthesizedDataClassEq;
            } else if (value === true) {
                classType.details.flags &= ~ClassTypeFlags.SkipSynthesizedDataClassEq;
            }
            break;

        case 'slots':
            if (value === true) {
                classType.details.flags |= ClassTypeFlags.GenerateDataClassSlots;

                if (classType.details.localSlotsNames) {
                    evaluator.addDiagnostic(
                        fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
                        DiagnosticRule.reportGeneralTypeIssues,
                        Localizer.Diagnostic.dataClassSlotsOverwrite(),
                        errorNode
                    );
                }
            } else if (value === false) {
                classType.details.flags &= ~ClassTypeFlags.GenerateDataClassSlots;
            }
            break;
    }
}

export function applyDataClassMetaclassBehaviorOverrides(
    evaluator: TypeEvaluator,
    classType: ClassType,
    args: FunctionArgument[]
) {
    args.forEach((arg) => {
        if (arg.valueExpression && arg.name) {
            applyDataClassBehaviorOverride(evaluator, arg.name, classType, arg.name.value, arg.valueExpression);
        }
    });
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
}

export function applyDataClassDecorator(
    evaluator: TypeEvaluator,
    classType: ClassType,
    defaultBehaviors: DataClassBehaviors,
    callNode: CallNode | undefined
) {
    applyDataClassDefaultBehaviors(classType, defaultBehaviors);

    if (callNode?.arguments) {
        callNode.arguments.forEach((arg) => {
            if (arg.name && arg.valueExpression) {
                applyDataClassBehaviorOverride(evaluator, arg, classType, arg.name.value, arg.valueExpression);
            }
        });
    }
}
