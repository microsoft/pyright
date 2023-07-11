/*
 * typedDicts.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the construction of TypedDict
 * classes.
 */

import { appendArray } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetsToRange } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
import {
    ArgumentCategory,
    ClassNode,
    DictionaryNode,
    ExpressionNode,
    IndexNode,
    ParameterCategory,
    ParseNodeType,
} from '../parser/parseNodes';
import { KeywordType } from '../parser/tokenizerTypes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { DeclarationType, VariableDeclaration } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol, SymbolFlags, SymbolTable } from './symbol';
import { getLastTypedDeclaredForSymbol } from './symbolUtils';
import { EvaluatorUsage, FunctionArgument, TypeEvaluator, TypeResult, TypeResultWithNode } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClass,
    isClassInstance,
    isInstantiableClass,
    isTypeSame,
    maxTypeRecursionCount,
    NeverType,
    NoneType,
    OverloadedFunctionType,
    Type,
    TypedDictEntry,
    TypeVarScopeType,
    TypeVarType,
    UnknownType,
} from './types';
import {
    applySolvedTypeVars,
    AssignTypeFlags,
    buildTypeVarContextFromSpecializedClass,
    computeMroLinearization,
    getTypeVarScopeId,
    isLiteralType,
    mapSubtypes,
    partiallySpecializeType,
    specializeTupleClass,
} from './typeUtils';
import { TypeVarContext } from './typeVarContext';

// Creates a new custom TypedDict factory class.
export function createTypedDictType(
    evaluator: TypeEvaluator,
    errorNode: ExpressionNode,
    typedDictClass: ClassType,
    argList: FunctionArgument[]
): ClassType {
    const fileInfo = AnalyzerNodeInfo.getFileInfo(errorNode);

    // TypedDict supports two different syntaxes:
    // Point2D = TypedDict('Point2D', {'x': int, 'y': int, 'label': str})
    // Point2D = TypedDict('Point2D', x=int, y=int, label=str)
    let className = 'TypedDict';
    if (argList.length === 0) {
        evaluator.addError(Localizer.Diagnostic.typedDictFirstArg(), errorNode);
    } else {
        const nameArg = argList[0];
        if (
            nameArg.argumentCategory !== ArgumentCategory.Simple ||
            !nameArg.valueExpression ||
            nameArg.valueExpression.nodeType !== ParseNodeType.StringList
        ) {
            evaluator.addError(Localizer.Diagnostic.typedDictFirstArg(), argList[0].valueExpression || errorNode);
        } else {
            className = nameArg.valueExpression.strings.map((s) => s.value).join('');
        }
    }

    const classType = ClassType.createInstantiable(
        className,
        ParseTreeUtils.getClassFullName(errorNode, fileInfo.moduleName, className),
        fileInfo.moduleName,
        fileInfo.filePath,
        ClassTypeFlags.TypedDictClass,
        ParseTreeUtils.getTypeSourceId(errorNode),
        /* declaredMetaclass */ undefined,
        typedDictClass.details.effectiveMetaclass
    );
    classType.details.baseClasses.push(typedDictClass);
    computeMroLinearization(classType);

    const classFields = classType.details.fields;
    classFields.set(
        '__class__',
        Symbol.createWithType(SymbolFlags.ClassMember | SymbolFlags.IgnoredForProtocolMatch, classType)
    );

    let usingDictSyntax = false;
    if (argList.length < 2) {
        evaluator.addError(Localizer.Diagnostic.typedDictSecondArgDict(), errorNode);
    } else {
        const entriesArg = argList[1];

        if (
            entriesArg.argumentCategory === ArgumentCategory.Simple &&
            entriesArg.valueExpression &&
            entriesArg.valueExpression.nodeType === ParseNodeType.Dictionary
        ) {
            usingDictSyntax = true;

            getTypedDictFieldsFromDictSyntax(evaluator, entriesArg.valueExpression, classFields);
        } else if (entriesArg.name) {
            const entrySet = new Set<string>();
            for (let i = 1; i < argList.length; i++) {
                const entry = argList[i];
                if (!entry.name || !entry.valueExpression) {
                    continue;
                }

                if (entrySet.has(entry.name.value)) {
                    evaluator.addError(Localizer.Diagnostic.typedDictEntryUnique(), entry.valueExpression);
                    continue;
                }

                // Record names in a map to detect duplicates.
                entrySet.add(entry.name.value);

                const newSymbol = new Symbol(SymbolFlags.InstanceMember);
                const fileInfo = AnalyzerNodeInfo.getFileInfo(errorNode);
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: entry.name,
                    path: fileInfo.filePath,
                    typeAnnotationNode: entry.valueExpression,
                    isRuntimeTypeExpression: true,
                    range: convertOffsetsToRange(
                        entry.name.start,
                        TextRange.getEnd(entry.valueExpression),
                        fileInfo.lines
                    ),
                    moduleName: fileInfo.moduleName,
                    isInExceptSuite: false,
                };
                newSymbol.addDeclaration(declaration);

                classFields.set(entry.name.value, newSymbol);
            }
        } else {
            evaluator.addError(Localizer.Diagnostic.typedDictSecondArgDict(), errorNode);
        }
    }

    if (usingDictSyntax) {
        for (const arg of argList.slice(2)) {
            if (arg.name?.value === 'total' || arg.name?.value === 'readonly') {
                if (
                    !arg.valueExpression ||
                    arg.valueExpression.nodeType !== ParseNodeType.Constant ||
                    !(
                        arg.valueExpression.constType === KeywordType.False ||
                        arg.valueExpression.constType === KeywordType.True
                    )
                ) {
                    evaluator.addError(
                        Localizer.Diagnostic.typedDictBoolParam().format({ name: arg.name.value }),
                        arg.valueExpression || errorNode
                    );
                } else if (arg.name.value === 'total' && arg.valueExpression.constType === KeywordType.False) {
                    classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
                } else if (arg.name.value === 'readonly' && arg.valueExpression.constType === KeywordType.True) {
                    classType.details.flags |= ClassTypeFlags.DictValuesReadOnly;
                }
            } else {
                evaluator.addError(Localizer.Diagnostic.typedDictExtraArgs(), arg.valueExpression || errorNode);
            }
        }
    }

    synthesizeTypedDictClassMethods(evaluator, errorNode, classType, /* isClassFinal */ false);

    return classType;
}

