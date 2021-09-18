/*
 * localize.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Code that localizes user-visible strings.
 */

import { fail } from '../common/debug';

import enUsStrings = require('./package.nls.en-us.json');
import deStrings = require('./package.nls.de.json');
import esStrings = require('./package.nls.es.json');
import frStrings = require('./package.nls.fr.json');
import jaStrings = require('./package.nls.ja.json');
import ruStrings = require('./package.nls.ru.json');
import zhCnStrings = require('./package.nls.zh-cn.json');
import zhTwStrings = require('./package.nls.zh-tw.json');

export class ParameterizedString<T extends {}> {
    constructor(private _formatString: string) {}

    format(params: T): string {
        let str = this._formatString;
        Object.keys(params).forEach((key) => {
            str = str.replace(`{${key}}`, (params as any)[key].toString());
        });
        return str;
    }

    getFormatString() {
        return this._formatString;
    }
}

const defaultLocale = 'en-us';
const stringMapsByLocale: Map<string, any> = new Map([
    ['de', deStrings],
    ['en-us', enUsStrings],
    ['es', esStrings],
    ['fr', frStrings],
    ['ja', jaStrings],
    ['ru', ruStrings],
    ['zh-cn', zhCnStrings],
    ['zh-tw', zhTwStrings],
]);

type StringLookupMap = { [key: string]: string | StringLookupMap };
let localizedStrings: StringLookupMap | undefined = undefined;
let defaultStrings: StringLookupMap = {};

function getRawString(key: string): string {
    if (localizedStrings === undefined) {
        localizedStrings = initialize();
    }

    const keyParts = key.split('.');

    const str = getRawStringFromMap(localizedStrings, keyParts) || getRawStringFromMap(defaultStrings, keyParts);
    if (str) {
        return str;
    }

    fail(`Missing localized string for key "${key}"`);
}

function getRawStringFromMap(map: StringLookupMap, keyParts: string[]): string | undefined {
    let curObj: any = map;

    for (const keyPart of keyParts) {
        if (!curObj[keyPart]) {
            return undefined;
        }

        curObj = curObj[keyPart];
    }

    return curObj as string;
}

function initialize(): StringLookupMap {
    defaultStrings = loadDefaultStrings();
    const currentLocale = getLocaleFromEnv();
    return loadStringsForLocale(currentLocale);
}

declare let navigator: { language: string } | undefined;

function getLocaleFromEnv() {
    try {
        if (navigator?.language) {
            return navigator.language.toLowerCase();
        }
    } catch {
        // Fall through
    }

    const env = process.env;

    // Start with the VSCode environment variables.
    const vscodeConfigString = env.VSCODE_NLS_CONFIG;
    if (vscodeConfigString) {
        try {
            return JSON.parse(vscodeConfigString).locale;
        } catch {
            // Fall through
        }
    }

    // See if there is a language env variable.
    const localeString = env.LC_ALL || env.LC_MESSAGES || env.LANG || env.LANGUAGE;
    if (localeString) {
        // This string may contain a local followed by an encoding (e.g. "en-us.UTF-8").
        const localeStringSplit = localeString.split('.');
        if (localeStringSplit.length > 0 && localeStringSplit[0]) {
            return localeStringSplit[0];
        }
    }

    // Fall back to the default locale.
    return defaultLocale;
}

function loadDefaultStrings(): StringLookupMap {
    const defaultStrings = loadStringsFromJsonFile(defaultLocale);
    if (defaultStrings) {
        return defaultStrings;
    }
    console.error('Could not load default strings');
    return {};
}

function loadStringsForLocale(locale: string): StringLookupMap {
    if (locale === defaultLocale) {
        // No need to load override if we're using the default.
        return {};
    }

    let override = loadStringsFromJsonFile(locale);
    if (override !== undefined) {
        return override;
    }

    // If we couldn't find the requested locale, try to fall back on a more
    // general version.
    const localeSplit = locale.split('-');
    if (localeSplit.length > 0 && localeSplit[0]) {
        override = loadStringsFromJsonFile(localeSplit[0]);
        if (override !== undefined) {
            return override;
        }
    }

    return {};
}

function loadStringsFromJsonFile(locale: string): StringLookupMap | undefined {
    return stringMapsByLocale.get(locale);
}

