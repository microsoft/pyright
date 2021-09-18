/*
 * typedDicts.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides special-case logic for the construction of TypedDict
 * classes.
 */

import { assert } from '../common/debug';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetsToRange } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
import {
    ArgumentCategory,
    ClassNode,
    ExpressionNode,
    IndexNode,
    ParameterCategory,
    ParseNodeType,
} from '../parser/parseNodes';
import { KeywordType } from '../parser/tokenizerTypes';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { DeclarationType, VariableDeclaration } from './declaration';
import * as ParseTreeUtils from './parseTreeUtils';
import { Symbol, SymbolFlags } from './symbol';
import {
    getLastTypedDeclaredForSymbol,
    isNotRequiredTypedDictVariable,
    isRequiredTypedDictVariable,
} from './symbolUtils';
import { EvaluatorUsage, FunctionArgument, TypeEvaluator, TypeResult } from './typeEvaluatorTypes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParameter,
    FunctionType,
    FunctionTypeFlags,
    isAnyOrUnknown,
    isClassInstance,
    isInstantiableClass,
    isTypeSame,
    maxTypeRecursionCount,
    NoneType,
    OverloadedFunctionType,
    Type,
    TypedDictEntry,
    TypeVarType,
    UnknownType,
} from './types';
import { computeMroLinearization, isLiteralType, mapSubtypes } from './typeUtils';

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
        const entryMap = new Map<string, boolean>();

        if (
            entriesArg.argumentCategory === ArgumentCategory.Simple &&
            entriesArg.valueExpression &&
            entriesArg.valueExpression.nodeType === ParseNodeType.Dictionary
        ) {
            usingDictSyntax = true;
            const entryDict = entriesArg.valueExpression;

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

                if (entryMap.has(entryName)) {
                    evaluator.addError(Localizer.Diagnostic.typedDictEntryUnique(), entry.keyExpression);
                    return;
                }

                // Record names in a map to detect duplicates.
                entryMap.set(entryName, true);

                // Cache the annotation type.
                evaluator.getTypeForExpressionExpectingType(entry.valueExpression, /* allowFinal */ true);

                const newSymbol = new Symbol(SymbolFlags.InstanceMember);
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: entry.keyExpression,
                    path: fileInfo.filePath,
                    typeAnnotationNode: entry.valueExpression,
                    range: convertOffsetsToRange(
                        entry.keyExpression.start,
                        TextRange.getEnd(entry.keyExpression),
                        fileInfo.lines
                    ),
                    moduleName: fileInfo.moduleName,
                };
                newSymbol.addDeclaration(declaration);

                classFields.set(entryName, newSymbol);
            });
        } else if (entriesArg.name) {
            for (let i = 1; i < argList.length; i++) {
                const entry = argList[i];
                if (!entry.name || !entry.valueExpression) {
                    continue;
                }

                if (entryMap.has(entry.name.value)) {
                    evaluator.addError(Localizer.Diagnostic.typedDictEntryUnique(), entry.valueExpression);
                    continue;
                }

                // Record names in a map to detect duplicates.
                entryMap.set(entry.name.value, true);

                // Evaluate the type with specific evaluation flags. The
                // type will be cached for later.
                evaluator.getTypeForExpressionExpectingType(entry.valueExpression, /* allowFinal */ true);

                const newSymbol = new Symbol(SymbolFlags.InstanceMember);
                const fileInfo = AnalyzerNodeInfo.getFileInfo(errorNode);
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: entry.name,
                    path: fileInfo.filePath,
                    typeAnnotationNode: entry.valueExpression,
                    range: convertOffsetsToRange(
                        entry.name.start,
                        TextRange.getEnd(entry.valueExpression),
                        fileInfo.lines
                    ),
                    moduleName: fileInfo.moduleName,
                };
                newSymbol.addDeclaration(declaration);

                classFields.set(entry.name.value, newSymbol);
            }
        } else {
            evaluator.addError(Localizer.Diagnostic.typedDictSecondArgDict(), errorNode);
        }
    }

    if (usingDictSyntax) {
        if (argList.length >= 3) {
            if (
                !argList[2].name ||
                argList[2].name.value !== 'total' ||
                !argList[2].valueExpression ||
                argList[2].valueExpression.nodeType !== ParseNodeType.Constant ||
                !(
                    argList[2].valueExpression.constType === KeywordType.False ||
                    argList[2].valueExpression.constType === KeywordType.True
                )
            ) {
                evaluator.addError(Localizer.Diagnostic.typedDictTotalParam(), argList[2].valueExpression || errorNode);
            } else if (argList[2].valueExpression.constType === KeywordType.False) {
                classType.details.flags |= ClassTypeFlags.CanOmitDictValues;
            }
        }

        if (argList.length > 3) {
            evaluator.addError(Localizer.Diagnostic.typedDictExtraArgs(), argList[3].valueExpression || errorNode);
        }
    }

    synthesizeTypedDictClassMethods(evaluator, errorNode, classType);

    return classType;
}