// Creates a new anonymous TypedDict class from an inlined dict[{}] type annotation.
export function createTypedDictTypeInlined(
    evaluator: TypeEvaluator,
    dictNode: DictionaryNode,
    typedDictClass: ClassType
): ClassType {
    const fileInfo = AnalyzerNodeInfo.getFileInfo(dictNode);
    const className = '<TypedDict>';

    const classType = ClassType.createInstantiable(
        className,
        ParseTreeUtils.getClassFullName(dictNode, fileInfo.moduleName, className),
        fileInfo.moduleName,
        fileInfo.filePath,
        ClassTypeFlags.TypedDictClass,
        ParseTreeUtils.getTypeSourceId(dictNode),
        /* declaredMetaclass */ undefined,
        typedDictClass.details.effectiveMetaclass
    );
    classType.details.baseClasses.push(typedDictClass);
    computeMroLinearization(classType);

    getTypedDictFieldsFromDictSyntax(evaluator, dictNode, classType.details.fields);
    synthesizeTypedDictClassMethods(evaluator, dictNode, classType, /* isClassFinal */ true);

    return classType;
}

export function synthesizeTypedDictClassMethods(
    evaluator: TypeEvaluator,
    node: ClassNode | ExpressionNode,
    classType: ClassType,
    isClassFinal: boolean
) {
    assert(ClassType.isTypedDictClass(classType));

    // Synthesize a __new__ method.
    const newType = FunctionType.createSynthesizedInstance('__new__', FunctionTypeFlags.ConstructorMethod);
    FunctionType.addParameter(newType, {
        category: ParameterCategory.Simple,
        name: 'cls',
        type: classType,
        hasDeclaredType: true,
    });
    FunctionType.addDefaultParameters(newType);
    newType.details.declaredReturnType = ClassType.cloneAsInstance(classType);

    // Synthesize an __init__ method with two overrides.
    const initOverride1 = FunctionType.createSynthesizedInstance('__init__', FunctionTypeFlags.Overloaded);
    FunctionType.addParameter(initOverride1, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: ClassType.cloneAsInstance(classType),
        hasDeclaredType: true,
    });
    initOverride1.details.declaredReturnType = NoneType.createInstance();

    // The first parameter must be positional-only.
    FunctionType.addParameter(initOverride1, {
        category: ParameterCategory.Simple,
        name: '__map',
        type: ClassType.cloneAsInstance(classType),
        hasDeclaredType: true,
    });

    FunctionType.addParameter(initOverride1, {
        category: ParameterCategory.Simple,
        name: '',
        type: UnknownType.create(),
    });

    // All subsequent parameters must be named, so insert an empty "*".
    FunctionType.addParameter(initOverride1, {
        category: ParameterCategory.ArgsList,
        type: AnyType.create(),
        hasDeclaredType: true,
    });

    const initOverride2 = FunctionType.createSynthesizedInstance('__init__', FunctionTypeFlags.Overloaded);
    FunctionType.addParameter(initOverride2, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: ClassType.cloneAsInstance(classType),
        hasDeclaredType: true,
    });
    initOverride2.details.declaredReturnType = NoneType.createInstance();

    // All parameters must be named, so insert an empty "*".
    FunctionType.addParameter(initOverride2, {
        category: ParameterCategory.ArgsList,
        type: AnyType.create(),
        hasDeclaredType: true,
    });

    const entries = getTypedDictMembersForClass(evaluator, classType);
    let allEntriesAreNotRequired = true;
    let allEntriesAreReadOnly = true;
    let allEntriesAreWritable = true;
    entries.forEach((entry, name) => {
        FunctionType.addParameter(initOverride1, {
            category: ParameterCategory.Simple,
            name,
            hasDefault: true,
            type: entry.valueType,
            hasDeclaredType: true,
        });

        FunctionType.addParameter(initOverride2, {
            category: ParameterCategory.Simple,
            name,
            hasDefault: !entry.isRequired,
            type: entry.valueType,
            hasDeclaredType: true,
        });

        if (entry.isRequired) {
            allEntriesAreNotRequired = false;
        }

        if (entry.isReadOnly) {
            allEntriesAreWritable = false;
        } else {
            allEntriesAreReadOnly = false;
        }
    });

    const symbolTable = classType.details.fields;
    const initType = OverloadedFunctionType.create([initOverride1, initOverride2]);
    symbolTable.set('__init__', Symbol.createWithType(SymbolFlags.ClassMember, initType));
    symbolTable.set('__new__', Symbol.createWithType(SymbolFlags.ClassMember, newType));

    const strClass = evaluator.getBuiltInType(node, 'str');

    // Synthesize a "get", pop, and setdefault method for each named entry.
    if (isInstantiableClass(strClass)) {
        const selfParam: FunctionParameter = {
            category: ParameterCategory.Simple,
            name: 'self',
            type: ClassType.cloneAsInstance(classType),
            hasDeclaredType: true,
        };

        function createDefaultTypeVar(func: FunctionType) {
            let defaultTypeVar = TypeVarType.createInstance(`__TDefault`);
            defaultTypeVar = TypeVarType.cloneForScopeId(
                defaultTypeVar,
                func.details.typeVarScopeId!,
                classType.details.name,
                TypeVarScopeType.Function
            );
            return defaultTypeVar;
        }

        function createGetMethod(
            keyType: Type,
            valueType: Type,
            includeDefault: boolean,
            isEntryRequired = false,
            defaultTypeMatchesField = false
        ) {
            const getOverload = FunctionType.createSynthesizedInstance('get', FunctionTypeFlags.Overloaded);
            FunctionType.addParameter(getOverload, selfParam);
            getOverload.details.typeVarScopeId = ParseTreeUtils.getScopeIdForNode(node);
            FunctionType.addParameter(getOverload, {
                category: ParameterCategory.Simple,
                name: 'k',
                type: keyType,
                hasDeclaredType: true,
            });

            if (includeDefault) {
                const defaultTypeVar = createDefaultTypeVar(getOverload);
                let defaultParamType: Type;
                let returnType: Type;

                if (isEntryRequired) {
                    // If the entry is required, the type of the default param doesn't matter
                    // because the type will always come from the value.
                    defaultParamType = AnyType.create();
                    returnType = valueType;
                } else {
                    if (defaultTypeMatchesField) {
                        defaultParamType = valueType;
                    } else {
                        defaultParamType = combineTypes([valueType, defaultTypeVar]);
                    }

                    returnType = defaultParamType;
                }

                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'default',
                    type: defaultParamType,
                    hasDeclaredType: true,
                });
                getOverload.details.declaredReturnType = returnType;
            } else {
                getOverload.details.declaredReturnType = isEntryRequired
                    ? valueType
                    : combineTypes([valueType, NoneType.createInstance()]);
            }
            return getOverload;
        }

        function createPopMethods(keyType: Type, valueType: Type) {
            const keyParam: FunctionParameter = {
                category: ParameterCategory.Simple,
                name: 'k',
                type: keyType,
                hasDeclaredType: true,
            };

            const popOverload1 = FunctionType.createSynthesizedInstance('pop', FunctionTypeFlags.Overloaded);
            FunctionType.addParameter(popOverload1, selfParam);
            FunctionType.addParameter(popOverload1, keyParam);
            popOverload1.details.declaredReturnType = valueType;

            const popOverload2 = FunctionType.createSynthesizedInstance('pop', FunctionTypeFlags.Overloaded);
            FunctionType.addParameter(popOverload2, selfParam);
            FunctionType.addParameter(popOverload2, keyParam);
            popOverload2.details.typeVarScopeId = ParseTreeUtils.getScopeIdForNode(node);
            const defaultTypeVar = createDefaultTypeVar(popOverload2);
            FunctionType.addParameter(popOverload2, {
                category: ParameterCategory.Simple,
                name: 'default',
                hasDeclaredType: true,
                type: defaultTypeVar,
                hasDefault: true,
            });
            popOverload2.details.declaredReturnType = combineTypes([valueType, defaultTypeVar]);
            return [popOverload1, popOverload2];
        }

        function createSetDefaultMethod(keyType: Type, valueType: Type) {
            const setDefaultOverload = FunctionType.createSynthesizedInstance(
                'setdefault',
                FunctionTypeFlags.Overloaded
            );
            FunctionType.addParameter(setDefaultOverload, selfParam);
            FunctionType.addParameter(setDefaultOverload, {
                category: ParameterCategory.Simple,
                name: 'k',
                hasDeclaredType: true,
                type: keyType,
            });
            FunctionType.addParameter(setDefaultOverload, {
                category: ParameterCategory.Simple,
                name: 'default',
                hasDeclaredType: true,
                type: valueType,
            });
            setDefaultOverload.details.declaredReturnType = valueType;
            return setDefaultOverload;
        }

        function createDelItemMethod(keyType: Type) {
            const delItemOverload = FunctionType.createSynthesizedInstance('delitem', FunctionTypeFlags.Overloaded);
            FunctionType.addParameter(delItemOverload, selfParam);
            FunctionType.addParameter(delItemOverload, {
                category: ParameterCategory.Simple,
                name: 'k',
                hasDeclaredType: true,
                type: keyType,
            });
            delItemOverload.details.declaredReturnType = NoneType.createInstance();
            return delItemOverload;
        }

        function createUpdateMethod() {
            const updateMethod = FunctionType.createSynthesizedInstance('update');
            FunctionType.addParameter(updateMethod, selfParam);

            // If at least one entry is read-only, don't allow updates. We need to override
            // the update method provided by the _TypedDict base class, so we'll use
            // a Never parameter to generate an error if someone attempts to call it
            // in this case.
            FunctionType.addParameter(updateMethod, {
                category: ParameterCategory.Simple,
                name: '__m',
                hasDeclaredType: true,
                type: !allEntriesAreWritable
                    ? NeverType.createNever()
                    : ClassType.cloneAsInstance(ClassType.cloneForPartialTypedDict(classType)),
            });

            FunctionType.addParameter(updateMethod, {
                category: ParameterCategory.Simple,
                name: '',
                type: AnyType.create(),
            });

            updateMethod.details.declaredReturnType = NoneType.createInstance();
            return updateMethod;
        }

        const getOverloads: FunctionType[] = [];
        const popOverloads: FunctionType[] = [];
        const setDefaultOverloads: FunctionType[] = [];

        entries.forEach((entry, name) => {
            const nameLiteralType = ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strClass, name));

            getOverloads.push(
                createGetMethod(nameLiteralType, entry.valueType, /* includeDefault */ false, entry.isRequired)
            );

            if (entry.isRequired) {
                getOverloads.push(
                    createGetMethod(
                        nameLiteralType,
                        entry.valueType,
                        /* includeDefault */ true,
                        /* isEntryRequired */ true,
                        /* defaultTypeMatchesField */ true
                    )
                );
            } else {
                getOverloads.push(
                    createGetMethod(
                        nameLiteralType,
                        entry.valueType,
                        /* includeDefault */ true,
                        /* isEntryRequired */ false,
                        /* defaultTypeMatchesField */ false
                    )
                );
            }

            // Add a pop method if the entry is not required.
            if (!entry.isRequired && !entry.isReadOnly) {
                appendArray(popOverloads, createPopMethods(nameLiteralType, entry.valueType));
            }

            if (!entry.isReadOnly) {
                setDefaultOverloads.push(createSetDefaultMethod(nameLiteralType, entry.valueType));
            }
        });

        // If the class is marked "@final", we can assume that any other literal
        // key values will return the default parameter value.
        if (isClassFinal) {
            const literalStringType = evaluator.getTypingType(node, 'LiteralString');
            if (literalStringType && isInstantiableClass(literalStringType)) {
                const literalStringInstance = ClassType.cloneAsInstance(literalStringType);
                getOverloads.push(
                    createGetMethod(
                        literalStringInstance,
                        NoneType.createInstance(),
                        /* includeDefault */ false,
                        /* isEntryRequired */ true
                    )
                );
                getOverloads.push(
                    createGetMethod(literalStringInstance, /* valueType */ AnyType.create(), /* includeDefault */ true)
                );
            }
        }

        // Provide a final `get` overload that handles the general case where
        // the key is a str but the literal value isn't known.
        const strType = ClassType.cloneAsInstance(strClass);
        getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ false));
        getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ true));

        symbolTable.set(
            'get',
            Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(getOverloads))
        );

        if (popOverloads.length > 0) {
            symbolTable.set(
                'pop',
                Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(popOverloads))
            );
        }

        if (setDefaultOverloads.length > 0) {
            symbolTable.set(
                'setdefault',
                Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(setDefaultOverloads))
            );
        }

        if (!allEntriesAreReadOnly) {
            symbolTable.set(
                '__delitem__',
                Symbol.createWithType(SymbolFlags.ClassMember, createDelItemMethod(strType))
            );
        }

        symbolTable.set('update', Symbol.createWithType(SymbolFlags.ClassMember, createUpdateMethod()));

        // If the TypedDict is final and all of its entries are NotRequired,
        // add a "clear" and "popitem" method.
        if (isClassFinal && allEntriesAreNotRequired && !allEntriesAreReadOnly) {
            const clearMethod = FunctionType.createSynthesizedInstance('clear');
            FunctionType.addParameter(clearMethod, selfParam);
            clearMethod.details.declaredReturnType = NoneType.createInstance();
            symbolTable.set('clear', Symbol.createWithType(SymbolFlags.ClassMember, clearMethod));

            const popItemMethod = FunctionType.createSynthesizedInstance('popitem');
            FunctionType.addParameter(popItemMethod, selfParam);
            let tupleType = evaluator.getTupleClassType();
            if (tupleType && isInstantiableClass(tupleType)) {
                tupleType = specializeTupleClass(
                    ClassType.cloneAsInstance(tupleType),
                    [
                        { type: strType, isUnbounded: false },
                        { type: UnknownType.create(), isUnbounded: false },
                    ],
                    /* isTypeArgumentExplicit */ true
                );
            } else {
                tupleType = UnknownType.create();
            }
            popItemMethod.details.declaredReturnType = tupleType;
            symbolTable.set('popitem', Symbol.createWithType(SymbolFlags.ClassMember, popItemMethod));
        }
    }
}

