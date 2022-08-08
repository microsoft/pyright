/*
 * typeEvaluatorWithTracker.ts
 *
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * This wraps real type evaluator to track performance information such
 * as which type inferring takes most of time, what files are read most of times
 * and etc.
 */

import { isDebugMode } from '../common/core';
import { LogTracker } from '../common/logTracker';
import { timingStats } from '../common/timing';
import { ImportLookup } from './analyzerFileInfo';
import { PrintableType, TracePrinter } from './tracePrinter';
import { createTypeEvaluator, EvaluatorOptions } from './typeEvaluator';
import { TypeEvaluator } from './typeEvaluatorTypes';

// We don't want to track calls from the type evaluator itself, but only entry points.
export function createTypeEvaluatorWithTracker(
    importLookup: ImportLookup,
    evaluatorOptions: EvaluatorOptions,
    logger: LogTracker,
    printer?: TracePrinter
) {
    if (!evaluatorOptions.logCalls && isDebugMode()) {
        return createTypeEvaluator(importLookup, evaluatorOptions);
    }

    function run<T>(title: string, callback: () => T, value?: PrintableType): T {
        return evaluatorOptions.logCalls
            ? logger.log(
                  title,
                  (s) => {
                      s.add(printer?.print(value));
                      return timingStats.typeEvaluationTime.timeOperation(callback);
                  },
                  evaluatorOptions.minimumLoggingThreshold,
                  true
              )
            : timingStats.typeEvaluationTime.timeOperation(callback);
    }

    const lookup: ImportLookup = evaluatorOptions.logCalls
        ? (filePath) =>
              logger.log(
                  'import lookup',
                  (s) => {
                      s.add(printer?.printFileOrModuleName(filePath));
                      return importLookup(filePath);
                  },
                  evaluatorOptions.minimumLoggingThreshold,
                  true
              )
        : importLookup;

    const typeEvaluator = createTypeEvaluator(lookup, evaluatorOptions);

    const withTracker: TypeEvaluator = {
        runWithCancellationToken: typeEvaluator.runWithCancellationToken,
        getType: (n) => run('getType', () => typeEvaluator.getType(n), n),
        getTypeOfExpression: (n, f, e) =>
            run('getTypeOfExpression', () => typeEvaluator.getTypeOfExpression(n, f, e), n),
        getTypeOfAnnotation: typeEvaluator.getTypeOfAnnotation,
        getTypeOfClass: (n) => run('getTypeOfClass', () => typeEvaluator.getTypeOfClass(n), n),
        getTypeOfFunction: (n) => run('getTypeOfFunction', () => typeEvaluator.getTypeOfFunction(n), n),
        getTypeOfExpressionExpectingType: typeEvaluator.getTypeOfExpressionExpectingType,
        evaluateTypeForSubnode: typeEvaluator.evaluateTypeForSubnode,
        evaluateTypesForStatement: (n) =>
            run('evaluateTypesForStatement', () => typeEvaluator.evaluateTypesForStatement(n), n),
        evaluateTypesForMatchStatement: typeEvaluator.evaluateTypesForMatchStatement,
        evaluateTypesForCaseStatement: typeEvaluator.evaluateTypesForCaseStatement,
        evaluateTypeOfParameter: typeEvaluator.evaluateTypeOfParameter,
        canBeTruthy: typeEvaluator.canBeTruthy,
        canBeFalsy: typeEvaluator.canBeFalsy,
        stripLiteralValue: typeEvaluator.stripLiteralValue,
        removeTruthinessFromType: typeEvaluator.removeTruthinessFromType,
        removeFalsinessFromType: typeEvaluator.removeFalsinessFromType,
        getExpectedType: (n) => run('getExpectedType', () => typeEvaluator.getExpectedType(n), n),
        verifyRaiseExceptionType: (n) =>
            run('verifyRaiseExceptionType', () => typeEvaluator.verifyRaiseExceptionType(n), n),
        verifyDeleteExpression: (n) => run('verifyDeleteExpression', () => typeEvaluator.verifyDeleteExpression(n), n),
        validateOverloadedFunctionArguments: typeEvaluator.validateOverloadedFunctionArguments,
        isAfterNodeReachable: (n) => run('isAfterNodeReachable', () => typeEvaluator.isAfterNodeReachable(n), n),
        isNodeReachable: (n, s) => run('isNodeReachable', () => typeEvaluator.isNodeReachable(n, s), n),
        isAsymmetricDescriptorAssignment: typeEvaluator.isAsymmetricDescriptorAssignment,
        suppressDiagnostics: (node, callback) =>
            run('suppressDiagnostics', () => typeEvaluator.suppressDiagnostics(node, callback)),
        getDeclarationsForStringNode: (n) =>
            run('getDeclarationsForStringNode', () => typeEvaluator.getDeclarationsForStringNode(n), n),
        getDeclarationsForNameNode: (n, s) =>
            run('getDeclarationsForNameNode', () => typeEvaluator.getDeclarationsForNameNode(n, s), n),
        getTypeForDeclaration: (n) => run('getTypeForDeclaration', () => typeEvaluator.getTypeForDeclaration(n), n),
        resolveAliasDeclaration: (d, l, h) =>
            run('resolveAliasDeclaration', () => typeEvaluator.resolveAliasDeclaration(d, l, h), d),
        resolveAliasDeclarationWithInfo: (d, l, h) =>
            run('resolveAliasDeclarationWithInfo', () => typeEvaluator.resolveAliasDeclarationWithInfo(d, l, h), d),
        getTypeOfIterable: (t, a, e) => run('getTypeOfIterable', () => typeEvaluator.getTypeOfIterable(t, a, e), t),
        getTypeOfIterator: (t, a, e) => run('getTypeOfIterator', () => typeEvaluator.getTypeOfIterator(t, a, e), t),
        getGetterTypeFromProperty: (p, i) =>
            run('getGetterTypeFromProperty', () => typeEvaluator.getGetterTypeFromProperty(p, i), p),
        getTypeOfArgument: typeEvaluator.getTypeOfArgument,
        markNamesAccessed: (n, a) => run('markNamesAccessed', () => typeEvaluator.markNamesAccessed(n, a), n),
        getScopeIdForNode: typeEvaluator.getScopeIdForNode,
        makeTopLevelTypeVarsConcrete: (t) =>
            run('makeTopLevelTypeVarsConcrete', () => typeEvaluator.makeTopLevelTypeVarsConcrete(t), t),
        mapSubtypesExpandTypeVars: typeEvaluator.mapSubtypesExpandTypeVars,
        lookUpSymbolRecursive: typeEvaluator.lookUpSymbolRecursive,
        getDeclaredTypeOfSymbol: typeEvaluator.getDeclaredTypeOfSymbol,
        getEffectiveTypeOfSymbol: (s) =>
            run('getEffectiveTypeOfSymbol', () => typeEvaluator.getEffectiveTypeOfSymbol(s), s),
        getEffectiveTypeOfSymbolForUsage: (s, u, d) =>
            run('getEffectiveTypeOfSymbolForUsage', () => typeEvaluator.getEffectiveTypeOfSymbolForUsage(s, u, d), s),
        getInferredTypeOfDeclaration: typeEvaluator.getInferredTypeOfDeclaration,
        getDeclaredTypeForExpression: typeEvaluator.getDeclaredTypeForExpression,
        getFunctionDeclaredReturnType: (n) =>
            run('getFunctionDeclaredReturnType', () => typeEvaluator.getFunctionDeclaredReturnType(n), n),
        getFunctionInferredReturnType: (t, a) =>
            run('getFunctionInferredReturnType', () => typeEvaluator.getFunctionInferredReturnType(t, a), t),
        getBestOverloadForArguments: (e, t, a) => typeEvaluator.getBestOverloadForArguments(e, t, a),
        getBuiltInType: (n, b) => run('getBuiltInType', () => typeEvaluator.getBuiltInType(n, b), n),
        getTypeOfMember: (m) => run('getTypeOfMember', () => typeEvaluator.getTypeOfMember(m), m.symbol),
        getTypeOfObjectMember: typeEvaluator.getTypeOfObjectMember,
        getBoundMethod: typeEvaluator.getBoundMethod,
        getTypeOfMagicMethodReturn: typeEvaluator.getTypeOfMagicMethodReturn,
        bindFunctionToClassOrObject: typeEvaluator.bindFunctionToClassOrObject,
        getCallSignatureInfo: (n, i, a) =>
            run('getCallSignatureInfo', () => typeEvaluator.getCallSignatureInfo(n, i, a), n),
        getAbstractMethods: (c) => run('getAbstractMethods', () => typeEvaluator.getAbstractMethods(c), c),
        narrowConstrainedTypeVar: typeEvaluator.narrowConstrainedTypeVar,
        assignType: (d, s, a, dc, sc, f, r) =>
            run('assignType', () => typeEvaluator.assignType(d, s, a, dc, sc, f, r), d),
        validateOverrideMethod: (b, o, d, e) =>
            run('validateOverrideMethod', () => typeEvaluator.validateOverrideMethod(b, o, d, e), o),
        assignTypeToExpression: typeEvaluator.assignTypeToExpression,
        assignClassToSelf: typeEvaluator.assignClassToSelf,
        getBuiltInObject: typeEvaluator.getBuiltInObject,
        getTypedDictClassType: typeEvaluator.getTypedDictClassType,
        getTupleClassType: typeEvaluator.getTupleClassType,
        getObjectType: typeEvaluator.getObjectType,
        getTypingType: typeEvaluator.getTypingType,
        inferReturnTypeIfNecessary: typeEvaluator.inferReturnTypeIfNecessary,
        inferTypeParameterVarianceForClass: typeEvaluator.inferTypeParameterVarianceForClass,
        verifyTypeArgumentsAssignable: typeEvaluator.verifyTypeArgumentsAssignable,
        addError: typeEvaluator.addError,
        addWarning: typeEvaluator.addWarning,
        addInformation: typeEvaluator.addInformation,
        addUnusedCode: typeEvaluator.addUnusedCode,
        addUnreachableCode: typeEvaluator.addUnreachableCode,
        addDeprecated: typeEvaluator.addDeprecated,
        addDiagnostic: typeEvaluator.addDiagnostic,
        addDiagnosticForTextRange: typeEvaluator.addDiagnosticForTextRange,
        printType: (t, e) => run('printType', () => typeEvaluator.printType(t, e), t),
        printFunctionParts: (t) => run('printFunctionParts', () => typeEvaluator.printFunctionParts(t), t),
        getTypeCacheEntryCount: typeEvaluator.getTypeCacheEntryCount,
        disposeEvaluator: typeEvaluator.disposeEvaluator,
        useSpeculativeMode: typeEvaluator.useSpeculativeMode,
        setTypeForNode: typeEvaluator.setTypeForNode,
        checkForCancellation: typeEvaluator.checkForCancellation,
    };

    return withTracker;
}