export function synthesizeTypedDictClassMethods(
    evaluator: TypeEvaluator,
    node: ClassNode | ExpressionNode,
    classType: ClassType
) {
    assert(ClassType.isTypedDictClass(classType));

    // Synthesize a __new__ method.
    const newType = FunctionType.createInstance(
        '__new__',
        '',
        '',
        FunctionTypeFlags.ConstructorMethod | FunctionTypeFlags.SynthesizedMethod
    );
    FunctionType.addParameter(newType, {
        category: ParameterCategory.Simple,
        name: 'cls',
        type: classType,
        hasDeclaredType: true,
    });
    FunctionType.addDefaultParameters(newType);
    newType.details.declaredReturnType = ClassType.cloneAsInstance(classType);

    // Synthesize an __init__ method.
    const initType = FunctionType.createInstance('__init__', '', '', FunctionTypeFlags.SynthesizedMethod);
    FunctionType.addParameter(initType, {
        category: ParameterCategory.Simple,
        name: 'self',
        type: ClassType.cloneAsInstance(classType),
        hasDeclaredType: true,
    });
    initType.details.declaredReturnType = NoneType.createInstance();

    // All parameters must be named, so insert an empty "*".
    FunctionType.addParameter(initType, {
        category: ParameterCategory.VarArgList,
        type: AnyType.create(),
        hasDeclaredType: true,
    });

    const entries = getTypedDictMembersForClass(evaluator, classType);
    entries.forEach((entry, name) => {
        FunctionType.addParameter(initType, {
            category: ParameterCategory.Simple,
            name,
            hasDefault: !entry.isRequired,
            type: entry.valueType,
            hasDeclaredType: true,
        });
    });

    const symbolTable = classType.details.fields;
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
        const typeVarScopeId = evaluator.getScopeIdForNode(node);
        let defaultTypeVar = TypeVarType.createInstance(`__${classType.details.name}_default`);
        defaultTypeVar.details.isSynthesized = true;
        defaultTypeVar = TypeVarType.cloneForScopeId(defaultTypeVar, typeVarScopeId, classType.details.name);

        const createGetMethod = (keyType: Type, valueType: Type, includeDefault: boolean) => {
            const getOverload = FunctionType.createInstance(
                'get',
                '',
                '',
                FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
            );
            FunctionType.addParameter(getOverload, selfParam);
            FunctionType.addParameter(getOverload, {
                category: ParameterCategory.Simple,
                name: 'k',
                type: keyType,
                hasDeclaredType: true,
            });
            if (includeDefault) {
                FunctionType.addParameter(getOverload, {
                    category: ParameterCategory.Simple,
                    name: 'default',
                    type: valueType,
                    hasDeclaredType: true,
                    hasDefault: true,
                });
                getOverload.details.declaredReturnType = valueType;
            } else {
                getOverload.details.declaredReturnType = combineTypes([valueType, NoneType.createInstance()]);
            }
            return getOverload;
        };

        const createPopMethods = (keyType: Type, valueType: Type) => {
            const keyParam: FunctionParameter = {
                category: ParameterCategory.Simple,
                name: 'k',
                type: keyType,
                hasDeclaredType: true,
            };

            const popOverload1 = FunctionType.createInstance(
                'pop',
                '',
                '',
                FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
            );
            FunctionType.addParameter(popOverload1, selfParam);
            FunctionType.addParameter(popOverload1, keyParam);
            popOverload1.details.declaredReturnType = valueType;

            const popOverload2 = FunctionType.createInstance(
                'pop',
                '',
                '',
                FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
            );
            FunctionType.addParameter(popOverload2, selfParam);
            FunctionType.addParameter(popOverload2, keyParam);
            FunctionType.addParameter(popOverload2, {
                category: ParameterCategory.Simple,
                name: 'default',
                hasDeclaredType: true,
                type: defaultTypeVar,
                hasDefault: true,
            });
            popOverload2.details.declaredReturnType = combineTypes([valueType, defaultTypeVar]);
            popOverload2.details.typeVarScopeId = typeVarScopeId;
            return [popOverload1, popOverload2];
        };

        const createSetDefaultMethod = (keyType: Type, valueType: Type, isEntryRequired = false) => {
            const setDefaultOverload = FunctionType.createInstance(
                'setdefault',
                '',
                '',
                FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
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
                type: isEntryRequired ? AnyType.create() : defaultTypeVar,
                hasDefault: true,
            });
            setDefaultOverload.details.declaredReturnType = isEntryRequired
                ? valueType
                : combineTypes([valueType, defaultTypeVar]);
            setDefaultOverload.details.typeVarScopeId = typeVarScopeId;
            return setDefaultOverload;
        };

        const createDelItemMethod = (keyType: Type) => {
            const delItemOverload = FunctionType.createInstance(
                'delitem',
                '',
                '',
                FunctionTypeFlags.SynthesizedMethod | FunctionTypeFlags.Overloaded
            );
            FunctionType.addParameter(delItemOverload, selfParam);
            FunctionType.addParameter(delItemOverload, {
                category: ParameterCategory.Simple,
                name: 'k',
                hasDeclaredType: true,
                type: keyType,
            });
            delItemOverload.details.declaredReturnType = NoneType.createInstance();
            return delItemOverload;
        };

        const getOverloads: FunctionType[] = [];
        const popOverloads: FunctionType[] = [];
        const setDefaultOverloads: FunctionType[] = [];

        entries.forEach((entry, name) => {
            const nameLiteralType = ClassType.cloneAsInstance(ClassType.cloneWithLiteral(strClass, name));

            if (!entry.isRequired) {
                getOverloads.push(createGetMethod(nameLiteralType, entry.valueType, /* includeDefault */ false));
            }
            getOverloads.push(createGetMethod(nameLiteralType, entry.valueType, /* includeDefault */ true));
            popOverloads.push(...createPopMethods(nameLiteralType, entry.valueType));
            setDefaultOverloads.push(createSetDefaultMethod(nameLiteralType, entry.valueType, entry.isRequired));
        });

        // Provide a final overload that handles the general case where the key is
        // a str but the literal value isn't known.
        const strType = ClassType.cloneAsInstance(strClass);
        getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ false));
        getOverloads.push(createGetMethod(strType, AnyType.create(), /* includeDefault */ true));
        popOverloads.push(...createPopMethods(strType, AnyType.create()));
        setDefaultOverloads.push(createSetDefaultMethod(strType, AnyType.create()));

        symbolTable.set(
            'get',
            Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(getOverloads))
        );
        symbolTable.set(
            'pop',
            Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(popOverloads))
        );
        symbolTable.set(
            'setdefault',
            Symbol.createWithType(SymbolFlags.ClassMember, OverloadedFunctionType.create(setDefaultOverloads))
        );
        symbolTable.set('__delitem__', Symbol.createWithType(SymbolFlags.ClassMember, createDelItemMethod(strType)));
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

    // Create a copy of the entries so the caller can mutate them.
    const entries = new Map<string, TypedDictEntry>();
    classType.details.typedDictEntries!.forEach((value, key) => {
        entries.set(key, { ...value });
    });

    // Apply narrowed types on top of existing entries if present.
    if (allowNarrowed && classType.typedDictNarrowedEntries) {
        classType.typedDictNarrowedEntries.forEach((value, key) => {
            entries.set(key, { ...value });
        });
    }

    return entries;
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

    classType.details.baseClasses.forEach((baseClassType) => {
        if (isInstantiableClass(baseClassType) && ClassType.isTypedDictClass(baseClassType)) {
            getTypedDictMembersForClassRecursive(evaluator, baseClassType, keyMap, recursionCount + 1);
        }
    });

    // Add any new typed dict entries from this class.
    classType.details.fields.forEach((symbol, name) => {
        if (!symbol.isIgnoredForProtocolMatch()) {
            // Only variables (not functions, classes, etc.) are considered.
            const lastDecl = getLastTypedDeclaredForSymbol(symbol);
            if (lastDecl && lastDecl.type === DeclarationType.Variable) {
                const valueType = evaluator.getEffectiveTypeOfSymbol(symbol);
                let isRequired = !ClassType.isCanOmitDictValues(classType);

                if (isRequiredTypedDictVariable(symbol)) {
                    isRequired = true;
                } else if (isNotRequiredTypedDictVariable(symbol)) {
                    isRequired = false;
                }

                // If a base class already declares this field, verify that the
                // subclass isn't trying to change its type. That's expressly
                // forbidden in PEP 589.
                const existingEntry = keyMap.get(name);
                if (existingEntry) {
                    if (!isTypeSame(existingEntry.valueType, valueType)) {
                        const diag = new DiagnosticAddendum();
                        diag.addMessage(
                            Localizer.DiagnosticAddendum.typedDictFieldRedefinition().format({
                                parentType: evaluator.printType(existingEntry.valueType),
                                childType: evaluator.printType(valueType),
                            })
                        );
                        evaluator.addDiagnostic(
                            AnalyzerNodeInfo.getFileInfo(lastDecl.node).diagnosticRuleSet.reportGeneralTypeIssues,
                            DiagnosticRule.reportGeneralTypeIssues,
                            Localizer.Diagnostic.typedDictFieldRedefinition().format({
                                name,
                            }) + diag.getString(),
                            lastDecl.node
                        );
                    }
                }

                keyMap.set(name, {
                    valueType,
                    isRequired,
                    isProvided: false,
                });
            }
        }
    });
}