export function getTypedDictMembersForClass(evaluator: TypeEvaluator, classType: ClassType, allowNarrowed = false) {
    // Were the entries already calculated and cached?
    if (!classType.details.typedDictEntries) {
        const entries = new Map<string, TypedDictEntry>();
        getTypedDictMembersForClassRecursive(evaluator, classType, entries);

        // Cache the entries for next time.
        classType.details.typedDictEntries = entries;
    }

    const typeVarContext = buildTypeVarContextFromSpecializedClass(classType);

    // Create a specialized copy of the entries so the caller can mutate them.
    const entries = new Map<string, TypedDictEntry>();
    classType.details.typedDictEntries!.forEach((value, key) => {
        const tdEntry = { ...value };
        tdEntry.valueType = applySolvedTypeVars(tdEntry.valueType, typeVarContext);
        entries.set(key, tdEntry);
    });

    // Apply narrowed types on top of existing entries if present.
    if (allowNarrowed && classType.typedDictNarrowedEntries) {
        classType.typedDictNarrowedEntries.forEach((value, key) => {
            const tdEntry = { ...value };
            tdEntry.valueType = applySolvedTypeVars(tdEntry.valueType, typeVarContext);
            entries.set(key, tdEntry);
        });
    }

    // If the class is "Partial", make all entries optional.
    if (classType.isTypedDictPartial) {
        entries.forEach((entry) => {
            entry.isRequired = false;
        });
    }

    return entries;
}

