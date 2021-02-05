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

import { LogTracker } from '../common/logTracker';
import { timingStats } from '../common/timing';
import { ImportLookup } from './analyzerFileInfo';
import { createTypeEvaluator, EvaluatorOptions, TypeEvaluator } from './typeEvaluator';

// We don't want to track calls from the type evaluator itself, but only entry points.
export function createTypeEvaluatorWithTracker(
    importLookup: ImportLookup,
    evaluatorOptions: EvaluatorOptions,
    logger?: LogTracker
) {
    function run<T>(title: string, callback: () => T): T {
        return logger
            ? logger.log(title, () => timingStats.typeEvaluationTime.timeOperation(callback), 50)
            : timingStats.typeEvaluationTime.timeOperation(callback);
    }

    const typeEvaluator = createTypeEvaluator(importLookup, evaluatorOptions);

    const withTracker: TypeEvaluator = {
        runWithCancellationToken: typeEvaluator.runWithCancellationToken,
        getType: (n) => run('getType', () => typeEvaluator.getType(n)),
        getTypeOfClass: (n) => run('getTypeOfClass', () => typeEvaluator.getTypeOfClass(n)),
        getTypeOfFunction: (n) => run('getTypeOfFunction', () => typeEvaluator.getTypeOfFunction(n)),
        evaluateTypesForStatement: (n) =>
            run('evaluateTypesForStatement', () => typeEvaluator.evaluateTypesForStatement(n)),
        getDeclaredTypeForExpression: (n) =>
            run('getDeclaredTypeForExpression', () => typeEvaluator.getDeclaredTypeForExpression(n)),
        verifyRaiseExceptionType: (n) =>
            run('verifyRaiseExceptionType', () => typeEvaluator.verifyRaiseExceptionType(n)),
        verifyDeleteExpression: (n) => run('verifyDeleteExpression', () => typeEvaluator.verifyDeleteExpression(n)),
        isAfterNodeReachable: (n) => run('isAfterNodeReachable', () => typeEvaluator.isAfterNodeReachable(n)),
        isNodeReachable: (n) => run('isNodeReachable', () => typeEvaluator.isNodeReachable(n)),
        suppressDiagnostics: (callback) =>
            run('suppressDiagnostics', () => typeEvaluator.suppressDiagnostics(callback)),
        getDeclarationsForNameNode: (n) =>
            run('getDeclarationsForNameNode', () => typeEvaluator.getDeclarationsForNameNode(n)),
        getTypeForDeclaration: (n) => run('getTypeForDeclaration', () => typeEvaluator.getTypeForDeclaration(n)),
        resolveAliasDeclaration: (d, l) =>
            run('resolveAliasDeclaration', () => typeEvaluator.resolveAliasDeclaration(d, l)),
        getTypeFromIterable: (t, a, e) => run('getTypeFromIterable', () => typeEvaluator.getTypeFromIterable(t, a, e)),
        getTypedDictMembersForClass: (c) =>
            run('getTypedDictMembersForClass', () => typeEvaluator.getTypedDictMembersForClass(c)),
        getGetterTypeFromProperty: (p, i) =>
            run('getGetterTypeFromProperty', () => typeEvaluator.getGetterTypeFromProperty(p, i)),
        markNamesAccessed: (n, a) => run('markNamesAccessed', () => typeEvaluator.markNamesAccessed(n, a)),
        getScopeIdForNode: (n) => run('getScopeIdForNode', () => typeEvaluator.getScopeIdForNode(n)),
        makeTopLevelTypeVarsConcrete: (t) =>
            run('makeTopLevelTypeVarsConcrete', () => typeEvaluator.makeTopLevelTypeVarsConcrete(t)),
        getEffectiveTypeOfSymbol: (s) =>
            run('getEffectiveTypeOfSymbol', () => typeEvaluator.getEffectiveTypeOfSymbol(s)),
        getFunctionDeclaredReturnType: (n) =>
            run('getFunctionDeclaredReturnType', () => typeEvaluator.getFunctionDeclaredReturnType(n)),
        getFunctionInferredReturnType: (t) =>
            run('getFunctionInferredReturnType', () => typeEvaluator.getFunctionInferredReturnType(t)),
        getBuiltInType: (n, b) => run('getBuiltInType', () => typeEvaluator.getBuiltInType(n, b)),
        getTypeOfMember: (m) => run('getTypeOfMember', () => typeEvaluator.getTypeOfMember(m)),
        bindFunctionToClassOrObject: (b, m) =>
            run('bindFunctionToClassOrObject', () => typeEvaluator.bindFunctionToClassOrObject(b, m)),
        getCallSignatureInfo: (n, i, a) =>
            run('getCallSignatureInfo', () => typeEvaluator.getCallSignatureInfo(n, i, a)),
        getTypeAnnotationForParameter: (n, p) =>
            run('getTypeAnnotationForParameter', () => typeEvaluator.getTypeAnnotationForParameter(n, p)),
        canAssignType: (d, s, a, m, f) => run('canAssignType', () => typeEvaluator.canAssignType(d, s, a, m, f)),
        canOverrideMethod: (b, o, d) => run('canOverrideMethod', () => typeEvaluator.canOverrideMethod(b, o, d)),
        addError: (m, n) => run('addError', () => typeEvaluator.addError(m, n)),
        addWarning: (m, n) => run('addWarning', () => typeEvaluator.addWarning(m, n)),
        addInformation: (m, n) => run('addInformation', () => typeEvaluator.addInformation(m, n)),
        addUnusedCode: (n, t) => run('addUnusedCode', () => typeEvaluator.addUnusedCode(n, t)),
        addDiagnostic: (d, r, m, n) => run('addDiagnostic', () => typeEvaluator.addDiagnostic(d, r, m, n)),
        addDiagnosticForTextRange: (f, d, r, m, g) =>
            run('addDiagnosticForTextRange', () => typeEvaluator.addDiagnosticForTextRange(f, d, r, m, g)),
        printType: (t, e) => run('printType', () => typeEvaluator.printType(t, e)),
        printFunctionParts: (t) => run('printFunctionParts', () => typeEvaluator.printFunctionParts(t)),
        getTypeCacheSize: typeEvaluator.getTypeCacheSize,
    };

    return withTracker;
}