export function canAssignTypedDict(
    evaluator: TypeEvaluator,
    destType: ClassType,
    srcType: ClassType,
    diag: DiagnosticAddendum,
    recursionCount = 0
) {
    let typesAreConsistent = true;
    const destEntries = getTypedDictMembersForClass(evaluator, destType);
    const srcEntries = getTypedDictMembersForClass(evaluator, srcType, /* allowNarrowed */ true);

    destEntries.forEach((destEntry, name) => {
        const srcEntry = srcEntries.get(name);
        if (!srcEntry) {
            diag.addMessage(
                Localizer.DiagnosticAddendum.typedDictFieldMissing().format({
                    name,
                    type: evaluator.printType(srcType),
                })
            );
            typesAreConsistent = false;
        } else {
            if (destEntry.isRequired && !srcEntry.isRequired) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.typedDictFieldRequired().format({
                        name,
                        type: evaluator.printType(destType),
                    })
                );
                typesAreConsistent = false;
            } else if (!destEntry.isRequired && srcEntry.isRequired) {
                diag.addMessage(
                    Localizer.DiagnosticAddendum.typedDictFieldNotRequired().format({
                        name,
                        type: evaluator.printType(destType),
                    })
                );
                typesAreConsistent = false;
            }

            if (
                !isTypeSame(destEntry.valueType, srcEntry.valueType, /* ignorePseudoGeneric */ true, recursionCount + 1)
            ) {
                diag.addMessage(Localizer.DiagnosticAddendum.memberTypeMismatch().format({ name }));
                typesAreConsistent = false;
            }
        }
    });

    return typesAreConsistent;
}