function getTypedDictFieldsFromDictSyntax(
    evaluator: TypeEvaluator,
    entryDict: DictionaryNode,
    classFields: SymbolTable
) {
    const entrySet = new Set<string>();
    const fileInfo = AnalyzerNodeInfo.getFileInfo(entryDict);

    entryDict.entries.forEach((entry) => {
        if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry) {
            evaluator.addError(Localizer.Diagnostic.typedDictSecondArgDictEntry(), entry);
            return;
        }

        if (entry.keyExpression.nodeType !== ParseNodeType.StringList) {
            evaluator.addError(Localizer.Diagnostic.typedDictEntryName(), entry.keyExpression);
            return;
        }

        const entryName = entry.keyExpression.strings.map((s) => s.value).join('');
        if (!entryName) {
            evaluator.addError(Localizer.Diagnostic.typedDictEmptyName(), entry.keyExpression);
            return;
        }

        if (entrySet.has(entryName)) {
            evaluator.addError(Localizer.Diagnostic.typedDictEntryUnique(), entry.keyExpression);
            return;
        }

        // Record names in a set to detect duplicates.
        entrySet.add(entryName);

        const newSymbol = new Symbol(SymbolFlags.InstanceMember);
        const declaration: VariableDeclaration = {
            type: DeclarationType.Variable,
            node: entry.keyExpression,
            path: fileInfo.filePath,
            typeAnnotationNode: entry.valueExpression,
            isRuntimeTypeExpression: true,
            range: convertOffsetsToRange(
                entry.keyExpression.start,
                TextRange.getEnd(entry.keyExpression),
                fileInfo.lines
            ),
            moduleName: fileInfo.moduleName,
            isInExceptSuite: false,
        };
        newSymbol.addDeclaration(declaration);

        classFields.set(entryName, newSymbol);
    });

    // Set the type in the type cache for the dict node so it doesn't
    // get evaluated again.
    evaluator.setTypeForNode(entryDict);
}