export namespace Localizer {
    export namespace Diagnostic {
        export const annotatedParamCountMismatch = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('Diagnostic.annotatedParamCountMismatch')
            );
        export const annotatedTypeArgMissing = () => getRawString('Diagnostic.annotatedTypeArgMissing');
        export const annotationFormatString = () => getRawString('Diagnostic.annotationFormatString');
        export const annotationNotSupported = () => getRawString('Diagnostic.annotationNotSupported');
        export const annotationSpansStrings = () => getRawString('Diagnostic.annotationSpansStrings');
        export const annotationStringEscape = () => getRawString('Diagnostic.annotationStringEscape');
        export const argAssignment = () =>
            new ParameterizedString<{ argType: string; paramType: string }>(getRawString('Diagnostic.argAssignment'));
        export const argAssignmentFunction = () =>
            new ParameterizedString<{ argType: string; paramType: string; functionName: string }>(
                getRawString('Diagnostic.argAssignmentFunction')
            );
        export const argAssignmentParam = () =>
            new ParameterizedString<{ argType: string; paramType: string; paramName: string }>(
                getRawString('Diagnostic.argAssignmentParam')
            );
        export const argAssignmentParamFunction = () =>
            new ParameterizedString<{ argType: string; paramType: string; paramName: string; functionName: string }>(
                getRawString('Diagnostic.argAssignmentParamFunction')
            );
        export const argMissingForParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.argMissingForParam'));
        export const argMissingForParams = () =>
            new ParameterizedString<{ names: string }>(getRawString('Diagnostic.argMissingForParams'));
        export const argMorePositionalExpectedCount = () =>
            new ParameterizedString<{ expected: number }>(getRawString('Diagnostic.argMorePositionalExpectedCount'));
        export const argMorePositionalExpectedOne = () => getRawString('Diagnostic.argMorePositionalExpectedOne');
        export const argPositional = () => getRawString('Diagnostic.argPositional');
        export const argPositionalExpectedCount = () =>
            new ParameterizedString<{ expected: number }>(getRawString('Diagnostic.argPositionalExpectedCount'));
        export const argPositionalExpectedOne = () => getRawString('Diagnostic.argPositionalExpectedOne');
        export const argTypePartiallyUnknown = () => getRawString('Diagnostic.argTypePartiallyUnknown');
        export const argTypeUnknown = () => getRawString('Diagnostic.argTypeUnknown');
        export const assertAlwaysTrue = () => getRawString('Diagnostic.assertAlwaysTrue');
        export const assignmentExprContext = () => getRawString('Diagnostic.assignmentExprContext');
        export const assignmentExprComprehension = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.assignmentExprComprehension'));
        export const assignmentInProtocol = () => getRawString('Diagnostic.assignmentInProtocol');
        export const assignmentTargetExpr = () => getRawString('Diagnostic.assignmentTargetExpr');
        export const asyncNotInAsyncFunction = () => getRawString('Diagnostic.asyncNotInAsyncFunction');
        export const awaitIllegal = () => getRawString('Diagnostic.awaitIllegal');
        export const awaitNotInAsync = () => getRawString('Diagnostic.awaitNotInAsync');
        export const backticksIllegal = () => getRawString('Diagnostic.backticksIllegal');
        export const baseClassCircular = () => getRawString('Diagnostic.baseClassCircular');
        export const baseClassInvalid = () => getRawString('Diagnostic.baseClassInvalid');
        export const baseClassFinal = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.baseClassFinal'));
        export const baseClassUnknown = () => getRawString('Diagnostic.baseClassUnknown');
        export const bindTypeMismatch = () =>
            new ParameterizedString<{ type: string; methodName: string; paramName: string }>(
                getRawString('Diagnostic.bindTypeMismatch')
            );
        export const breakOutsideLoop = () => getRawString('Diagnostic.breakOutsideLoop');
        export const callableExtraArgs = () => getRawString('Diagnostic.callableExtraArgs');
        export const callableFirstArg = () => getRawString('Diagnostic.callableFirstArg');
        export const callableSecondArg = () => getRawString('Diagnostic.callableSecondArg');
        export const casePatternIsIrrefutable = () => getRawString('Diagnostic.casePatternIsIrrefutable');
        export const classDecoratorTypeUnknown = () => getRawString('Diagnostic.classDecoratorTypeUnknown');
        export const classDefinitionCycle = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.classDefinitionCycle'));
        export const classGetItemClsParam = () => getRawString('Diagnostic.classGetItemClsParam');
        export const classMethodClsParam = () => getRawString('Diagnostic.classMethodClsParam');
        export const classNotRuntimeSubscriptable = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.classNotRuntimeSubscriptable'));
        export const classVarNotAllowed = () => getRawString('Diagnostic.classVarNotAllowed');
        export const classVarFirstArgMissing = () => getRawString('Diagnostic.classVarFirstArgMissing');
        export const classVarOverridesInstanceVar = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.classVarOverridesInstanceVar')
            );
        export const classVarTooManyArgs = () => getRawString('Diagnostic.classVarTooManyArgs');
        export const clsSelfParamTypeMismatch = () =>
            new ParameterizedString<{ name: string; classType: string }>(
                getRawString('Diagnostic.clsSelfParamTypeMismatch')
            );
        export const comparisonAlwaysFalse = () =>
            new ParameterizedString<{ leftType: string; rightType: string }>(
                getRawString('Diagnostic.comparisonAlwaysFalse')
            );
        export const comparisonAlwaysTrue = () =>
            new ParameterizedString<{ leftType: string; rightType: string }>(
                getRawString('Diagnostic.comparisonAlwaysTrue')
            );
        export const comprehensionInDict = () => getRawString('Diagnostic.comprehensionInDict');
        export const comprehensionInSet = () => getRawString('Diagnostic.comprehensionInSet');
        export const concatenateParamSpecMissing = () => getRawString('Diagnostic.concatenateParamSpecMissing');
        export const concatenateTypeArgsMissing = () => getRawString('Diagnostic.concatenateTypeArgsMissing');
        export const constantRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.constantRedefinition'));
        export const constructorNoArgs = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.constructorNoArgs'));
        export const continueInFinally = () => getRawString('Diagnostic.continueInFinally');
        export const continueOutsideLoop = () => getRawString('Diagnostic.continueOutsideLoop');
        export const dataClassBaseClassNotFrozen = () => getRawString('Diagnostic.dataClassBaseClassNotFrozen');
        export const dataClassFieldWithDefault = () => getRawString('Diagnostic.dataClassFieldWithDefault');
        export const declaredReturnTypePartiallyUnknown = () =>
            new ParameterizedString<{ returnType: string }>(
                getRawString('Diagnostic.declaredReturnTypePartiallyUnknown')
            );
        export const declaredReturnTypeUnknown = () => getRawString('Diagnostic.declaredReturnTypeUnknown');
        export const defaultValueContainsCall = () => getRawString('Diagnostic.defaultValueContainsCall');
        export const defaultValueNotAllowed = () => getRawString('Diagnostic.defaultValueNotAllowed');
        export const defaultValueNotEllipsis = () => getRawString('Diagnostic.defaultValueNotEllipsis');
        export const dictExpandIllegalInComprehension = () =>
            getRawString('Diagnostic.dictExpandIllegalInComprehension');
        export const dictInAnnotation = () => getRawString('Diagnostic.dictInAnnotation');
        export const dictKeyValuePairs = () => getRawString('Diagnostic.dictKeyValuePairs');
        export const dictUnpackIsNotMapping = () => getRawString('Diagnostic.dictUnpackIsNotMapping');
        export const delTargetExpr = () => getRawString('Diagnostic.delTargetExpr');
        export const dunderAllSymbolNotPresent = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.dunderAllSymbolNotPresent'));
        export const duplicateArgsParam = () => getRawString('Diagnostic.duplicateArgsParam');
        export const duplicateBaseClass = () => getRawString('Diagnostic.duplicateBaseClass');
        export const duplicateCatchAll = () => getRawString('Diagnostic.duplicateCatchAll');
        export const duplicateImport = () =>
            new ParameterizedString<{ importName: string }>(getRawString('Diagnostic.duplicateImport'));
        export const duplicateKwargsParam = () => getRawString('Diagnostic.duplicateKwargsParam');
        export const duplicateKeywordOnly = () => getRawString('Diagnostic.duplicateKeywordOnly');
        export const duplicateParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.duplicateParam'));
        export const duplicateCapturePatternTarget = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.duplicateCapturePatternTarget'));
        export const duplicateStarPattern = () => getRawString('Diagnostic.duplicateStarPattern');
        export const duplicateStarStarPattern = () => getRawString('Diagnostic.duplicateStarStarPattern');
        export const duplicatePositionOnly = () => getRawString('Diagnostic.duplicatePositionOnly');
        export const duplicateUnpack = () => getRawString('Diagnostic.duplicateUnpack');
        export const ellipsisContext = () => getRawString('Diagnostic.ellipsisContext');
        export const ellipsisSecondArg = () => getRawString('Diagnostic.ellipsisSecondArg');
        export const exceptionTypeIncorrect = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.exceptionTypeIncorrect'));
        export const exceptionTypeNotClass = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.exceptionTypeNotClass'));
        export const exceptionTypeNotInstantiable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.exceptionTypeNotInstantiable'));
        export const expectedAfterDecorator = () => getRawString('Diagnostic.expectedAfterDecorator');
        export const expectedArrow = () => getRawString('Diagnostic.expectedArrow');
        export const expectedAsAfterException = () => getRawString('Diagnostic.expectedAsAfterException');
        export const expectedAssignRightHandExpr = () => getRawString('Diagnostic.expectedAssignRightHandExpr');
        export const expectedBinaryRightHandExpr = () => getRawString('Diagnostic.expectedBinaryRightHandExpr');
        export const expectedBoolLiteral = () => getRawString('Diagnostic.expectedBoolLiteral');
        export const expectedCase = () => getRawString('Diagnostic.expectedCase');
        export const expectedClassName = () => getRawString('Diagnostic.expectedClassName');
        export const expectedCloseBracket = () => getRawString('Diagnostic.expectedCloseBracket');
        export const expectedCloseBrace = () => getRawString('Diagnostic.expectedCloseBrace');
        export const expectedCloseParen = () => getRawString('Diagnostic.expectedCloseParen');
        export const expectedColon = () => getRawString('Diagnostic.expectedColon');
        export const expectedComplexNumberLiteral = () => getRawString('Diagnostic.expectedComplexNumberLiteral');
        export const expectedDecoratorExpr = () => getRawString('Diagnostic.expectedDecoratorExpr');
        export const expectedDecoratorName = () => getRawString('Diagnostic.expectedDecoratorName');
        export const expectedDecoratorNewline = () => getRawString('Diagnostic.expectedDecoratorNewline');
        export const expectedDelExpr = () => getRawString('Diagnostic.expectedDelExpr');
        export const expectedElse = () => getRawString('Diagnostic.expectedElse');
        export const expectedExceptionClass = () => getRawString('Diagnostic.expectedExceptionClass');
        export const expectedExceptionObj = () => getRawString('Diagnostic.expectedExceptionObj');
        export const expectedExpr = () => getRawString('Diagnostic.expectedExpr');
        export const expectedImport = () => getRawString('Diagnostic.expectedImport');
        export const expectedImportAlias = () => getRawString('Diagnostic.expectedImportAlias');
        export const expectedImportSymbols = () => getRawString('Diagnostic.expectedImportSymbols');
        export const expectedIdentifier = () => getRawString('Diagnostic.expectedIdentifier');
        export const expectedIndentedBlock = () => getRawString('Diagnostic.expectedIndentedBlock');
        export const expectedIn = () => getRawString('Diagnostic.expectedIn');
        export const expectedInExpr = () => getRawString('Diagnostic.expectedInExpr');
        export const expectedFunctionAfterAsync = () => getRawString('Diagnostic.expectedFunctionAfterAsync');
        export const expectedFunctionName = () => getRawString('Diagnostic.expectedFunctionName');
        export const expectedMemberName = () => getRawString('Diagnostic.expectedMemberName');
        export const expectedModuleName = () => getRawString('Diagnostic.expectedModuleName');
        export const expectedNameAfterAs = () => getRawString('Diagnostic.expectedNameAfterAs');
        export const expectedNamedParameter = () => getRawString('Diagnostic.expectedNamedParameter');
        export const expectedNewline = () => getRawString('Diagnostic.expectedNewline');
        export const expectedNewlineOrSemicolon = () => getRawString('Diagnostic.expectedNewlineOrSemicolon');
        export const expectedOpenParen = () => getRawString('Diagnostic.expectedOpenParen');
        export const expectedParamName = () => getRawString('Diagnostic.expectedParamName');
        export const expectedPatternExpr = () => getRawString('Diagnostic.expectedPatternExpr');
        export const expectedPatternSubjectExpr = () => getRawString('Diagnostic.expectedPatternSubjectExpr');
        export const expectedPatternValue = () => getRawString('Diagnostic.expectedPatternValue');
        export const expectedReturnExpr = () => getRawString('Diagnostic.expectedReturnExpr');
        export const expectedSliceIndex = () => getRawString('Diagnostic.expectedSliceIndex');
        export const expectedTypeNotString = () => getRawString('Diagnostic.expectedTypeNotString');
        export const expectedYieldExpr = () => getRawString('Diagnostic.expectedYieldExpr');
        export const finalClassIsAbstract = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.finalClassIsAbstract'));
        export const finalContext = () => getRawString('Diagnostic.finalContext');
        export const finalMethodOverride = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.finalMethodOverride')
            );
        export const finalReassigned = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.finalReassigned'));
        export const finalRedeclaration = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.finalRedeclaration'));
        export const finalRedeclarationBySubclass = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.finalRedeclarationBySubclass')
            );
        export const finalTooManyArgs = () => getRawString('Diagnostic.finalTooManyArgs');
        export const finalUnassigned = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.finalUnassigned'));
        export const formatStringBrace = () => getRawString('Diagnostic.formatStringBrace');
        export const formatStringBytes = () => getRawString('Diagnostic.formatStringBytes');
        export const formatStringEscape = () => getRawString('Diagnostic.formatStringEscape');
        export const formatStringInPattern = () => getRawString('Diagnostic.formatStringInPattern');
        export const formatStringIllegal = () => getRawString('Diagnostic.formatStringIllegal');
        export const formatStringUnicode = () => getRawString('Diagnostic.formatStringUnicode');
        export const formatStringUnterminated = () => getRawString('Diagnostic.formatStringUnterminated');
        export const functionDecoratorTypeUnknown = () => getRawString('Diagnostic.functionDecoratorTypeUnknown');
        export const generatorAsyncReturnType = () => getRawString('Diagnostic.generatorAsyncReturnType');
        export const generatorSyncReturnType = () => getRawString('Diagnostic.generatorSyncReturnType');
        export const genericClassAssigned = () => getRawString('Diagnostic.genericClassAssigned');
        export const genericClassDeleted = () => getRawString('Diagnostic.genericClassDeleted');
        export const genericNotAllowed = () => getRawString('Diagnostic.genericNotAllowed');
        export const genericTypeArgMissing = () => getRawString('Diagnostic.genericTypeArgMissing');
        export const genericTypeArgTypeVar = () => getRawString('Diagnostic.genericTypeArgTypeVar');
        export const genericTypeArgUnique = () => getRawString('Diagnostic.genericTypeArgUnique');
        export const globalReassignment = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.globalReassignment'));
        export const globalRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.globalRedefinition'));
        export const implicitStringConcat = () => getRawString('Diagnostic.implicitStringConcat');
        export const importCycleDetected = () => getRawString('Diagnostic.importCycleDetected');
        export const importDepthExceeded = () =>
            new ParameterizedString<{ depth: number }>(getRawString('Diagnostic.importDepthExceeded'));
        export const importResolveFailure = () =>
            new ParameterizedString<{ importName: string }>(getRawString('Diagnostic.importResolveFailure'));
        export const importSourceResolveFailure = () =>
            new ParameterizedString<{ importName: string }>(getRawString('Diagnostic.importSourceResolveFailure'));
        export const importSymbolUnknown = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.importSymbolUnknown'));
        export const incompatibleMethodOverride = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.incompatibleMethodOverride')
            );
        export const inconsistentIndent = () => getRawString('Diagnostic.inconsistentIndent');
        export const inconsistentTabs = () => getRawString('Diagnostic.inconsistentTabs');
        export const initMustReturnNone = () => getRawString('Diagnostic.initMustReturnNone');
        export const initSubclassClsParam = () => getRawString('Diagnostic.initSubclassClsParam');
        export const instanceMethodSelfParam = () => getRawString('Diagnostic.instanceMethodSelfParam');
        export const instanceVarOverridesClassVar = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.instanceVarOverridesClassVar')
            );
        export const instantiateAbstract = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.instantiateAbstract'));
        export const instantiateProtocol = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.instantiateProtocol'));
        export const internalBindError = () =>
            new ParameterizedString<{ file: string; message: string }>(getRawString('Diagnostic.internalBindError'));
        export const internalParseError = () =>
            new ParameterizedString<{ file: string; message: string }>(getRawString('Diagnostic.internalParseError'));
        export const internalTypeCheckingError = () =>
            new ParameterizedString<{ file: string; message: string }>(
                getRawString('Diagnostic.internalTypeCheckingError')
            );
        export const invalidIdentifierChar = () => getRawString('Diagnostic.invalidIdentifierChar');
        export const invalidStubStatement = () => getRawString('Diagnostic.invalidStubStatement');
        export const invalidTokenChars = () =>
            new ParameterizedString<{ text: string }>(getRawString('Diagnostic.invalidTokenChars'));
        export const isInstanceInvalidType = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.isInstanceInvalidType'));
        export const isSubclassInvalidType = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.isSubclassInvalidType'));
        export const keyValueInSet = () => getRawString('Diagnostic.keyValueInSet');
        export const keywordArgInTypeArgument = () => getRawString('Diagnostic.keywordArgInTypeArgument');
        export const keywordOnlyAfterArgs = () => getRawString('Diagnostic.keywordOnlyAfterArgs');
        export const keywordSubscriptIllegal = () => getRawString('Diagnostic.keywordSubscriptIllegal');
        export const lambdaReturnTypeUnknown = () => getRawString('Diagnostic.lambdaReturnTypeUnknown');
        export const lambdaReturnTypePartiallyUnknown = () =>
            new ParameterizedString<{ returnType: string }>(
                getRawString('Diagnostic.lambdaReturnTypePartiallyUnknown')
            );
        export const listInAnnotation = () => getRawString('Diagnostic.listInAnnotation');
        export const literalUnsupportedType = () => getRawString('Diagnostic.literalUnsupportedType');
        export const literalEmptyArgs = () => getRawString('Diagnostic.literalEmptyArgs');
        export const literalNotCallable = () => getRawString('Diagnostic.literalNotCallable');
        export const matchIncompatible = () => getRawString('Diagnostic.matchIncompatible');
        export const memberAccess = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('Diagnostic.memberAccess'));
        export const memberDelete = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('Diagnostic.memberDelete'));
        export const memberSet = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('Diagnostic.memberSet'));
        export const metaclassConflict = () => getRawString('Diagnostic.metaclassConflict');
        export const metaclassDuplicate = () => getRawString('Diagnostic.metaclassDuplicate');
        export const methodNotDefined = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.methodNotDefined'));
        export const methodNotDefinedOnType = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('Diagnostic.methodNotDefinedOnType'));
        export const methodOrdering = () => getRawString('Diagnostic.methodOrdering');
        export const methodOverridden = () =>
            new ParameterizedString<{ name: string; className: string; type: string }>(
                getRawString('Diagnostic.methodOverridden')
            );
        export const methodReturnsNonObject = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.methodReturnsNonObject'));
        export const moduleContext = () => getRawString('Diagnostic.moduleContext');
        export const moduleUnknownMember = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.moduleUnknownMember'));
        export const namedExceptAfterCatchAll = () => getRawString('Diagnostic.namedExceptAfterCatchAll');
        export const namedParamAfterParamSpecArgs = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.namedParamAfterParamSpecArgs'));
        export const namedTupleEmptyName = () => getRawString('Diagnostic.namedTupleEmptyName');
        export const namedTupleFirstArg = () => getRawString('Diagnostic.namedTupleFirstArg');
        export const namedTupleMultipleInheritance = () => getRawString('Diagnostic.namedTupleMultipleInheritance');
        export const namedTupleNameType = () => getRawString('Diagnostic.namedTupleNameType');
        export const namedTupleNameUnique = () => getRawString('Diagnostic.namedTupleNameUnique');
        export const namedTupleNoTypes = () => getRawString('Diagnostic.namedTupleNoTypes');
        export const namedTupleSecondArg = () => getRawString('Diagnostic.namedTupleSecondArg');
        export const newClsParam = () => getRawString('Diagnostic.newClsParam');
        export const newTypeLiteral = () => getRawString('Diagnostic.newTypeLiteral');
        export const newTypeNotAClass = () => getRawString('Diagnostic.newTypeNotAClass');
        export const newTypeProtocolClass = () => getRawString('Diagnostic.newTypeProtocolClass');
        export const nonDefaultAfterDefault = () => getRawString('Diagnostic.nonDefaultAfterDefault');
        export const noneNotCallable = () => getRawString('Diagnostic.noneNotCallable');
        export const noneNotIterable = () => getRawString('Diagnostic.noneNotIterable');
        export const noneNotSubscriptable = () => getRawString('Diagnostic.noneNotSubscriptable');
        export const noneNotUsableWith = () => getRawString('Diagnostic.noneNotUsableWith');
        export const noneOperator = () =>
            new ParameterizedString<{ operator: string }>(getRawString('Diagnostic.noneOperator'));
        export const noneUnknownMember = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.noneUnknownMember'));
        export const nonLocalNoBinding = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.nonLocalNoBinding'));
        export const nonLocalReassignment = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.nonLocalReassignment'));
        export const nonLocalRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.nonLocalRedefinition'));
        export const nonLocalInModule = () => getRawString('Diagnostic.nonLocalInModule');
        export const noOverload = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.noOverload'));
        export const noReturnContainsReturn = () => getRawString('Diagnostic.noReturnContainsReturn');
        export const noReturnContainsYield = () => getRawString('Diagnostic.noReturnContainsYield');
        export const noReturnReturnsNone = () => getRawString('Diagnostic.noReturnReturnsNone');
        export const notRequiredArgCount = () => getRawString('Diagnostic.notRequiredArgCount');
        export const notRequiredNotInTypedDict = () => getRawString('Diagnostic.notRequiredNotInTypedDict');
        export const objectNotCallable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.objectNotCallable'));
        export const obscuredClassDeclaration = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.obscuredClassDeclaration'));
        export const obscuredFunctionDeclaration = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.obscuredFunctionDeclaration'));
        export const obscuredMethodDeclaration = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.obscuredMethodDeclaration'));
        export const obscuredParameterDeclaration = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.obscuredParameterDeclaration'));
        export const obscuredVariableDeclaration = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.obscuredVariableDeclaration'));
        export const operatorLessOrGreaterDeprecated = () => getRawString('Diagnostic.operatorLessOrGreaterDeprecated');
        export const optionalExtraArgs = () => getRawString('Diagnostic.optionalExtraArgs');
        export const orPatternIrrefutable = () => getRawString('Diagnostic.orPatternIrrefutable');
        export const orPatternMissingName = () => getRawString('Diagnostic.orPatternMissingName');
        export const overlappingOverload = () =>
            new ParameterizedString<{ name: string; obscured: number; obscuredBy: number }>(
                getRawString('Diagnostic.overlappingOverload')
            );
        export const overloadAbstractMismatch = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overloadAbstractMismatch'));
        export const overloadImplementationMismatch = () =>
            new ParameterizedString<{ name: string; index: number }>(
                getRawString('Diagnostic.overloadImplementationMismatch')
            );
        export const overloadReturnTypeMismatch = () =>
            new ParameterizedString<{ name: string; newIndex: number; prevIndex: number }>(
                getRawString('Diagnostic.overloadReturnTypeMismatch')
            );
        export const overloadWithImplementation = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overloadWithImplementation'));
        export const overloadWithoutImplementation = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overloadWithoutImplementation'));
        export const paramAfterKwargsParam = () => getRawString('Diagnostic.paramAfterKwargsParam');
        export const paramAlreadyAssigned = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramAlreadyAssigned'));
        export const paramNameMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramNameMissing'));
        export const paramSpecArgsKwargsUsage = () => getRawString('Diagnostic.paramSpecArgsKwargsUsage');
        export const paramSpecArgsUsage = () => getRawString('Diagnostic.paramSpecArgsUsage');
        export const paramSpecAssignedName = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramSpecAssignedName'));
        export const paramSpecContext = () => getRawString('Diagnostic.paramSpecContext');
        export const paramSpecFirstArg = () => getRawString('Diagnostic.paramSpecFirstArg');
        export const paramSpecKwargsUsage = () => getRawString('Diagnostic.paramSpecKwargsUsage');
        export const paramSpecNotBound = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.paramSpecNotBound'));
        export const paramSpecNotUsedByOuterScope = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramSpecNotUsedByOuterScope'));
        export const paramSpecUnknownArg = () => getRawString('Diagnostic.paramSpecUnknownArg');
        export const paramSpecUnknownMember = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramSpecUnknownMember'));
        export const paramSpecUnknownParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramSpecUnknownParam'));
        export const paramTypeCovariant = () => getRawString('Diagnostic.paramTypeCovariant');
        export const paramTypeUnknown = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('Diagnostic.paramTypeUnknown'));
        export const paramAssignmentMismatch = () =>
            new ParameterizedString<{ sourceType: string; paramType: string }>(
                getRawString('Diagnostic.paramAssignmentMismatch')
            );
        export const paramTypePartiallyUnknown = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('Diagnostic.paramTypePartiallyUnknown'));
        export const parenthesizedContextManagerIllegal = () =>
            getRawString('Diagnostic.parenthesizedContextManagerIllegal');
        export const positionArgAfterNamedArg = () => getRawString('Diagnostic.positionArgAfterNamedArg');
        export const privateImportFromPyTypedModule = () =>
            new ParameterizedString<{ name: string; module: string }>(
                getRawString('Diagnostic.privateImportFromPyTypedModule')
            );
        export const positionOnlyAfterArgs = () => getRawString('Diagnostic.positionOnlyAfterArgs');
        export const positionOnlyAfterKeywordOnly = () => getRawString('Diagnostic.positionOnlyAfterKeywordOnly');
        export const positionOnlyIncompatible = () => getRawString('Diagnostic.positionOnlyIncompatible');
        export const positionOnlyFirstParam = () => getRawString('Diagnostic.positionOnlyFirstParam');
        export const privateUsedOutsideOfClass = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.privateUsedOutsideOfClass'));
        export const privateUsedOutsideOfModule = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.privateUsedOutsideOfModule'));
        export const propertyOverridden = () =>
            new ParameterizedString<{ name: string; className: string }>(getRawString('Diagnostic.propertyOverridden'));
        export const propertyStaticMethod = () => getRawString('Diagnostic.propertyStaticMethod');
        export const protectedUsedOutsideOfClass = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.protectedUsedOutsideOfClass'));
        export const protocolBaseClass = () =>
            new ParameterizedString<{ classType: string; baseType: string }>(
                getRawString('Diagnostic.protocolBaseClass')
            );
        export const protocolIllegal = () => getRawString('Diagnostic.protocolIllegal');
        export const protocolNotAllowedInTypeArgument = () =>
            getRawString('Diagnostic.protocolNotAllowedInTypeArgument');
        export const protocolUsedInCall = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.protocolUsedInCall'));
        export const protocolVarianceContravariant = () =>
            new ParameterizedString<{ variable: string; class: string }>(
                getRawString('Diagnostic.protocolVarianceContravariant')
            );
        export const protocolVarianceCovariant = () =>
            new ParameterizedString<{ variable: string; class: string }>(
                getRawString('Diagnostic.protocolVarianceCovariant')
            );
        export const protocolVarianceInvariant = () =>
            new ParameterizedString<{ variable: string; class: string }>(
                getRawString('Diagnostic.protocolVarianceInvariant')
            );
        export const recursiveDefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.recursiveDefinition'));
        export const relativeImportNotAllowed = () => getRawString('Diagnostic.relativeImportNotAllowed');
        export const requiredArgCount = () => getRawString('Diagnostic.requiredArgCount');
        export const requiredNotInTypedDict = () => getRawString('Diagnostic.requiredNotInTypedDict');
        export const returnMissing = () =>
            new ParameterizedString<{ returnType: string }>(getRawString('Diagnostic.returnMissing'));
        export const returnOutsideFunction = () => getRawString('Diagnostic.returnOutsideFunction');
        export const returnTypeContravariant = () => getRawString('Diagnostic.returnTypeContravariant');
        export const returnTypeMismatch = () =>
            new ParameterizedString<{ exprType: string; returnType: string }>(
                getRawString('Diagnostic.returnTypeMismatch')
            );
        export const returnTypeUnknown = () => getRawString('Diagnostic.returnTypeUnknown');
        export const returnTypePartiallyUnknown = () =>
            new ParameterizedString<{ returnType: string }>(getRawString('Diagnostic.returnTypePartiallyUnknown'));
        export const revealLocalsArgs = () => getRawString('Diagnostic.revealLocalsArgs');
        export const revealLocalsNone = () => getRawString('Diagnostic.revealLocalsNone');
        export const revealTypeArgs = () => getRawString('Diagnostic.revealTypeArgs');
        export const setterGetterTypeMismatch = () => getRawString('Diagnostic.setterGetterTypeMismatch');
        export const starPatternInAsPattern = () => getRawString('Diagnostic.starPatternInAsPattern');
        export const starPatternInOrPattern = () => getRawString('Diagnostic.starPatternInOrPattern');
        export const singleOverload = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.singleOverload'));
        export const slotsAttributeError = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.slotsAttributeError'));
        export const slotsClassVarConflict = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.slotsClassVarConflict'));
        export const starStarWildcardNotAllowed = () => getRawString('Diagnostic.starStarWildcardNotAllowed');
        export const staticClsSelfParam = () => getRawString('Diagnostic.staticClsSelfParam');
        export const stringNonAsciiBytes = () => getRawString('Diagnostic.stringNonAsciiBytes');
        export const stringNotSubscriptable = () => getRawString('Diagnostic.stringNotSubscriptable');
        export const stringUnsupportedEscape = () => getRawString('Diagnostic.stringUnsupportedEscape');
        export const stringUnterminated = () => getRawString('Diagnostic.stringUnterminated');
        export const stubFileMissing = () =>
            new ParameterizedString<{ importName: string }>(getRawString('Diagnostic.stubFileMissing'));
        export const stubUsesGetAttr = () => getRawString('Diagnostic.stubUsesGetAttr');
        export const sublistParamsIncompatible = () => getRawString('Diagnostic.sublistParamsIncompatible');
        export const superCallArgCount = () => getRawString('Diagnostic.superCallArgCount');
        export const superCallFirstArg = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.superCallFirstArg'));
        export const superCallSecondArg = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.superCallSecondArg'));
        export const superCallZeroArgForm = () => getRawString('Diagnostic.superCallZeroArgForm');
        export const symbolIsUnbound = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.symbolIsUnbound'));
        export const symbolIsUndefined = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.symbolIsUndefined'));
        export const symbolIsPossiblyUnbound = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.symbolIsPossiblyUnbound'));
        export const symbolOverridden = () =>
            new ParameterizedString<{ name: string; className: string }>(getRawString('Diagnostic.symbolOverridden'));
        export const trailingCommaInFromImport = () => getRawString('Diagnostic.trailingCommaInFromImport');
        export const tryWithoutExcept = () => getRawString('Diagnostic.tryWithoutExcept');
        export const tupleInAnnotation = () => getRawString('Diagnostic.tupleInAnnotation');
        export const tupleIndexOutOfRange = () =>
            new ParameterizedString<{ length: number; index: number }>(getRawString('Diagnostic.tupleIndexOutOfRange'));
        export const tupleSizeMismatch = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('Diagnostic.tupleSizeMismatch')
            );
        export const typeAliasIsRecursiveDirect = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeAliasIsRecursiveDirect'));
        export const typeAliasIsRecursiveIndirect = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeAliasIsRecursiveIndirect'));
        export const typeAliasNotInModule = () => getRawString('Diagnostic.typeAliasNotInModule');
        export const typeAliasRedeclared = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeAliasRedeclared'));
        export const typeAnnotationCall = () => getRawString('Diagnostic.typeAnnotationCall');
        export const typeAnnotationVariable = () => getRawString('Diagnostic.typeAnnotationVariable');
        export const typeArgListNotAllowed = () => getRawString('Diagnostic.typeArgListNotAllowed');
        export const typeArgsExpectingNone = () => getRawString('Diagnostic.typeArgsExpectingNone');
        export const typeArgsMismatchOne = () =>
            new ParameterizedString<{ received: number }>(getRawString('Diagnostic.typeArgsMismatchOne'));
        export const typeArgsMissingForAlias = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeArgsMissingForAlias'));
        export const typeArgsMissingForClass = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeArgsMissingForClass'));
        export const typeArgsTooFew = () =>
            new ParameterizedString<{ name: string; expected: number; received: number }>(
                getRawString('Diagnostic.typeArgsTooFew')
            );
        export const typeArgsTooMany = () =>
            new ParameterizedString<{ name: string; expected: number; received: number }>(
                getRawString('Diagnostic.typeArgsTooMany')
            );
        export const typeAssignmentMismatch = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('Diagnostic.typeAssignmentMismatch')
            );
        export const typeCallNotAllowed = () => getRawString('Diagnostic.typeCallNotAllowed');
        export const typedDictAccess = () => getRawString('Diagnostic.typedDictAccess');
        export const typedDictBadVar = () => getRawString('Diagnostic.typedDictBadVar');
        export const typedDictBaseClass = () => getRawString('Diagnostic.typedDictBaseClass');
        export const typedDictDelete = () => getRawString('Diagnostic.typedDictDelete');
        export const typedDictEmptyName = () => getRawString('Diagnostic.typedDictEmptyName');
        export const typedDictEntryName = () => getRawString('Diagnostic.typedDictEntryName');
        export const typedDictEntryUnique = () => getRawString('Diagnostic.typedDictEntryUnique');
        export const typedDictExtraArgs = () => getRawString('Diagnostic.typedDictExtraArgs');
        export const typedDictFieldRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typedDictFieldRedefinition'));
        export const typedDictFirstArg = () => getRawString('Diagnostic.typedDictFirstArg');
        export const typedDictSecondArgDict = () => getRawString('Diagnostic.typedDictSecondArgDict');
        export const typedDictSecondArgDictEntry = () => getRawString('Diagnostic.typedDictSecondArgDictEntry');
        export const typedDictSet = () => getRawString('Diagnostic.typedDictSet');
        export const typedDictTotalParam = () => getRawString('Diagnostic.typedDictTotalParam');
        export const typeExpectedClass = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeExpectedClass'));
        export const typeGuardArgCount = () => getRawString('Diagnostic.typeGuardArgCount');
        export const typeNotAwaitable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeNotAwaitable'));
        export const typeNotCallable = () =>
            new ParameterizedString<{ expression: string; type: string }>(getRawString('Diagnostic.typeNotCallable'));
        export const typeNotIntantiable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeNotIntantiable'));
        export const typeNotIterable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeNotIterable'));
        export const typeNotSpecializable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeNotSpecializable'));
        export const typeNotSubscriptable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeNotSubscriptable'));
        export const typeNotUsableWith = () =>
            new ParameterizedString<{ type: string; method: string }>(getRawString('Diagnostic.typeNotUsableWith'));
        export const typeNotSupportBinaryOperator = () =>
            new ParameterizedString<{ leftType: string; rightType: string; operator: string }>(
                getRawString('Diagnostic.typeNotSupportBinaryOperator')
            );
        export const typeNotSupportUnaryOperator = () =>
            new ParameterizedString<{ type: string; operator: string }>(
                getRawString('Diagnostic.typeNotSupportUnaryOperator')
            );
        export const typePartiallyUnknown = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typePartiallyUnknown'));
        export const typeUnknown = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeUnknown'));
        export const typeVarAssignedName = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarAssignedName'));
        export const typeVarAssignmentMismatch = () =>
            new ParameterizedString<{ type: string; name: string }>(
                getRawString('Diagnostic.typeVarAssignmentMismatch')
            );
        export const typeVarBoundAndConstrained = () => getRawString('Diagnostic.typeVarBoundAndConstrained');
        export const typeVarFirstArg = () => getRawString('Diagnostic.typeVarFirstArg');
        export const typeVarGeneric = () => getRawString('Diagnostic.typeVarGeneric');
        export const typeVarNoMember = () =>
            new ParameterizedString<{ type: string; name: string }>(getRawString('Diagnostic.typeVarNoMember'));
        export const typeVarNotSubscriptable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeVarNotSubscriptable'));
        export const typeVarNotUsedByOuterScope = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarNotUsedByOuterScope'));
        export const typeVarSingleConstraint = () => getRawString('Diagnostic.typeVarSingleConstraint');
        export const typeVarsNotInGeneric = () => getRawString('Diagnostic.typeVarsNotInGeneric');
        export const typeVarTupleContext = () => getRawString('Diagnostic.typeVarTupleContext');
        export const typeVarUnknownParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarUnknownParam'));
        export const typeVarUsedByOuterScope = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarUsedByOuterScope'));
        export const typeVarUsedOnlyOnce = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarUsedOnlyOnce'));
        export const typeVarVariance = () => getRawString('Diagnostic.typeVarVariance');
        export const unaccessedClass = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.unaccessedClass'));
        export const unaccessedFunction = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.unaccessedFunction'));
        export const unaccessedImport = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.unaccessedImport'));
        export const unaccessedSymbol = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.unaccessedSymbol'));
        export const unaccessedVariable = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.unaccessedVariable'));
        export const unexpectedAsyncToken = () => getRawString('Diagnostic.unexpectedAsyncToken');
        export const unexpectedExprToken = () => getRawString('Diagnostic.unexpectedExprToken');
        export const unexpectedIndent = () => getRawString('Diagnostic.unexpectedIndent');
        export const unexpectedUnindent = () => getRawString('Diagnostic.unexpectedUnindent');
        export const unionSyntaxIllegal = () => getRawString('Diagnostic.unionSyntaxIllegal');
        export const uninitializedInstanceVariable = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.uninitializedInstanceVariable'));
        export const unnecessaryCast = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.unnecessaryCast'));
        export const unnecessaryIsInstanceAlways = () =>
            new ParameterizedString<{ testType: string; classType: string }>(
                getRawString('Diagnostic.unnecessaryIsInstanceAlways')
            );
        export const unnecessaryIsSubclassAlways = () =>
            new ParameterizedString<{ testType: string; classType: string }>(
                getRawString('Diagnostic.unnecessaryIsSubclassAlways')
            );
        export const unpackArgCount = () => getRawString('Diagnostic.unpackArgCount');
        export const unpackedArgInTypeArgument = () => getRawString('Diagnostic.unpackedArgInTypeArgument');
        export const unpackedArgWithVariadicParam = () => getRawString('Diagnostic.unpackedArgWithVariadicParam');
        export const unpackedDictArgumentNotMapping = () => getRawString('Diagnostic.unpackedDictArgumentNotMapping');
        export const unpackedSubscriptIllegal = () => getRawString('Diagnostic.unpackedSubscriptIllegal');
        export const unpackedTypedDictArgument = () => getRawString('Diagnostic.unpackedTypedDictArgument');
        export const unpackedTypeVarTupleExpected = () =>
            new ParameterizedString<{ name1: string; name2: string }>(
                getRawString('Diagnostic.unpackedTypeVarTupleExpected')
            );
        export const unpackExpectedTypeVarTuple = () => getRawString('Diagnostic.unpackExpectedTypeVarTuple');
        export const unpackIllegalInComprehension = () => getRawString('Diagnostic.unpackIllegalInComprehension');
        export const unpackInDict = () => getRawString('Diagnostic.unpackInDict');
        export const unpackInSet = () => getRawString('Diagnostic.unpackInSet');
        export const unpackNotAllowed = () => getRawString('Diagnostic.unpackNotAllowed');
        export const unpackTuplesIllegal = () => getRawString('Diagnostic.unpackTuplesIllegal');
        export const unreachableCode = () => getRawString('Diagnostic.unreachableCode');
        export const unsupportedDunderAllOperation = () => getRawString('Diagnostic.unsupportedDunderAllOperation');
        export const unusedCallResult = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.unusedCallResult'));
        export const unusedCoroutine = () => getRawString('Diagnostic.unusedCoroutine');
        export const varAnnotationIllegal = () => getRawString('Diagnostic.varAnnotationIllegal');
        export const variadicTypeArgsTooMany = () => getRawString('Diagnostic.variadicTypeArgsTooMany');
        export const variadicTypeParamTooManyAlias = () =>
            new ParameterizedString<{ names: string }>(getRawString('Diagnostic.variadicTypeParamTooManyAlias'));
        export const variadicTypeParamTooManyClass = () =>
            new ParameterizedString<{ names: string }>(getRawString('Diagnostic.variadicTypeParamTooManyClass'));
        export const walrusIllegal = () => getRawString('Diagnostic.walrusIllegal');
        export const walrusNotAllowed = () => getRawString('Diagnostic.walrusNotAllowed');
        export const wildcardInFunction = () => getRawString('Diagnostic.wildcardInFunction');
        export const wildcardLibraryImport = () => getRawString('Diagnostic.wildcardLibraryImport');
        export const yieldFromIllegal = () => getRawString('Diagnostic.yieldFromIllegal');
        export const yieldFromOutsideAsync = () => getRawString('Diagnostic.yieldFromOutsideAsync');
        export const yieldOutsideFunction = () => getRawString('Diagnostic.yieldOutsideFunction');
        export const yieldTypeMismatch = () =>
            new ParameterizedString<{ exprType: string; yieldType: string }>(
                getRawString('Diagnostic.yieldTypeMismatch')
            );
        export const yieldWithinListCompr = () => getRawString('Diagnostic.yieldWithinListCompr');
        export const zeroCaseStatementsFound = () => getRawString('Diagnostic.zeroCaseStatementsFound');
        export const zeroLengthTupleNotAllowed = () => getRawString('Diagnostic.zeroLengthTupleNotAllowed');
    }

    export namespace DiagnosticAddendum {
        export const argParam = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('DiagnosticAddendum.argParam'));
        export const argParamFunction = () =>
            new ParameterizedString<{ paramName: string; functionName: string }>(
                getRawString('DiagnosticAddendum.argParamFunction')
            );
        export const argsParamMissing = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('DiagnosticAddendum.argsParamMissing'));
        export const argsParamWithVariadic = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('DiagnosticAddendum.argsParamWithVariadic'));
        export const argumentType = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.argumentType'));
        export const argumentTypes = () =>
            new ParameterizedString<{ types: string }>(getRawString('DiagnosticAddendum.argumentTypes'));
        export const assignToNone = () => getRawString('DiagnosticAddendum.assignToNone');
        export const asyncHelp = () => getRawString('DiagnosticAddendum.asyncHelp');
        export const dataclassFrozen = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.dataclassFrozen'));
        export const finalMethod = () => getRawString('DiagnosticAddendum.finalMethod');
        export const functionParamName = () =>
            new ParameterizedString<{ destName: string; srcName: string }>(
                getRawString('DiagnosticAddendum.functionParamName')
            );
        export const functionReturnTypeMismatch = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.functionReturnTypeMismatch')
            );
        export const functionTooFewParams = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('DiagnosticAddendum.functionTooFewParams')
            );
        export const incompatibleGetter = () => getRawString('DiagnosticAddendum.incompatibleGetter');
        export const incompatibleSetter = () => getRawString('DiagnosticAddendum.incompatibleSetter');
        export const incompatibleDeleter = () => getRawString('DiagnosticAddendum.incompatibleDeleter');
        export const functionTooManyParams = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('DiagnosticAddendum.functionTooManyParams')
            );
        export const keyNotRequired = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('DiagnosticAddendum.keyNotRequired'));
        export const keyRequiredDeleted = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.keyRequiredDeleted'));
        export const keyUndefined = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('DiagnosticAddendum.keyUndefined'));
        export const kwargsParamMissing = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('DiagnosticAddendum.kwargsParamMissing'));
        export const literalAssignmentMismatch = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.literalAssignmentMismatch')
            );
        export const memberAssignment = () =>
            new ParameterizedString<{ type: string; name: string; classType: string }>(
                getRawString('DiagnosticAddendum.memberAssignment')
            );
        export const memberIsAbstract = () =>
            new ParameterizedString<{ type: string; name: string }>(
                getRawString('DiagnosticAddendum.memberIsAbstract')
            );
        export const memberIsAbstractMore = () =>
            new ParameterizedString<{ count: number }>(getRawString('DiagnosticAddendum.memberIsAbstractMore'));
        export const memberIsFinalInProtocol = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsFinalInProtocol'));
        export const memberIsNotFinalInProtocol = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsNotFinalInProtocol'));
        export const memberSetClassVar = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberSetClassVar'));
        export const memberTypeMismatch = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberTypeMismatch'));
        export const memberUnknown = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberUnknown'));
        export const missingGetter = () => getRawString('DiagnosticAddendum.missingGetter');
        export const missingSetter = () => getRawString('DiagnosticAddendum.missingSetter');
        export const missingDeleter = () => getRawString('DiagnosticAddendum.missingDeleter');
        export const namedParamMissingInDest = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.namedParamMissingInDest'));
        export const namedParamMissingInSource = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.namedParamMissingInSource'));
        export const namedParamTypeMismatch = () =>
            new ParameterizedString<{ name: string; sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.namedParamTypeMismatch')
            );
        export const noOverloadAssignable = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.noOverloadAssignable'));
        export const orPatternMissingName = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.orPatternMissingName'));
        export const overloadMethod = () => getRawString('DiagnosticAddendum.overloadMethod');
        export const overloadNotAssignable = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.overloadNotAssignable'));
        export const overloadTooManyUnions = () => getRawString('DiagnosticAddendum.overloadTooManyUnions');
        export const overloadWithImplementation = () => getRawString('DiagnosticAddendum.overloadWithImplementation');
        export const overriddenMethod = () => getRawString('DiagnosticAddendum.overriddenMethod');
        export const overriddenSymbol = () => getRawString('DiagnosticAddendum.overriddenSymbol');
        export const overrideParamCount = () =>
            new ParameterizedString<{ baseCount: number; overrideCount: number }>(
                getRawString('DiagnosticAddendum.overrideParamCount')
            );
        export const overrideParamName = () =>
            new ParameterizedString<{ index: number; baseName: string; overrideName: string }>(
                getRawString('DiagnosticAddendum.overrideParamName')
            );
        export const overrideParamType = () =>
            new ParameterizedString<{ index: number; baseType: string; overrideType: string }>(
                getRawString('DiagnosticAddendum.overrideParamType')
            );
        export const overrideReturnType = () =>
            new ParameterizedString<{ baseType: string; overrideType: string }>(
                getRawString('DiagnosticAddendum.overrideReturnType')
            );
        export const overrideType = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.overrideType'));
        export const paramAssignment = () =>
            new ParameterizedString<{ index: number; sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.paramAssignment')
            );
        export const paramSpecOverload = () => getRawString('DiagnosticAddendum.paramSpecOverload');
        export const paramType = () =>
            new ParameterizedString<{ paramType: string }>(getRawString('DiagnosticAddendum.paramType'));
        export const privateImportFromPyTypedSource = () =>
            new ParameterizedString<{ module: string }>(
                getRawString('DiagnosticAddendum.privateImportFromPyTypedSource')
            );
        export const propertyMethodIncompatible = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.propertyMethodIncompatible'));
        export const propertyMethodMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.propertyMethodMissing'));
        export const propertyMissingDeleter = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.propertyMissingDeleter'));
        export const propertyMissingSetter = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.propertyMissingSetter'));
        export const protocolMemberClassVar = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.protocolMemberClassVar'));
        export const protocolIncompatible = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.protocolIncompatible')
            );
        export const protocolMemberMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.protocolMemberMissing'));
        export const seeDeclaration = () => getRawString('DiagnosticAddendum.seeDeclaration');
        export const seeClassDeclaration = () => getRawString('DiagnosticAddendum.seeClassDeclaration');
        export const seeFunctionDeclaration = () => getRawString('DiagnosticAddendum.seeFunctionDeclaration');
        export const seeMethodDeclaration = () => getRawString('DiagnosticAddendum.seeMethodDeclaration');
        export const seeParameterDeclaration = () => getRawString('DiagnosticAddendum.seeParameterDeclaration');
        export const seeVariableDeclaration = () => getRawString('DiagnosticAddendum.seeVariableDeclaration');
        export const tupleEntryTypeMismatch = () =>
            new ParameterizedString<{ entry: number }>(getRawString('DiagnosticAddendum.tupleEntryTypeMismatch'));
        export const tupleSizeMismatch = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('DiagnosticAddendum.tupleSizeMismatch')
            );
        export const tupleSizeMismatchIndeterminate = () =>
            new ParameterizedString<{ expected: number }>(
                getRawString('DiagnosticAddendum.tupleSizeMismatchIndeterminate')
            );
        export const typeAssignmentMismatch = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.typeAssignmentMismatch')
            );
        export const typeBound = () =>
            new ParameterizedString<{ sourceType: string; destType: string; name: string }>(
                getRawString('DiagnosticAddendum.typeBound')
            );
        export const typeConstrainedTypeVar = () =>
            new ParameterizedString<{ type: string; name: string }>(
                getRawString('DiagnosticAddendum.typeConstrainedTypeVar')
            );
        export const typedDictFieldMissing = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldMissing')
            );
        export const typedDictFieldNotRequired = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldNotRequired')
            );
        export const typedDictFieldRedefinition = () =>
            new ParameterizedString<{ parentType: string; childType: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldRedefinition')
            );
        export const typedDictFieldRequired = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldRequired')
            );
        export const typedDictFieldTypeMismatch = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldTypeMismatch')
            );
        export const typedDictFieldUndefined = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldUndefined')
            );
        export const typeIncompatible = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.typeIncompatible')
            );
        export const typeNotCallable = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.typeNotCallable'));
        export const typeNotClass = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.typeNotClass'));
        export const typeParamSpec = () =>
            new ParameterizedString<{ type: string; name: string }>(getRawString('DiagnosticAddendum.typeParamSpec'));
        export const typeNotStringLiteral = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.typeNotStringLiteral'));
        export const typeOfSymbol = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('DiagnosticAddendum.typeOfSymbol'));
        export const typeUnsupported = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.typeUnsupported'));
        export const typeVarIsContravariant = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.typeVarIsContravariant'));
        export const typeVarIsCovariant = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.typeVarIsCovariant'));
        export const typeVarIsInvariant = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.typeVarIsInvariant'));
        export const typeVarTupleRequiresKnownLength = () =>
            getRawString('DiagnosticAddendum.typeVarTupleRequiresKnownLength');
        export const typeVarNotAllowed = () => getRawString('DiagnosticAddendum.typeVarNotAllowed');
        export const typeVarsMissing = () =>
            new ParameterizedString<{ names: string }>(getRawString('DiagnosticAddendum.typeVarsMissing'));
        export const useDictInstead = () => getRawString('DiagnosticAddendum.useDictInstead');
        export const useListInstead = () => getRawString('DiagnosticAddendum.useListInstead');
        export const useTupleInstead = () => getRawString('DiagnosticAddendum.useTupleInstead');
        export const useTypeInstead = () => getRawString('DiagnosticAddendum.useTypeInstead');
    }

    export namespace CodeAction {
        export const addOptionalToAnnotation = () => getRawString('CodeAction.addOptionalToAnnotation');
        export const createTypeStub = () => getRawString('CodeAction.createTypeStub');
        export const createTypeStubFor = () =>
            new ParameterizedString<{ moduleName: string }>(getRawString('CodeAction.createTypeStubFor'));
        export const executingCommand = () => getRawString('CodeAction.executingCommand');
        export const filesToAnalyzeOne = () => getRawString('CodeAction.filesToAnalyzeOne');
        export const filesToAnalyzeCount = () =>
            new ParameterizedString<{ count: number }>(getRawString('CodeAction.filesToAnalyzeCount'));
        export const findingReferences = () => getRawString('CodeAction.findingReferences');
        export const organizeImports = () => getRawString('CodeAction.organizeImports');
    }
}
