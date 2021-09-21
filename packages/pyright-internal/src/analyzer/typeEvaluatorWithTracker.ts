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
        getTypeOfExpression: (n, e, f) =>
            run('getTypeOfExpression', () => typeEvaluator.getTypeOfExpression(n, e, f), n),
        getTypeOfAnnotation: typeEvaluator.getTypeOfAnnotation,
        getTypeOfClass: (n) => run('getTypeOfClass', () => typeEvaluator.getTypeOfClass(n), n),
        getTypeOfFunction: (n) => run('getTypeOfFunction', () => typeEvaluator.getTypeOfFunction(n), n),
        getTypeForExpressionExpectingType: typeEvaluator.getTypeForExpressionExpectingType,
        evaluateTypesForStatement: (n) =>
            run('evaluateTypesForStatement', () => typeEvaluator.evaluateTypesForStatement(n), n),
        getDeclaredTypeForExpression: (n) =>
            run('getDeclaredTypeForExpression', () => typeEvaluator.getDeclaredTypeForExpression(n), n),
        verifyRaiseExceptionType: (n) =>
            run('verifyRaiseExceptionType', () => typeEvaluator.verifyRaiseExceptionType(n), n),
        verifyDeleteExpression: (n) => run('verifyDeleteExpression', () => typeEvaluator.verifyDeleteExpression(n), n),
        isAfterNodeReachable: (n) => run('isAfterNodeReachable', () => typeEvaluator.isAfterNodeReachable(n), n),
        isNodeReachable: (n) => run('isNodeReachable', () => typeEvaluator.isNodeReachable(n), n),
        suppressDiagnostics: (node, callback) =>
            run('suppressDiagnostics', () => typeEvaluator.suppressDiagnostics(node, callback)),
        getDeclarationsForNameNode: (n) =>
            run('getDeclarationsForNameNode', () => typeEvaluator.getDeclarationsForNameNode(n), n),
        getTypeForDeclaration: (n) => run('getTypeForDeclaration', () => typeEvaluator.getTypeForDeclaration(n), n),
        resolveAliasDeclaration: (d, l, h) =>
            run('resolveAliasDeclaration', () => typeEvaluator.resolveAliasDeclaration(d, l, h), d),
        resolveAliasDeclarationWithInfo: (d, l, h) =>
            run('resolveAliasDeclarationWithInfo', () => typeEvaluator.resolveAliasDeclarationWithInfo(d, l, h), d),
        getTypeFromIterable: (t, a, e) =>
            run('getTypeFromIterable', () => typeEvaluator.getTypeFromIterable(t, a, e), t),
        getTypeFromIterator: (t, a, e) =>
            run('getTypeFromIterator', () => typeEvaluator.getTypeFromIterator(t, a, e), t),
        getGetterTypeFromProperty: (p, i) =>
            run('getGetterTypeFromProperty', () => typeEvaluator.getGetterTypeFromProperty(p, i), p),
        markNamesAccessed: (n, a) => run('markNamesAccessed', () => typeEvaluator.markNamesAccessed(n, a), n),
        getScopeIdForNode: typeEvaluator.getScopeIdForNode,
        makeTopLevelTypeVarsConcrete: (t) =>
            run('makeTopLevelTypeVarsConcrete', () => typeEvaluator.makeTopLevelTypeVarsConcrete(t), t),
        mapSubtypesExpandTypeVars: typeEvaluator.mapSubtypesExpandTypeVars,
        getEffectiveTypeOfSymbol: (s) =>
            run('getEffectiveTypeOfSymbol', () => typeEvaluator.getEffectiveTypeOfSymbol(s), s),
        getEffectiveTypeOfSymbolForUsage: (s, u, d) =>
            run('getEffectiveTypeOfSymbolForUsage', () => typeEvaluator.getEffectiveTypeOfSymbolForUsage(s, u, d), s),
        getFunctionDeclaredReturnType: (n) =>
            run('getFunctionDeclaredReturnType', () => typeEvaluator.getFunctionDeclaredReturnType(n), n),
        getFunctionInferredReturnType: (t, a) =>
            run('getFunctionInferredReturnType', () => typeEvaluator.getFunctionInferredReturnType(t, a), t),
        getBestOverloadForArguments: (e, t, a) => typeEvaluator.getBestOverloadForArguments(e, t, a),
        getBuiltInType: (n, b) => run('getBuiltInType', () => typeEvaluator.getBuiltInType(n, b), n),
        getTypeOfMember: (m) => run('getTypeOfMember', () => typeEvaluator.getTypeOfMember(m), m.symbol),
        getTypeFromObjectMember: typeEvaluator.getTypeFromObjectMember,
        getBoundMethod: typeEvaluator.getBoundMethod,
        getTypeFromMagicMethodReturn: typeEvaluator.getTypeFromMagicMethodReturn,
        bindFunctionToClassOrObject: (b, m) =>
            run('bindFunctionToClassOrObject', () => typeEvaluator.bindFunctionToClassOrObject(b, m), m),
        getCallSignatureInfo: (n, i, a) =>
            run('getCallSignatureInfo', () => typeEvaluator.getCallSignatureInfo(n, i, a), n),
        getTypeAnnotationForParameter: (n, p) =>
            run('getTypeAnnotationForParameter', () => typeEvaluator.getTypeAnnotationForParameter(n, p), n),
        getAbstractMethods: (c) => run('getAbstractMethods', () => typeEvaluator.getAbstractMethods(c), c),
        canAssignType: (d, s, a, m, f) => run('canAssignType', () => typeEvaluator.canAssignType(d, s, a, m, f), d),
        canOverrideMethod: (b, o, d, e) =>
            run('canOverrideMethod', () => typeEvaluator.canOverrideMethod(b, o, d, e), o),
        canAssignProtocolClassToSelf: (d, s) =>
            run('canAssignProtocolClassToSelf', () => typeEvaluator.canAssignProtocolClassToSelf(d, s)),
        assignTypeToExpression: typeEvaluator.assignTypeToExpression,
        getBuiltInObject: typeEvaluator.getBuiltInObject,
        getTypingType: typeEvaluator.getTypingType,
        addError: (m, n) => run('addError', () => typeEvaluator.addError(m, n), n),
        addWarning: (m, n) => run('addWarning', () => typeEvaluator.addWarning(m, n), n),
        addInformation: (m, n) => run('addInformation', () => typeEvaluator.addInformation(m, n), n),
        addUnusedCode: (n, t) => run('addUnusedCode', () => typeEvaluator.addUnusedCode(n, t), n),
        addDiagnostic: (d, r, m, n) => run('addDiagnostic', () => typeEvaluator.addDiagnostic(d, r, m, n), n),
        addDiagnosticForTextRange: (f, d, r, m, g) =>
            run('addDiagnosticForTextRange', () => typeEvaluator.addDiagnosticForTextRange(f, d, r, m, g)),
        printType: (t, e) => run('printType', () => typeEvaluator.printType(t, e), t),
        printFunctionParts: (t) => run('printFunctionParts', () => typeEvaluator.printFunctionParts(t), t),
        getTypeCacheSize: typeEvaluator.getTypeCacheSize,
        useSpeculativeMode: typeEvaluator.useSpeculativeMode,
    };

    return withTracker;
}