function getTypedDictMembersForClassRecursive(
    evaluator: TypeEvaluator,
    classType: ClassType,
    keyMap: Map<string, TypedDictEntry>,
    recursionCount = 0
) {
    assert(ClassType.isTypedDictClass(classType));
    if (recursionCount > maxTypeRecursionCount) {
        return;
    }
    recursionCount++;

    classType.details.baseClasses.forEach((baseClassType) => {
        if (isInstantiableClass(baseClassType) && ClassType.isTypedDictClass(baseClassType)) {
            const specializedBaseClassType = partiallySpecializeType(baseClassType, classType);
            assert(isClass(specializedBaseClassType));
            getTypedDictMembersForClassRecursive(evaluator, specializedBaseClassType, keyMap, recursionCount);
        }
    });

    const typeVarContext = buildTypeVarContextFromSpecializedClass(classType);

    // Add any new typed dict entries from this class.
    classType.details.fields.forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            // Only variables (not functions, classes, etc.) are considered.
            const lastDecl = getLastTypedDeclaredForSymbol(symbol);
            if (lastDecl && lastDecl.type === DeclarationType.Variable) {
                let valueType = evaluator.getEffectiveTypeOfSymbol(symbol);
                valueType = applySolvedTypeVars(valueType, typeVarContext);

                let isRequired = !ClassType.isCanOmitDictValues(classType);
                let isReadOnly = ClassType.isDictValuesReadOnly(classType);

                if (isRequiredTypedDictVariable(evaluator, symbol)) {
                    isRequired = true;
                } else if (isNotRequiredTypedDictVariable(evaluator, symbol)) {
                    isRequired = false;
                }

                if (isReadOnlyTypedDictVariable(evaluator, symbol)) {
                    isReadOnly = true;
                }

                // If a base class already declares this field, verify that the
                // subclass isn't trying to change its type. That's expressly
                // forbidden in PEP 589.
                const existingEntry = keyMap.get(name);
                if (existingEntry) {
                    let isTypeCompatible: boolean;
                    const diag = new DiagnosticAddendum();

                    // If the field is read-only, the type is covariant. If it's not
                    // read-only, it's invariant.
                    if (existingEntry.isReadOnly) {
                        isTypeCompatible = evaluator.assignType(
                            existingEntry.valueType,
                            valueType,
                            diag.createAddendum()
                        );
                    } else {
                        isTypeCompatible = isTypeSame(existingEntry.valueType, valueType);
                    }

                    if (!isTypeCompatible) {
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.typedDictFieldTypeRedefinition().format({
                                parentType: evaluator.printType(existingEntry.valueType),
                                childType: evaluator.printType(valueType),
                            })
                        );
                        evaluator.addDiagnostic(
                            AnalyzerNodeInfo.getFileInfo(lastDecl.node).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.typedDictFieldTypeRedefinition().format({
                                name,
                            }) + diag.getString(),
                            lastDecl.node
                        );
                    }

                    // Make sure that the derived class isn't marking a previously writable
                    // entry as read-only.
                    if (!existingEntry.isReadOnly && isReadOnly) {
                        evaluator.addDiagnostic(
                            AnalyzerNodeInfo.getFileInfo(lastDecl.node).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.typedDictFieldReadOnlyRedefinition().format({
                                name,
                            }),
                            lastDecl.node
                        );
                    }
                }

                keyMap.set(name, {
                    valueType,
                    isReadOnly,
                    isRequired,
                    isProvided: false,
                });
            }
        }
    });
}