// Determines whether the specified keys and values can be assigned to
// a typed dictionary class. The caller should have already validated
// that the class is indeed a typed dict.
export function canAssignToTypedDict(
    evaluator: TypeEvaluator,
    classType: ClassType,
    keyTypes: Type[],
    valueTypes: Type[],
    diagAddendum: DiagnosticAddendum
): boolean {
    assert(ClassType.isTypedDictClass(classType));
    assert(keyTypes.length === valueTypes.length);

    let isMatch = true;

    const symbolMap = getTypedDictMembersForClass(evaluator, classType);

    keyTypes.forEach((keyType, index) => {
        if (!isClassInstance(keyType) || !ClassType.isBuiltIn(keyType, 'str') || !isLiteralType(keyType)) {
            isMatch = false;
        } else {
            const keyValue = keyType.literalValue as string;
            const symbolEntry = symbolMap.get(keyValue);

            if (!symbolEntry) {
                // The provided key name doesn't exist.
                isMatch = false;
                diagAddendum.addMessage(
                    Localizer.DiagnosticAddendum.typedDictFieldUndefined().format({
                        name: keyType.literalValue as string,
                        type: evaluator.printType(ClassType.cloneAsInstance(classType)),
                    })
                );
            } else {
                // Can we assign the value to the declared type?
                const assignDiag = new DiagnosticAddendum();
                if (!evaluator.canAssignType(symbolEntry.valueType, valueTypes[index], assignDiag)) {
                    diagAddendum.addMessage(
                        Localizer.DiagnosticAddendum.typedDictFieldTypeMismatch().format({
                            name: keyType.literalValue as string,
                            type: evaluator.printType(valueTypes[index]),
                        })
                    );
                    isMatch = false;
                }
                symbolEntry.isProvided = true;
            }
        }
    });

    if (!isMatch) {
        return false;
    }

    // See if any required keys are missing.
    symbolMap.forEach((entry, name) => {
        if (entry.isRequired && !entry.isProvided) {
            diagAddendum.addMessage(
                Localizer.DiagnosticAddendum.typedDictFieldRequired().format({
                    name,
                    type: evaluator.printType(ClassType.cloneAsInstance(classType)),
                })
            );
            isMatch = false;
        }
    });

    return isMatch;
}

export function getTypeFromIndexedTypedDict(
    evaluator: TypeEvaluator,
    node: IndexNode,
    baseType: ClassType,
    usage: EvaluatorUsage
): TypeResult | undefined {
    if (node.items.length !== 1) {
        evaluator.addError(Localizer.Diagnostic.typeArgsMismatchOne().format({ received: node.items.length }), node);
        return { node, type: UnknownType.create() };
    }

    // Look for subscript types that are not supported by TypedDict.
    if (node.trailingComma || node.items[0].name || node.items[0].argumentCategory !== ArgumentCategory.Simple) {
        return undefined;
    }

    const entries = getTypedDictMembersForClass(evaluator, baseType, /* allowNarrowed */ true);

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
                if (!ParseTreeUtils.isWithinTryBlock(node)) {
                    diag.addMessage(
                        Localizer.DiagnosticAddendum.keyNotRequired().format({
                            name: entryName,
                            type: evaluator.printType(baseType),
                        })
                    );
                }
            }

            if (usage.method === 'set') {
                evaluator.canAssignType(entry.valueType, usage.setType || AnyType.create(), diag);
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
    if (usage.setExpectedTypeDiag) {
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

    return { node, type: resultingType, isIncomplete: !!indexTypeResult.isIncomplete };
}