export function assignTypedDictToTypedDict(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType,
    diag: DiagnosticAddendum | undefined,
    typeVarContext: TypeVarContext | undefined,
    flags: AssignTypeFlags,
    recursionCount = 0
) {
    let typesAreConsistent = true;
    const isDestPartial = !!destType.isTypedDictPartial;
    const destEntries = getTypedDictMembersForClass(evaluator, destType);
    const srcEntries = getTypedDictMembersForClass(evaluator, srcType, /* allowNarrowed */ true);

    destEntries.forEach((destEntry, name) => {
        const srcEntry = srcEntries.get(name);
        if (!srcEntry) {
            if (!isDestPartial) {
                diag?.createAddendum().addMessage(
                    Localizer.DiagnosticAddendum.typedDictFieldMissing().format({
                        name,
                        type: evaluator.printType(srcType),
                    })
                );
                typesAreConsistent = false;
            }
        } else {
            if (destEntry.isRequired !== srcEntry.isRequired && !destEntry.isReadOnly && !isDestPartial) {
                const message = destEntry.isRequired
                    ? Localizer.DiagnosticAddendum.typedDictFieldRequired()
                    : Localizer.DiagnosticAddendum.typedDictFieldNotRequired();
                diag?.createAddendum().addMessage(
                    message.format({
                        name,
                        type: evaluator.printType(destType),
                    })
                );
                typesAreConsistent = false;
            }

            if (!destEntry.isReadOnly && srcEntry.isReadOnly && !isDestPartial) {
                diag?.createAddendum().addMessage(
                    Localizer.DiagnosticAddendum.typedDictFieldNotReadOnly().format({
                        name,
                        type: evaluator.printType(destType),
                    })
                );
                typesAreConsistent = false;
            }

            const subDiag = diag?.createAddendum();
            if (
                !evaluator.assignType(
                    destEntry.valueType,
                    srcEntry.valueType,
                    subDiag?.createAddendum(),
                    typeVarContext,
                    /* srcTypeVarContext */ undefined,
                    flags,
                    recursionCount
                )
            ) {
                subDiag?.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                typesAreConsistent = false;
            }
        }
    });

    return typesAreConsistent;
}

// Determines whether the specified keys and values can be assigned to
// a typed dictionary class. The caller should have already validated
// that the class is indeed a typed dict. If the types are compatible,
// the typed dict class or a narrowed form of the class is returned.
// Narrowing is possible when not-required keys are provided. If the
// types are not compatible, the function returns undefined.
export function assignToTypedDict(
    evaluator: TypeEvaluator,
    classType: ClassType,
    keyTypes: TypeResultWithNode[],
    valueTypes: TypeResultWithNode[],
    diagAddendum?: DiagnosticAddendum
): ClassType | undefined {
    assert(isClassInstance(classType));
    assert(ClassType.isTypedDictClass(classType));
    assert(keyTypes.length === valueTypes.length);

    let isMatch = true;
    const narrowedEntries = new Map<string, TypedDictEntry>();

    let typeVarContext: TypeVarContext | undefined;
    let genericClassType = classType;

    if (classType.details.typeParameters.length > 0) {
        typeVarContext = new TypeVarContext(getTypeVarScopeId(classType));

        // Create a generic (nonspecialized version) of the class.
        if (classType.typeArguments) {
            genericClassType = ClassType.cloneForSpecialization(
                classType,
                /* typeArguments */ undefined,
                /* isTypeArgumentExplicit */ false
            );
        }
    }

    const symbolMap = getTypedDictMembersForClass(evaluator, genericClassType);

    keyTypes.forEach((keyTypeResult, index) => {
        const keyType = keyTypeResult.type;
        if (!isClassInstance(keyType) || !ClassType.isBuiltIn(keyType, 'str') || !isLiteralType(keyType)) {
            isMatch = false;
        } else {
            const keyValue = keyType.literalValue as string;
            const symbolEntry = symbolMap.get(keyValue);

            if (!symbolEntry) {
                // The provided key name doesn't exist.
                isMatch = false;
                if (diagAddendum) {
                    const subDiag = diagAddendum?.createAddendum();
                    subDiag.addMessage(
                        Localizer.DiagnosticAddendum.typedDictFieldUndefined().format({
                            name: keyType.literalValue as string,
                            type: evaluator.printType(ClassType.cloneAsInstance(classType)),
                        })
                    );

                    subDiag.addTextRange(keyTypeResult.node);
                }
            } else {
                // Can we assign the value to the declared type?
                const subDiag = diagAddendum?.createAddendum();
                if (
                    !evaluator.assignType(
                        symbolEntry.valueType,
                        valueTypes[index].type,
                        subDiag?.createAddendum(),
                        typeVarContext,
                        /* srcTypeVarContext */ undefined,
                        AssignTypeFlags.RetainLiteralsForTypeVar
                    )
                ) {
                    if (subDiag) {
                        subDiag.addMessage(
                            Localizer.DiagnosticAddendum.typedDictFieldTypeMismatch().format({
                                name: keyType.literalValue as string,
                                type: evaluator.printType(valueTypes[index].type),
                            })
                        );

                        subDiag.addTextRange(keyTypeResult.node);
                    }
                    isMatch = false;
                }

                if (!symbolEntry.isRequired) {
                    narrowedEntries.set(keyValue, {
                        valueType: valueTypes[index].type,
                        isReadOnly: !!valueTypes[index].isReadOnly,
                        isRequired: false,
                        isProvided: true,
                    });
                }

                symbolEntry.isProvided = true;
            }
        }
    });

    if (!isMatch) {
        return undefined;
    }

    // See if any required keys are missing.
    symbolMap.forEach((entry, name) => {
        if (entry.isRequired && !entry.isProvided) {
            if (diagAddendum) {
                diagAddendum.addMessage(
                    Localizer.DiagnosticAddendum.typedDictFieldRequired().format({
                        name,
                        type: evaluator.printType(classType),
                    })
                );
            }
            isMatch = false;
        }
    });

    if (!isMatch) {
        return undefined;
    }

    const specializedClassType = typeVarContext
        ? (applySolvedTypeVars(genericClassType, typeVarContext) as ClassType)
        : classType;

    return narrowedEntries.size === 0
        ? specializedClassType
        : ClassType.cloneForNarrowedTypedDictEntries(specializedClassType, narrowedEntries);
}

export function getTypeOfIndexedTypedDict(
    evaluator: TypeEvaluator,
    node: IndexNode,
    baseType: ClassType,
    usage: EvaluatorUsage
): TypeResult | undefined {
    if (node.items.length !== 1) {
        evaluator.addError(Localizer.Diagnostic.typeArgsMismatchOne().format({ received: node.items.length }), node);
        return { type: UnknownType.create() };
    }

    // Look for subscript types that are not supported by TypedDict.
    if (node.trailingComma || node.items[0].name || node.items[0].argumentCategory !== ArgumentCategory.Simple) {
        return undefined;
    }

    const entries = getTypedDictMembersForClass(evaluator, baseType, /* allowNarrowed */ usage.method === 'get');

    const indexTypeResult = evaluator.getTypeOfExpression(node.items[0].valueExpression);
    const indexType = indexTypeResult.type;
    let diag = new DiagnosticAddendum();
    let allDiagsInvolveNotRequiredKeys = true;

    const resultingType = mapSubtypes(indexType, (subtype) => {
        if (isAnyOrUnknown(subtype)) {
            return subtype;
        }

        if (isClassInstance(subtype) && ClassType.isBuiltIn(subtype, 'str')) {
            if (subtype.literalValue === undefined) {
                // If it's a plain str with no literal value, we can't
                // make any determination about the resulting type.
                return UnknownType.create();
            }

            // Look up the entry in the typed dict to get its type.
            const entryName = subtype.literalValue as string;
            const entry = entries.get(entryName);
            if (!entry) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.keyUndefined().format({
                        name: entryName,
                        type: evaluator.printType(baseType),
                    })
                );
                allDiagsInvolveNotRequiredKeys = false;
                return UnknownType.create();
            } else if (!(entry.isRequired || entry.isProvided) && usage.method === 'get') {
                if (!ParseTreeUtils.isWithinTryBlock(node, /* treatWithAsTryBlock */ true)) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.keyNotRequired().format({
                            name: entryName,
                            type: evaluator.printType(baseType),
                        })
                    );
                }
            } else if (entry.isReadOnly && usage.method !== 'get') {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.keyReadOnly().format({
                        name: entryName,
                        type: evaluator.printType(baseType),
                    })
                );
            }

            if (usage.method === 'set') {
                if (!evaluator.assignType(entry.valueType, usage.setType?.type ?? AnyType.create(), diag)) {
                    allDiagsInvolveNotRequiredKeys = false;
                }
            } else if (usage.method === 'del' && entry.isRequired) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.keyRequiredDeleted().format({
                        name: entryName,
                    })
                );
                allDiagsInvolveNotRequiredKeys = false;
            }

            return entry.valueType;
        }

        diag.addMessage(
            Localizer.DiagnosticAddendum.typeNotStringLiteral().format({ type: evaluator.printType(subtype) })
        );
        allDiagsInvolveNotRequiredKeys = false;
        return UnknownType.create();
    });

    // If we have an "expected type" diagnostic addendum (used for assignments),
    // use that rather than the local diagnostic information because it will
    // be more informative.
    if (usage.setExpectedTypeDiag && !diag.isEmpty() && !usage.setExpectedTypeDiag.isEmpty()) {
        diag = usage.setExpectedTypeDiag;
    }

    if (!diag.isEmpty()) {
        let typedDictDiag: string;
        if (usage.method === 'set') {
            typedDictDiag = Localizer.Diagnostic.typedDictSet();
        } else if (usage.method === 'del') {
            typedDictDiag = Localizer.Diagnostic.typedDictDelete();
        } else {
            typedDictDiag = Localizer.Diagnostic.typedDictAccess();
        }

        const fileInfo = AnalyzerNodeInfo.getFileInfo(node);
        evaluator.addDiagnostic(
            allDiagsInvolveNotRequiredKeys
                ? fileInfo.diagnosticRuleSet.reportTypedDictNotRequiredAccess
                : fileInfo.diagnosticRuleSet.reportGeneralTypeIssues,
            allDiagsInvolveNotRequiredKeys
                ? DiagnosticRule.reportTypedDictNotRequiredAccess
                : DiagnosticRule.reportGeneralTypeIssues,
            typedDictDiag + diag.getString(),
            node
        );
    }

    return { type: resultingType, isIncomplete: !!indexTypeResult.isIncomplete };
}

// If the specified type has a non-required key, this method marks the
// key as present.
export function narrowForKeyAssignment(classType: ClassType, key: string) {
    // We should never be called if the classType is not a TypedDict or if typedDictEntries
    // is empty, but this can theoretically happen in the presence of certain circular
    // dependencies.
    if (!ClassType.isTypedDictClass(classType) || !classType.details.typedDictEntries) {
        return classType;
    }

    const tdEntry = classType.details.typedDictEntries.get(key);
    if (!tdEntry || tdEntry.isRequired) {
        return classType;
    }

    const narrowedTdEntry = classType.typedDictNarrowedEntries?.get(key);
    if (narrowedTdEntry?.isProvided) {
        return classType;
    }

    const narrowedEntries = classType.typedDictNarrowedEntries
        ? new Map<string, TypedDictEntry>(classType.typedDictNarrowedEntries)
        : new Map<string, TypedDictEntry>();
    narrowedEntries.set(key, {
        isProvided: true,
        isRequired: false,
        isReadOnly: tdEntry.isReadOnly,
        valueType: tdEntry.valueType,
    });

    return ClassType.cloneForNarrowedTypedDictEntries(classType, narrowedEntries);
}

function isRequiredTypedDictVariable(evaluator: TypeEvaluator, symbol: Symbol) {
    return symbol.getDeclarations().some((decl) => {
        if (decl.type !== DeclarationType.Variable || !decl.typeAnnotationNode) {
            return false;
        }

        const annotatedType = evaluator.getTypeOfExpressionExpectingType(decl.typeAnnotationNode, {
            allowFinal: true,
            allowRequired: true,
        });

        return !!annotatedType.isRequired;
    });
}

function isNotRequiredTypedDictVariable(evaluator: TypeEvaluator, symbol: Symbol) {
    return symbol.getDeclarations().some((decl) => {
        if (decl.type !== DeclarationType.Variable || !decl.typeAnnotationNode) {
            return false;
        }

        const annotatedType = evaluator.getTypeOfExpressionExpectingType(decl.typeAnnotationNode, {
            allowFinal: true,
            allowRequired: true,
        });

        return !!annotatedType.isNotRequired;
    });
}

function isReadOnlyTypedDictVariable(evaluator: TypeEvaluator, symbol: Symbol) {
    return symbol.getDeclarations().some((decl) => {
        if (decl.type !== DeclarationType.Variable || !decl.typeAnnotationNode) {
            return false;
        }

        const annotatedType = evaluator.getTypeOfExpressionExpectingType(decl.typeAnnotationNode, {
            allowFinal: true,
            allowRequired: true,
        });

        return !!annotatedType.isReadOnly;
    });
}
