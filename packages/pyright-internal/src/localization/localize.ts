/*
 * localize.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Code that localizes user-visible strings.
 */

import { fail } from '../common/debug';

import csStrings = require('./package.nls.cs.json');
import deStrings = require('./package.nls.de.json');
import enUsStrings = require('./package.nls.en-us.json');
import esStrings = require('./package.nls.es.json');
import frStrings = require('./package.nls.fr.json');
import itStrings = require('./package.nls.it.json');
import jaStrings = require('./package.nls.ja.json');
import koStrings = require('./package.nls.ko.json');
import plStrings = require('./package.nls.pl.json');
import ptBrStrings = require('./package.nls.pt-br.json');
import qpsPlocStrings = require('./package.nls.qps-ploc.json');
import ruStrings = require('./package.nls.ru.json');
import trStrings = require('./package.nls.tr.json');
import zhCnStrings = require('./package.nls.zh-cn.json');
import zhTwStrings = require('./package.nls.zh-tw.json');

export class ParameterizedString<T extends {}> {
    constructor(private _formatString: string) {}

    format(params: T): string {
        let str = this._formatString;
        Object.keys(params).forEach((key) => {
            str = str.replace(new RegExp(`{${key}}`, 'g'), (params as any)[key].toString());
        });
        return str;
    }

    getFormatString() {
        return this._formatString;
    }
}

const defaultLocale = 'en-us';
const stringMapsByLocale: Map<string, StringLookupMap> = new Map([
    ['cs', csStrings as StringLookupMap],
    ['de', deStrings],
    ['en-us', enUsStrings],
    ['en', enUsStrings],
    ['es', esStrings],
    ['fr', frStrings],
    ['it', itStrings],
    ['ja', jaStrings],
    ['ko', koStrings],
    ['pl', plStrings],
    ['pt-br', ptBrStrings],
    ['qps-ploc', qpsPlocStrings],
    ['ru', ruStrings],
    ['tr', trStrings],
    ['zh-cn', zhCnStrings],
    ['zh-tw', zhTwStrings],
]);

type CommentedStringValue = {
    message: string;
    comment: string[];
};

export type StringLookupMap = { [key: string]: string | CommentedStringValue | StringLookupMap };
let localizedStrings: StringLookupMap | undefined = undefined;
let defaultStrings: StringLookupMap = {};

function getRawStringDefault(key: string): string {
    if (localizedStrings === undefined) {
        localizedStrings = initialize();
    }

    const keyParts = key.split('.');
    const isDiagnostic = keyParts[0] === 'Diagnostic' || keyParts[0] === 'DiagnosticAddendum';

    const str =
        isDiagnostic && forceEnglishDiagnostics
            ? getRawStringFromMap(defaultStrings, keyParts)
            : getRawStringFromMap(localizedStrings, keyParts) || getRawStringFromMap(defaultStrings, keyParts);

    if (str) {
        return str;
    }

    fail(`Missing localized string for key "${key}"`);
}

let getRawString = getRawStringDefault;

// Function allowing different strings to be used for messages.
// Returns the previous function used for getting messages.
export function setGetRawString(func: (key: string) => string): (key: string) => string {
    const oldLookup = getRawString;
    getRawString = func;
    return oldLookup;
}

export function getRawStringFromMap(map: StringLookupMap, keyParts: string[]): string | undefined {
    let curObj: any = map;

    for (const keyPart of keyParts) {
        if (!curObj[keyPart]) {
            return undefined;
        }

        curObj = curObj[keyPart];
    }

    return typeof curObj === 'string' ? curObj : curObj.message;
}

function initialize(): StringLookupMap {
    defaultStrings = loadDefaultStrings();
    const currentLocale = getLocaleFromEnv();
    return loadStringsForLocale(currentLocale, stringMapsByLocale);
}

let localeOverride: string | undefined;
let forceEnglishDiagnostics = false;

export function setLocaleOverride(locale: string) {
    // Force a reload of the localized strings.
    localizedStrings = undefined;
    localeOverride = locale.toLowerCase();
}

export function setForceEnglishDiagnostics(force: boolean) {
    forceEnglishDiagnostics = force;
}

export function getLocaleFromEnv(): string {
    if (localeOverride) {
        return localeOverride;
    }

    try {
        const env = process?.env;

        // Start with the VSCode environment variables.
        const vscodeConfigString = env?.VSCODE_NLS_CONFIG;
        if (vscodeConfigString) {
            try {
                return JSON.parse(vscodeConfigString).locale || defaultLocale;
            } catch {
                // Fall through
            }
        }

        // See if there is a language env variable.
        const localeString = env?.LC_ALL || env?.LC_MESSAGES || env?.LANG || env?.LANGUAGE;
        if (localeString) {
            // This string may contain a local followed by an encoding (e.g. "en-us.UTF-8").
            const localeStringSplit = localeString.split('.');
            if (localeStringSplit.length > 0 && localeStringSplit[0]) {
                return localeStringSplit[0] || defaultLocale;
            }
        }
    } catch {
        // Just use the default locale
    }

    // Fall back to the default locale.
    return defaultLocale;
}

function loadDefaultStrings(): StringLookupMap {
    const defaultStrings = stringMapsByLocale.get(defaultLocale);
    if (defaultStrings) {
        return defaultStrings;
    }
    console.error('Could not load default strings');
    return {};
}

export function loadStringsForLocale(locale: string, localeMap: Map<string, StringLookupMap>): StringLookupMap {
    if (locale === defaultLocale) {
        // No need to load override if we're using the default.
        return {};
    }

    let override = localeMap.get(locale);
    if (override !== undefined) {
        return override;
    }

    // If we couldn't find the requested locale, try to fall back on a more
    // general version.
    const localeSplit = locale.split('-');
    if (localeSplit.length > 0 && localeSplit[0]) {
        override = localeMap.get(localeSplit[0]);
        if (override !== undefined) {
            return override;
        }
    }

    return {};
}

export namespace Localizer {
    export namespace Diagnostic {
        export const annotatedMetadataInconsistent = () =>
            new ParameterizedString<{ type: string; metadataType: string }>(
                getRawString('Diagnostic.annotatedMetadataInconsistent')
            );
        export const abstractMethodInvocation = () =>
            new ParameterizedString<{ method: string }>(getRawString('Diagnostic.abstractMethodInvocation'));
        export const annotatedParamCountMismatch = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('Diagnostic.annotatedParamCountMismatch')
            );
        export const annotatedTypeArgMissing = () => getRawString('Diagnostic.annotatedTypeArgMissing');
        export const annotationBytesString = () => getRawString('Diagnostic.annotationBytesString');
        export const annotationFormatString = () => getRawString('Diagnostic.annotationFormatString');
        export const annotationNotSupported = () => getRawString('Diagnostic.annotationNotSupported');
        export const annotationRawString = () => getRawString('Diagnostic.annotationRawString');
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
        export const assertTypeArgs = () => getRawString('Diagnostic.assertTypeArgs');
        export const assertTypeTypeMismatch = () =>
            new ParameterizedString<{ expected: string; received: string }>(
                getRawString('Diagnostic.assertTypeTypeMismatch')
            );
        export const assignmentExprContext = () => getRawString('Diagnostic.assignmentExprContext');
        export const assignmentExprComprehension = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.assignmentExprComprehension'));
        export const assignmentExprInSubscript = () => getRawString('Diagnostic.assignmentExprInSubscript');
        export const assignmentInProtocol = () => getRawString('Diagnostic.assignmentInProtocol');
        export const assignmentTargetExpr = () => getRawString('Diagnostic.assignmentTargetExpr');
        export const asyncNotInAsyncFunction = () => getRawString('Diagnostic.asyncNotInAsyncFunction');
        export const awaitIllegal = () => getRawString('Diagnostic.awaitIllegal');
        export const awaitNotAllowed = () => getRawString('Diagnostic.awaitNotAllowed');
        export const awaitNotInAsync = () => getRawString('Diagnostic.awaitNotInAsync');
        export const backticksIllegal = () => getRawString('Diagnostic.backticksIllegal');
        export const baseClassCircular = () => getRawString('Diagnostic.baseClassCircular');
        export const baseClassFinal = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.baseClassFinal'));
        export const baseClassIncompatible = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.baseClassIncompatible'));
        export const baseClassInvalid = () => getRawString('Diagnostic.baseClassInvalid');
        export const baseClassMethodTypeIncompatible = () =>
            new ParameterizedString<{ classType: string; name: string }>(
                getRawString('Diagnostic.baseClassMethodTypeIncompatible')
            );
        export const baseClassVariableTypeIncompatible = () =>
            new ParameterizedString<{ classType: string; name: string }>(
                getRawString('Diagnostic.baseClassVariableTypeIncompatible')
            );
        export const baseClassUnknown = () => getRawString('Diagnostic.baseClassUnknown');
        export const binaryOperationNotAllowed = () => getRawString('Diagnostic.binaryOperationNotAllowed');
        export const bindParamMissing = () =>
            new ParameterizedString<{ methodName: string }>(getRawString('Diagnostic.bindParamMissing'));
        export const bindTypeMismatch = () =>
            new ParameterizedString<{ type: string; methodName: string; paramName: string }>(
                getRawString('Diagnostic.bindTypeMismatch')
            );
        export const breakInExceptionGroup = () => getRawString('Diagnostic.breakInExceptionGroup');
        export const breakOutsideLoop = () => getRawString('Diagnostic.breakOutsideLoop');
        export const bytesUnsupportedEscape = () => getRawString('Diagnostic.bytesUnsupportedEscape');
        export const callableExtraArgs = () => getRawString('Diagnostic.callableExtraArgs');
        export const callableFirstArg = () => getRawString('Diagnostic.callableFirstArg');
        export const callableNotInstantiable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.callableNotInstantiable'));
        export const callableSecondArg = () => getRawString('Diagnostic.callableSecondArg');
        export const casePatternIsIrrefutable = () => getRawString('Diagnostic.casePatternIsIrrefutable');
        export const classAlreadySpecialized = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.classAlreadySpecialized'));
        export const classDecoratorTypeUnknown = () => getRawString('Diagnostic.classDecoratorTypeUnknown');
        export const classDefinitionCycle = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.classDefinitionCycle'));
        export const classGetItemClsParam = () => getRawString('Diagnostic.classGetItemClsParam');
        export const classMethodClsParam = () => getRawString('Diagnostic.classMethodClsParam');
        export const classNotRuntimeSubscriptable = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.classNotRuntimeSubscriptable'));
        export const classPatternBuiltInArgPositional = () =>
            getRawString('Diagnostic.classPatternBuiltInArgPositional');
        export const classPatternPositionalArgCount = () =>
            new ParameterizedString<{ type: string; expected: number; received: number }>(
                getRawString('Diagnostic.classPatternPositionalArgCount')
            );
        export const classPatternTypeAlias = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.classPatternTypeAlias'));
        export const classPropertyDeprecated = () => getRawString('Diagnostic.classPropertyDeprecated');
        export const classTypeParametersIllegal = () => getRawString('Diagnostic.classTypeParametersIllegal');
        export const classVarNotAllowed = () => getRawString('Diagnostic.classVarNotAllowed');
        export const classVarFirstArgMissing = () => getRawString('Diagnostic.classVarFirstArgMissing');
        export const classVarOverridesInstanceVar = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.classVarOverridesInstanceVar')
            );
        export const classVarTooManyArgs = () => getRawString('Diagnostic.classVarTooManyArgs');
        export const classVarWithTypeVar = () => getRawString('Diagnostic.classVarWithTypeVar');
        export const clsSelfParamTypeMismatch = () =>
            new ParameterizedString<{ name: string; classType: string }>(
                getRawString('Diagnostic.clsSelfParamTypeMismatch')
            );
        export const codeTooComplexToAnalyze = () => getRawString('Diagnostic.codeTooComplexToAnalyze');
        export const collectionAliasInstantiation = () =>
            new ParameterizedString<{ type: string; alias: string }>(
                getRawString('Diagnostic.collectionAliasInstantiation')
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
        export const concatenateContext = () => getRawString('Diagnostic.concatenateContext');
        export const concatenateParamSpecMissing = () => getRawString('Diagnostic.concatenateParamSpecMissing');
        export const concatenateTypeArgsMissing = () => getRawString('Diagnostic.concatenateTypeArgsMissing');
        export const conditionalOperandInvalid = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.conditionalOperandInvalid'));
        export const constantRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.constantRedefinition'));
        export const coroutineInConditionalExpression = () =>
            getRawString('Diagnostic.coroutineInConditionalExpression');
        export const constructorParametersMismatch = () =>
            new ParameterizedString<{ classType: string }>(getRawString('Diagnostic.constructorParametersMismatch'));
        export const containmentAlwaysFalse = () =>
            new ParameterizedString<{ leftType: string; rightType: string }>(
                getRawString('Diagnostic.containmentAlwaysFalse')
            );
        export const containmentAlwaysTrue = () =>
            new ParameterizedString<{ leftType: string; rightType: string }>(
                getRawString('Diagnostic.containmentAlwaysTrue')
            );
        export const continueInExceptionGroup = () => getRawString('Diagnostic.continueInExceptionGroup');
        export const continueOutsideLoop = () => getRawString('Diagnostic.continueOutsideLoop');
        export const dataClassBaseClassFrozen = () => getRawString('Diagnostic.dataClassBaseClassFrozen');
        export const dataClassBaseClassNotFrozen = () => getRawString('Diagnostic.dataClassBaseClassNotFrozen');
        export const dataClassConverterFunction = () =>
            new ParameterizedString<{ argType: string; fieldType: string; fieldName: string }>(
                getRawString('Diagnostic.dataClassConverterFunction')
            );
        export const dataClassConverterOverloads = () =>
            new ParameterizedString<{ funcName: string; fieldType: string; fieldName: string }>(
                getRawString('Diagnostic.dataClassConverterOverloads')
            );
        export const dataClassFieldInheritedDefault = () =>
            new ParameterizedString<{ fieldName: string }>(getRawString('Diagnostic.dataClassFieldInheritedDefault'));
        export const dataClassFieldWithDefault = () => getRawString('Diagnostic.dataClassFieldWithDefault');
        export const dataClassFieldWithoutAnnotation = () => getRawString('Diagnostic.dataClassFieldWithoutAnnotation');
        export const dataClassFieldWithPrivateName = () => getRawString('Diagnostic.dataClassFieldWithPrivateName');
        export const dataClassPostInitParamCount = () =>
            new ParameterizedString<{ expected: number }>(getRawString('Diagnostic.dataClassPostInitParamCount'));
        export const dataClassPostInitType = () =>
            new ParameterizedString<{ fieldName: string }>(getRawString('Diagnostic.dataClassPostInitType'));
        export const dataClassSlotsOverwrite = () => getRawString('Diagnostic.dataClassSlotsOverwrite');
        export const dataClassTransformExpectedBoolLiteral = () =>
            getRawString('Diagnostic.dataClassTransformExpectedBoolLiteral');
        export const dataClassTransformFieldSpecifier = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.dataClassTransformFieldSpecifier'));
        export const dataClassTransformPositionalParam = () =>
            getRawString('Diagnostic.dataClassTransformPositionalParam');
        export const dataClassTransformUnknownArgument = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.dataClassTransformUnknownArgument'));
        export const dataProtocolInSubclassCheck = () => getRawString('Diagnostic.dataProtocolInSubclassCheck');
        export const declaredReturnTypePartiallyUnknown = () =>
            new ParameterizedString<{ returnType: string }>(
                getRawString('Diagnostic.declaredReturnTypePartiallyUnknown')
            );
        export const declaredReturnTypeUnknown = () => getRawString('Diagnostic.declaredReturnTypeUnknown');
        export const defaultValueContainsCall = () => getRawString('Diagnostic.defaultValueContainsCall');
        export const defaultValueNotAllowed = () => getRawString('Diagnostic.defaultValueNotAllowed');
        export const deprecatedClass = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedClass'));
        export const deprecatedConstructor = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedConstructor'));
        export const deprecatedDescriptorDeleter = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedDescriptorDeleter'));
        export const deprecatedDescriptorGetter = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedDescriptorGetter'));
        export const deprecatedDescriptorSetter = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedDescriptorSetter'));
        export const deprecatedFunction = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedFunction'));
        export const deprecatedMethod = () =>
            new ParameterizedString<{ name: string; className: string }>(getRawString('Diagnostic.deprecatedMethod'));
        export const deprecatedPropertyDeleter = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedPropertyDeleter'));
        export const deprecatedPropertyGetter = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedPropertyGetter'));
        export const deprecatedPropertySetter = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.deprecatedPropertySetter'));
        export const deprecatedType = () =>
            new ParameterizedString<{ version: string; replacement: string }>(
                getRawString('Diagnostic.deprecatedType')
            );
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
        export const duplicateEnumMember = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.duplicateEnumMember'));
        export const duplicateGenericAndProtocolBase = () => getRawString('Diagnostic.duplicateGenericAndProtocolBase');
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
        export const ellipsisAfterUnpacked = () => getRawString('Diagnostic.ellipsisAfterUnpacked');
        export const ellipsisContext = () => getRawString('Diagnostic.ellipsisContext');
        export const ellipsisSecondArg = () => getRawString('Diagnostic.ellipsisSecondArg');
        export const enumClassOverride = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.enumClassOverride'));
        export const enumMemberDelete = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.enumMemberDelete'));
        export const enumMemberSet = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.enumMemberSet'));
        export const enumMemberTypeAnnotation = () => getRawString('Diagnostic.enumMemberTypeAnnotation');
        export const exceptionGroupIncompatible = () => getRawString('Diagnostic.exceptionGroupIncompatible');
        export const exceptGroupMismatch = () => getRawString('Diagnostic.exceptGroupMismatch');
        export const exceptGroupRequiresType = () => getRawString('Diagnostic.exceptGroupRequiresType');
        export const exceptionGroupTypeIncorrect = () => getRawString('Diagnostic.exceptionGroupTypeIncorrect');
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
        export const expectedCloseBrace = () => getRawString('Diagnostic.expectedCloseBrace');
        export const expectedCloseBracket = () => getRawString('Diagnostic.expectedCloseBracket');
        export const expectedCloseParen = () => getRawString('Diagnostic.expectedCloseParen');
        export const expectedColon = () => getRawString('Diagnostic.expectedColon');
        export const expectedComplexNumberLiteral = () => getRawString('Diagnostic.expectedComplexNumberLiteral');
        export const expectedDecoratorExpr = () => getRawString('Diagnostic.expectedDecoratorExpr');
        export const expectedDecoratorName = () => getRawString('Diagnostic.expectedDecoratorName');
        export const expectedDecoratorNewline = () => getRawString('Diagnostic.expectedDecoratorNewline');
        export const expectedDelExpr = () => getRawString('Diagnostic.expectedDelExpr');
        export const expectedElse = () => getRawString('Diagnostic.expectedElse');
        export const expectedEquals = () => getRawString('Diagnostic.expectedEquals');
        export const expectedExceptionClass = () => getRawString('Diagnostic.expectedExceptionClass');
        export const expectedExceptionObj = () => getRawString('Diagnostic.expectedExceptionObj');
        export const expectedExpr = () => getRawString('Diagnostic.expectedExpr');
        export const expectedIdentifier = () => getRawString('Diagnostic.expectedIdentifier');
        export const expectedImport = () => getRawString('Diagnostic.expectedImport');
        export const expectedImportAlias = () => getRawString('Diagnostic.expectedImportAlias');
        export const expectedImportSymbols = () => getRawString('Diagnostic.expectedImportSymbols');
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
        export const expectedTypeParameterName = () => getRawString('Diagnostic.expectedTypeParameterName');
        export const expectedYieldExpr = () => getRawString('Diagnostic.expectedYieldExpr');
        export const finalClassIsAbstract = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.finalClassIsAbstract'));
        export const finalContext = () => getRawString('Diagnostic.finalContext');
        export const finalInLoop = () => getRawString('Diagnostic.finalInLoop');
        export const finallyBreak = () => getRawString('Diagnostic.finallyBreak');
        export const finallyContinue = () => getRawString('Diagnostic.finallyContinue');
        export const finallyReturn = () => getRawString('Diagnostic.finallyReturn');
        export const finalMethodOverride = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.finalMethodOverride')
            );
        export const finalNonMethod = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.finalNonMethod'));
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
        export const formatStringDebuggingIllegal = () => getRawString('Diagnostic.formatStringDebuggingIllegal');
        export const formatStringEscape = () => getRawString('Diagnostic.formatStringEscape');
        export const formatStringExpectedConversion = () => getRawString('Diagnostic.formatStringExpectedConversion');
        export const formatStringInPattern = () => getRawString('Diagnostic.formatStringInPattern');
        export const formatStringIllegal = () => getRawString('Diagnostic.formatStringIllegal');
        export const formatStringNestedFormatSpecifier = () =>
            getRawString('Diagnostic.formatStringNestedFormatSpecifier');
        export const formatStringNestedQuote = () => getRawString('Diagnostic.formatStringNestedQuote');
        export const formatStringUnicode = () => getRawString('Diagnostic.formatStringUnicode');
        export const formatStringUnterminated = () => getRawString('Diagnostic.formatStringUnterminated');
        export const functionDecoratorTypeUnknown = () => getRawString('Diagnostic.functionDecoratorTypeUnknown');
        export const functionInConditionalExpression = () => getRawString('Diagnostic.functionInConditionalExpression');
        export const functionTypeParametersIllegal = () => getRawString('Diagnostic.functionTypeParametersIllegal');
        export const futureImportLocationNotAllowed = () => getRawString('Diagnostic.futureImportLocationNotAllowed');
        export const generatorAsyncReturnType = () =>
            new ParameterizedString<{ yieldType: string }>(getRawString('Diagnostic.generatorAsyncReturnType'));
        export const generatorNotParenthesized = () => getRawString('Diagnostic.generatorNotParenthesized');
        export const generatorSyncReturnType = () =>
            new ParameterizedString<{ yieldType: string }>(getRawString('Diagnostic.generatorSyncReturnType'));
        export const genericBaseClassNotAllowed = () => getRawString('Diagnostic.genericBaseClassNotAllowed');
        export const genericClassAssigned = () => getRawString('Diagnostic.genericClassAssigned');
        export const genericClassDeleted = () => getRawString('Diagnostic.genericClassDeleted');
        export const genericInstanceVariableAccess = () => getRawString('Diagnostic.genericInstanceVariableAccess');
        export const genericNotAllowed = () => getRawString('Diagnostic.genericNotAllowed');
        export const genericTypeAliasBoundTypeVar = () =>
            new ParameterizedString<{ names: string }>(getRawString('Diagnostic.genericTypeAliasBoundTypeVar'));
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
            new ParameterizedString<{ importName: string; venv: string }>(
                getRawString('Diagnostic.importResolveFailure')
            );
        export const importSourceResolveFailure = () =>
            new ParameterizedString<{ importName: string; venv: string }>(
                getRawString('Diagnostic.importSourceResolveFailure')
            );
        export const importSymbolUnknown = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.importSymbolUnknown'));
        export const incompatibleMethodOverride = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.incompatibleMethodOverride')
            );
        export const inconsistentIndent = () => getRawString('Diagnostic.inconsistentIndent');
        export const inconsistentTabs = () => getRawString('Diagnostic.inconsistentTabs');
        export const initMethodSelfParamTypeVar = () => getRawString('Diagnostic.initMethodSelfParamTypeVar');
        export const initMustReturnNone = () => getRawString('Diagnostic.initMustReturnNone');
        export const initSubclassClsParam = () => getRawString('Diagnostic.initSubclassClsParam');
        export const initSubclassCallFailed = () => getRawString('Diagnostic.initSubclassCallFailed');
        export const initVarNotAllowed = () => getRawString('Diagnostic.initVarNotAllowed');
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
        export const keywordArgShortcutIllegal = () => getRawString('Diagnostic.keywordArgShortcutIllegal');
        export const keywordOnlyAfterArgs = () => getRawString('Diagnostic.keywordOnlyAfterArgs');
        export const keywordParameterMissing = () => getRawString('Diagnostic.keywordParameterMissing');
        export const keywordSubscriptIllegal = () => getRawString('Diagnostic.keywordSubscriptIllegal');
        export const lambdaReturnTypeUnknown = () => getRawString('Diagnostic.lambdaReturnTypeUnknown');
        export const lambdaReturnTypePartiallyUnknown = () =>
            new ParameterizedString<{ returnType: string }>(
                getRawString('Diagnostic.lambdaReturnTypePartiallyUnknown')
            );
        export const listAssignmentMismatch = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.listAssignmentMismatch'));
        export const listInAnnotation = () => getRawString('Diagnostic.listInAnnotation');
        export const literalNamedUnicodeEscape = () => getRawString('Diagnostic.literalNamedUnicodeEscape');
        export const literalUnsupportedType = () => getRawString('Diagnostic.literalUnsupportedType');
        export const literalEmptyArgs = () => getRawString('Diagnostic.literalEmptyArgs');
        export const literalNotAllowed = () => getRawString('Diagnostic.literalNotAllowed');
        export const literalNotCallable = () => getRawString('Diagnostic.literalNotCallable');
        export const matchIncompatible = () => getRawString('Diagnostic.matchIncompatible');
        export const matchIsNotExhaustive = () => getRawString('Diagnostic.matchIsNotExhaustive');
        export const maxParseDepthExceeded = () => getRawString('Diagnostic.maxParseDepthExceeded');
        export const memberAccess = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('Diagnostic.memberAccess'));
        export const memberDelete = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('Diagnostic.memberDelete'));
        export const memberSet = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('Diagnostic.memberSet'));
        export const metaclassConflict = () => getRawString('Diagnostic.metaclassConflict');
        export const metaclassDuplicate = () => getRawString('Diagnostic.metaclassDuplicate');
        export const metaclassIsGeneric = () => getRawString('Diagnostic.metaclassIsGeneric');
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
        export const missingSuperCall = () =>
            new ParameterizedString<{ methodName: string }>(getRawString('Diagnostic.missingSuperCall'));
        export const mixingBytesAndStr = () => getRawString('Diagnostic.mixingBytesAndStr');
        export const moduleAsType = () => getRawString('Diagnostic.moduleAsType');
        export const moduleNotCallable = () => getRawString('Diagnostic.moduleNotCallable');
        export const moduleUnknownMember = () =>
            new ParameterizedString<{ memberName: string; moduleName: string }>(
                getRawString('Diagnostic.moduleUnknownMember')
            );
        export const namedExceptAfterCatchAll = () => getRawString('Diagnostic.namedExceptAfterCatchAll');
        export const namedParamAfterParamSpecArgs = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.namedParamAfterParamSpecArgs'));
        export const namedTupleEmptyName = () => getRawString('Diagnostic.namedTupleEmptyName');
        export const namedTupleEntryRedeclared = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.namedTupleEntryRedeclared')
            );
        export const namedTupleFieldUnderscore = () => getRawString('Diagnostic.namedTupleFieldUnderscore');
        export const namedTupleFirstArg = () => getRawString('Diagnostic.namedTupleFirstArg');
        export const namedTupleMultipleInheritance = () => getRawString('Diagnostic.namedTupleMultipleInheritance');
        export const namedTupleNameKeyword = () => getRawString('Diagnostic.namedTupleNameKeyword');
        export const namedTupleNameType = () => getRawString('Diagnostic.namedTupleNameType');
        export const namedTupleNameUnique = () => getRawString('Diagnostic.namedTupleNameUnique');
        export const namedTupleNoTypes = () => getRawString('Diagnostic.namedTupleNoTypes');
        export const namedTupleSecondArg = () => getRawString('Diagnostic.namedTupleSecondArg');
        export const newClsParam = () => getRawString('Diagnostic.newClsParam');
        export const newTypeAnyOrUnknown = () => getRawString('Diagnostic.newTypeAnyOrUnknown');
        export const newTypeBadName = () => getRawString('Diagnostic.newTypeBadName');
        export const newTypeLiteral = () => getRawString('Diagnostic.newTypeLiteral');
        export const newTypeNameMismatch = () => getRawString('Diagnostic.newTypeNameMismatch');
        export const newTypeNotAClass = () => getRawString('Diagnostic.newTypeNotAClass');
        export const newTypeParamCount = () => getRawString('Diagnostic.newTypeParamCount');
        export const newTypeProtocolClass = () => getRawString('Diagnostic.newTypeProtocolClass');
        export const nonDefaultAfterDefault = () => getRawString('Diagnostic.nonDefaultAfterDefault');
        export const noneNotCallable = () => getRawString('Diagnostic.noneNotCallable');
        export const noneNotIterable = () => getRawString('Diagnostic.noneNotIterable');
        export const noneNotSubscriptable = () => getRawString('Diagnostic.noneNotSubscriptable');
        export const noneNotUsableWith = () => getRawString('Diagnostic.noneNotUsableWith');
        export const noneNotUsableWithAsync = () => getRawString('Diagnostic.noneNotUsableWithAsync');
        export const noneOperator = () =>
            new ParameterizedString<{ operator: string }>(getRawString('Diagnostic.noneOperator'));
        export const noneUnknownMember = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.noneUnknownMember'));
        export const nonLocalInModule = () => getRawString('Diagnostic.nonLocalInModule');
        export const nonLocalNoBinding = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.nonLocalNoBinding'));
        export const nonLocalReassignment = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.nonLocalReassignment'));
        export const nonLocalRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.nonLocalRedefinition'));
        export const noOverload = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.noOverload'));
        export const nonlocalTypeParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.nonlocalTypeParam'));
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
        export const obscuredTypeAliasDeclaration = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.obscuredTypeAliasDeclaration'));
        export const obscuredVariableDeclaration = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.obscuredVariableDeclaration'));
        export const operatorLessOrGreaterDeprecated = () => getRawString('Diagnostic.operatorLessOrGreaterDeprecated');
        export const optionalExtraArgs = () => getRawString('Diagnostic.optionalExtraArgs');
        export const orPatternIrrefutable = () => getRawString('Diagnostic.orPatternIrrefutable');
        export const orPatternMissingName = () => getRawString('Diagnostic.orPatternMissingName');
        export const overlappingKeywordArgs = () =>
            new ParameterizedString<{ names: string }>(getRawString('Diagnostic.overlappingKeywordArgs'));
        export const overlappingOverload = () =>
            new ParameterizedString<{ name: string; obscured: number; obscuredBy: number }>(
                getRawString('Diagnostic.overlappingOverload')
            );
        export const overloadAbstractMismatch = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overloadAbstractMismatch'));
        export const overloadAbstractImplMismatch = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overloadAbstractImplMismatch'));
        export const overloadClassMethodInconsistent = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overloadClassMethodInconsistent'));
        export const overloadFinalImpl = () => getRawString('Diagnostic.overloadFinalImpl');
        export const overloadFinalNoImpl = () => getRawString('Diagnostic.overloadFinalNoImpl');
        export const overloadImplementationMismatch = () =>
            new ParameterizedString<{ name: string; index: number }>(
                getRawString('Diagnostic.overloadImplementationMismatch')
            );
        export const overloadOverrideImpl = () => getRawString('Diagnostic.overloadOverrideImpl');
        export const overloadOverrideNoImpl = () => getRawString('Diagnostic.overloadOverrideNoImpl');
        export const overloadReturnTypeMismatch = () =>
            new ParameterizedString<{ name: string; newIndex: number; prevIndex: number }>(
                getRawString('Diagnostic.overloadReturnTypeMismatch')
            );
        export const overloadStaticMethodInconsistent = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overloadStaticMethodInconsistent'));
        export const overloadWithoutImplementation = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overloadWithoutImplementation'));
        export const overriddenMethodNotFound = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.overriddenMethodNotFound'));
        export const overrideDecoratorMissing = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('Diagnostic.overrideDecoratorMissing')
            );
        export const paramAfterKwargsParam = () => getRawString('Diagnostic.paramAfterKwargsParam');
        export const paramAlreadyAssigned = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramAlreadyAssigned'));
        export const paramAnnotationMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramAnnotationMissing'));
        export const paramNameMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramNameMissing'));
        export const paramSpecArgsKwargsDuplicate = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.paramSpecArgsKwargsDuplicate'));
        export const paramSpecArgsKwargsUsage = () => getRawString('Diagnostic.paramSpecArgsKwargsUsage');
        export const paramSpecArgsMissing = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.paramSpecArgsMissing'));
        export const paramSpecArgsUsage = () => getRawString('Diagnostic.paramSpecArgsUsage');
        export const paramSpecAssignedName = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.paramSpecAssignedName'));
        export const paramSpecContext = () => getRawString('Diagnostic.paramSpecContext');
        export const paramSpecDefaultNotTuple = () => getRawString('Diagnostic.paramSpecDefaultNotTuple');
        export const paramSpecFirstArg = () => getRawString('Diagnostic.paramSpecFirstArg');
        export const paramSpecKwargsUsage = () => getRawString('Diagnostic.paramSpecKwargsUsage');
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
        export const patternNeverMatches = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.patternNeverMatches'));
        export const positionArgAfterNamedArg = () => getRawString('Diagnostic.positionArgAfterNamedArg');
        export const positionArgAfterUnpackedDictArg = () => getRawString('Diagnostic.positionArgAfterUnpackedDictArg');
        export const privateImportFromPyTypedModule = () =>
            new ParameterizedString<{ name: string; module: string }>(
                getRawString('Diagnostic.privateImportFromPyTypedModule')
            );
        export const positionOnlyAfterArgs = () => getRawString('Diagnostic.positionOnlyAfterArgs');
        export const positionOnlyAfterKeywordOnly = () => getRawString('Diagnostic.positionOnlyAfterKeywordOnly');
        export const positionOnlyAfterNon = () => getRawString('Diagnostic.positionOnlyAfterNon');
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
        export const protocolBaseClassWithTypeArgs = () => getRawString('Diagnostic.protocolBaseClassWithTypeArgs');
        export const protocolIllegal = () => getRawString('Diagnostic.protocolIllegal');
        export const protocolNotAllowed = () => getRawString('Diagnostic.protocolNotAllowed');
        export const protocolTypeArgMustBeTypeParam = () => getRawString('Diagnostic.protocolTypeArgMustBeTypeParam');
        export const protocolUnsafeOverlap = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.protocolUnsafeOverlap'));
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
        export const pyrightCommentInvalidDiagnosticBoolValue = () =>
            getRawString('Diagnostic.pyrightCommentInvalidDiagnosticBoolValue');
        export const pyrightCommentInvalidDiagnosticSeverityValue = () =>
            getRawString('Diagnostic.pyrightCommentInvalidDiagnosticSeverityValue');
        export const pyrightCommentMissingDirective = () => getRawString('Diagnostic.pyrightCommentMissingDirective');
        export const pyrightCommentNotOnOwnLine = () => getRawString('Diagnostic.pyrightCommentNotOnOwnLine');
        export const pyrightCommentUnknownDirective = () =>
            new ParameterizedString<{ directive: string }>(getRawString('Diagnostic.pyrightCommentUnknownDirective'));
        export const pyrightCommentUnknownDiagnosticRule = () =>
            new ParameterizedString<{ rule: string }>(getRawString('Diagnostic.pyrightCommentUnknownDiagnosticRule'));
        export const readOnlyArgCount = () => getRawString('Diagnostic.readOnlyArgCount');
        export const readOnlyNotInTypedDict = () => getRawString('Diagnostic.readOnlyNotInTypedDict');
        export const recursiveDefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.recursiveDefinition'));
        export const relativeImportNotAllowed = () => getRawString('Diagnostic.relativeImportNotAllowed');
        export const requiredArgCount = () => getRawString('Diagnostic.requiredArgCount');
        export const requiredNotInTypedDict = () => getRawString('Diagnostic.requiredNotInTypedDict');
        export const returnInAsyncGenerator = () => getRawString('Diagnostic.returnInAsyncGenerator');
        export const returnMissing = () =>
            new ParameterizedString<{ returnType: string }>(getRawString('Diagnostic.returnMissing'));
        export const returnInExceptionGroup = () => getRawString('Diagnostic.returnInExceptionGroup');
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
        export const revealTypeExpectedTextArg = () => getRawString('Diagnostic.revealTypeExpectedTextArg');
        export const revealTypeExpectedTextMismatch = () =>
            new ParameterizedString<{ expected: string; received: string }>(
                getRawString('Diagnostic.revealTypeExpectedTextMismatch')
            );
        export const revealTypeExpectedTypeMismatch = () =>
            new ParameterizedString<{ expected: string; received: string }>(
                getRawString('Diagnostic.revealTypeExpectedTypeMismatch')
            );
        export const selfTypeContext = () => getRawString('Diagnostic.selfTypeContext');
        export const selfTypeMetaclass = () => getRawString('Diagnostic.selfTypeMetaclass');
        export const selfTypeWithTypedSelfOrCls = () => getRawString('Diagnostic.selfTypeWithTypedSelfOrCls');
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
        export const stdlibModuleOverridden = () =>
            new ParameterizedString<{ name: string; path: string }>(getRawString('Diagnostic.stdlibModuleOverridden'));
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
        export const superCallZeroArgFormStaticMethod = () =>
            getRawString('Diagnostic.superCallZeroArgFormStaticMethod');
        export const symbolIsUnbound = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.symbolIsUnbound'));
        export const symbolIsUndefined = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.symbolIsUndefined'));
        export const symbolIsPossiblyUnbound = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.symbolIsPossiblyUnbound'));
        export const symbolOverridden = () =>
            new ParameterizedString<{ name: string; className: string }>(getRawString('Diagnostic.symbolOverridden'));
        export const ternaryNotAllowed = () => getRawString('Diagnostic.ternaryNotAllowed');
        export const totalOrderingMissingMethod = () => getRawString('Diagnostic.totalOrderingMissingMethod');
        export const trailingCommaInFromImport = () => getRawString('Diagnostic.trailingCommaInFromImport');
        export const tryWithoutExcept = () => getRawString('Diagnostic.tryWithoutExcept');
        export const tupleAssignmentMismatch = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.tupleAssignmentMismatch'));
        export const tupleInAnnotation = () => getRawString('Diagnostic.tupleInAnnotation');
        export const tupleIndexOutOfRange = () =>
            new ParameterizedString<{ type: string; index: number }>(getRawString('Diagnostic.tupleIndexOutOfRange'));
        export const typeAliasIllegalExpressionForm = () => getRawString('Diagnostic.typeAliasIllegalExpressionForm');
        export const typeAliasIsRecursiveDirect = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeAliasIsRecursiveDirect'));
        export const typeAliasNotInModuleOrClass = () => getRawString('Diagnostic.typeAliasNotInModuleOrClass');
        export const typeAliasRedeclared = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeAliasRedeclared'));
        export const typeAliasStatementIllegal = () => getRawString('Diagnostic.typeAliasStatementIllegal');
        export const typeAliasStatementBadScope = () => getRawString('Diagnostic.typeAliasStatementBadScope');
        export const typeAliasTypeBadScope = () => getRawString('Diagnostic.typeAliasTypeBadScope');
        export const typeAliasTypeBaseClass = () => getRawString('Diagnostic.typeAliasTypeBaseClass');
        export const typeAliasTypeMustBeAssigned = () => getRawString('Diagnostic.typeAliasTypeMustBeAssigned');
        export const typeAliasTypeNameArg = () => getRawString('Diagnostic.typeAliasTypeNameArg');
        export const typeAliasTypeNameMismatch = () => getRawString('Diagnostic.typeAliasTypeNameMismatch');
        export const typeAliasTypeParamInvalid = () => getRawString('Diagnostic.typeAliasTypeParamInvalid');
        export const typeAnnotationCall = () => getRawString('Diagnostic.typeAnnotationCall');
        export const typeAnnotationVariable = () => getRawString('Diagnostic.typeAnnotationVariable');
        export const typeAnnotationWithCallable = () => getRawString('Diagnostic.typeAnnotationWithCallable');
        export const typeArgListExpected = () => getRawString('Diagnostic.typeArgListExpected');
        export const typeArgListNotAllowed = () => getRawString('Diagnostic.typeArgListNotAllowed');
        export const typeArgsExpectingNone = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeArgsExpectingNone'));
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
        export const typeAssignmentMismatchWildcard = () =>
            new ParameterizedString<{ name: string; sourceType: string; destType: string }>(
                getRawString('Diagnostic.typeAssignmentMismatchWildcard')
            );
        export const typeCallNotAllowed = () => getRawString('Diagnostic.typeCallNotAllowed');
        export const typeCheckOnly = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeCheckOnly'));
        export const typeCommentDeprecated = () => getRawString('Diagnostic.typeCommentDeprecated');
        export const typedDictAccess = () => getRawString('Diagnostic.typedDictAccess');
        export const typedDictAssignedName = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typedDictAssignedName'));
        export const typedDictBadVar = () => getRawString('Diagnostic.typedDictBadVar');
        export const typedDictBaseClass = () => getRawString('Diagnostic.typedDictBaseClass');
        export const typedDictBoolParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typedDictBoolParam'));
        export const typedDictClosedExtras = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('Diagnostic.typedDictClosedExtras'));
        export const typedDictClosedNoExtras = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typedDictClosedNoExtras'));
        export const typedDictDelete = () => getRawString('Diagnostic.typedDictDelete');
        export const typedDictEmptyName = () => getRawString('Diagnostic.typedDictEmptyName');
        export const typedDictEntryName = () => getRawString('Diagnostic.typedDictEntryName');
        export const typedDictEntryUnique = () => getRawString('Diagnostic.typedDictEntryUnique');
        export const typedDictExtraArgs = () => getRawString('Diagnostic.typedDictExtraArgs');
        export const typedDictExtraItemsClosed = () => getRawString('Diagnostic.typedDictExtraItemsClosed');
        export const typedDictFieldNotRequiredRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typedDictFieldNotRequiredRedefinition'));
        export const typedDictFieldReadOnlyRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typedDictFieldReadOnlyRedefinition'));
        export const typedDictFieldRequiredRedefinition = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typedDictFieldRequiredRedefinition'));
        export const typedDictFirstArg = () => getRawString('Diagnostic.typedDictFirstArg');
        export const typedDictInClassPattern = () => getRawString('Diagnostic.typedDictInClassPattern');
        export const typedDictInitsubclassParameter = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typedDictInitsubclassParameter'));
        export const typedDictNotAllowed = () => getRawString('Diagnostic.typedDictNotAllowed');
        export const typedDictSecondArgDict = () => getRawString('Diagnostic.typedDictSecondArgDict');
        export const typedDictSecondArgDictEntry = () => getRawString('Diagnostic.typedDictSecondArgDictEntry');
        export const typedDictSet = () => getRawString('Diagnostic.typedDictSet');
        export const typeExpectedClass = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeExpectedClass'));
        export const typeFormArgs = () => getRawString('Diagnostic.typeFormArgs');
        export const typeGuardArgCount = () => getRawString('Diagnostic.typeGuardArgCount');
        export const typeGuardParamCount = () => getRawString('Diagnostic.typeGuardParamCount');
        export const typeIsReturnType = () =>
            new ParameterizedString<{ type: string; returnType: string }>(getRawString('Diagnostic.typeIsReturnType'));
        export const typeNotAwaitable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeNotAwaitable'));
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
        export const typeNotUsableWithAsync = () =>
            new ParameterizedString<{ type: string; method: string }>(
                getRawString('Diagnostic.typeNotUsableWithAsync')
            );
        export const typeNotSupportBinaryOperator = () =>
            new ParameterizedString<{ leftType: string; rightType: string; operator: string }>(
                getRawString('Diagnostic.typeNotSupportBinaryOperator')
            );
        export const typeNotSupportBinaryOperatorBidirectional = () =>
            new ParameterizedString<{ leftType: string; rightType: string; expectedType: string; operator: string }>(
                getRawString('Diagnostic.typeNotSupportBinaryOperatorBidirectional')
            );
        export const typeNotSupportUnaryOperator = () =>
            new ParameterizedString<{ type: string; operator: string }>(
                getRawString('Diagnostic.typeNotSupportUnaryOperator')
            );
        export const typeNotSupportUnaryOperatorBidirectional = () =>
            new ParameterizedString<{ type: string; expectedType: string; operator: string }>(
                getRawString('Diagnostic.typeNotSupportUnaryOperatorBidirectional')
            );
        export const typeParameterBoundNotAllowed = () => getRawString('Diagnostic.typeParameterBoundNotAllowed');
        export const typeParameterConstraintTuple = () => getRawString('Diagnostic.typeParameterConstraintTuple');
        export const typeParameterExistingTypeParameter = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeParameterExistingTypeParameter'));
        export const typeParametersMissing = () => getRawString('Diagnostic.typeParametersMissing');
        export const typeParameterNotDeclared = () =>
            new ParameterizedString<{ name: string; container: string }>(
                getRawString('Diagnostic.typeParameterNotDeclared')
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
        export const typeVarBoundGeneric = () => getRawString('Diagnostic.typeVarBoundGeneric');
        export const typeVarConstraintGeneric = () => getRawString('Diagnostic.typeVarConstraintGeneric');
        export const typeVarDefaultBoundMismatch = () => getRawString('Diagnostic.typeVarDefaultBoundMismatch');
        export const typeVarDefaultConstraintMismatch = () =>
            getRawString('Diagnostic.typeVarDefaultConstraintMismatch');
        export const typeVarDefaultIllegal = () => getRawString('Diagnostic.typeVarDefaultIllegal');
        export const typeVarDefaultInvalidTypeVar = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarDefaultInvalidTypeVar'));
        export const typeVarFirstArg = () => getRawString('Diagnostic.typeVarFirstArg');
        export const typeVarInvalidForMemberVariable = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarInvalidForMemberVariable'));
        export const typeVarNoMember = () =>
            new ParameterizedString<{ type: string; name: string }>(getRawString('Diagnostic.typeVarNoMember'));
        export const typeVarNotSubscriptable = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.typeVarNotSubscriptable'));
        export const typeVarNotUsedByOuterScope = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarNotUsedByOuterScope'));
        export const typeVarPossiblyUnsolvable = () =>
            new ParameterizedString<{ name: string; param: string }>(
                getRawString('Diagnostic.typeVarPossiblyUnsolvable')
            );
        export const typeVarSingleConstraint = () => getRawString('Diagnostic.typeVarSingleConstraint');
        export const typeVarsNotInGenericOrProtocol = () => getRawString('Diagnostic.typeVarsNotInGenericOrProtocol');
        export const typeVarTupleContext = () => getRawString('Diagnostic.typeVarTupleContext');
        export const typeVarTupleDefaultNotUnpacked = () => getRawString('Diagnostic.typeVarTupleDefaultNotUnpacked');
        export const typeVarTupleMustBeUnpacked = () => getRawString('Diagnostic.typeVarTupleMustBeUnpacked');
        export const typeVarTupleConstraints = () => getRawString('Diagnostic.typeVarTupleConstraints');
        export const typeVarTupleUnknownParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarTupleUnknownParam'));
        export const typeVarUnknownParam = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarUnknownParam'));
        export const typeVarUsedByOuterScope = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarUsedByOuterScope'));
        export const typeVarUsedOnlyOnce = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.typeVarUsedOnlyOnce'));
        export const typeVarVariance = () => getRawString('Diagnostic.typeVarVariance');
        export const typeVarWithDefaultFollowsVariadic = () =>
            new ParameterizedString<{ variadicName: string; typeVarName: string }>(
                getRawString('Diagnostic.typeVarWithDefaultFollowsVariadic')
            );
        export const typeVarWithoutDefault = () =>
            new ParameterizedString<{ name: string; other: string }>(getRawString('Diagnostic.typeVarWithoutDefault'));
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
        export const unannotatedFunctionSkipped = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.unannotatedFunctionSkipped'));
        export const unaryOperationNotAllowed = () => getRawString('Diagnostic.unaryOperationNotAllowed');
        export const unexpectedAsyncToken = () => getRawString('Diagnostic.unexpectedAsyncToken');
        export const unexpectedExprToken = () => getRawString('Diagnostic.unexpectedExprToken');
        export const unexpectedIndent = () => getRawString('Diagnostic.unexpectedIndent');
        export const unexpectedUnindent = () => getRawString('Diagnostic.unexpectedUnindent');
        export const unhashableDictKey = () => getRawString('Diagnostic.unhashableDictKey');
        export const unhashableSetEntry = () => getRawString('Diagnostic.unhashableSetEntry');
        export const unionForwardReferenceNotAllowed = () => getRawString('Diagnostic.unionForwardReferenceNotAllowed');
        export const unionSyntaxIllegal = () => getRawString('Diagnostic.unionSyntaxIllegal');
        export const unionTypeArgCount = () => getRawString('Diagnostic.unionTypeArgCount');
        export const uninitializedAbstractVariables = () =>
            new ParameterizedString<{ classType: string }>(getRawString('Diagnostic.uninitializedAbstractVariables'));
        export const uninitializedInstanceVariable = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.uninitializedInstanceVariable'));
        export const unionUnpackedTuple = () => getRawString('Diagnostic.unionUnpackedTuple');
        export const unionUnpackedTypeVarTuple = () => getRawString('Diagnostic.unionUnpackedTypeVarTuple');
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
        export const unnecessaryIsInstanceNever = () =>
            new ParameterizedString<{ testType: string; classType: string }>(
                getRawString('Diagnostic.unnecessaryIsInstanceNever')
            );
        export const unnecessaryIsSubclassNever = () =>
            new ParameterizedString<{ testType: string; classType: string }>(
                getRawString('Diagnostic.unnecessaryIsSubclassNever')
            );
        export const unnecessaryPyrightIgnore = () => getRawString('Diagnostic.unnecessaryPyrightIgnore');
        export const unnecessaryPyrightIgnoreRule = () =>
            new ParameterizedString<{ name: string }>(getRawString('Diagnostic.unnecessaryPyrightIgnoreRule'));
        export const unnecessaryTypeIgnore = () => getRawString('Diagnostic.unnecessaryTypeIgnore');
        export const unpackArgCount = () => getRawString('Diagnostic.unpackArgCount');
        export const unpackedArgInTypeArgument = () => getRawString('Diagnostic.unpackedArgInTypeArgument');
        export const unpackedArgWithVariadicParam = () => getRawString('Diagnostic.unpackedArgWithVariadicParam');
        export const unpackedDictArgumentNotMapping = () => getRawString('Diagnostic.unpackedDictArgumentNotMapping');
        export const unpackedDictSubscriptIllegal = () => getRawString('Diagnostic.unpackedDictSubscriptIllegal');
        export const unpackedSubscriptIllegal = () => getRawString('Diagnostic.unpackedSubscriptIllegal');
        export const unpackedTypedDictArgument = () => getRawString('Diagnostic.unpackedTypedDictArgument');
        export const unpackedTypeVarTupleExpected = () =>
            new ParameterizedString<{ name1: string; name2: string }>(
                getRawString('Diagnostic.unpackedTypeVarTupleExpected')
            );
        export const unpackExpectedTypedDict = () => getRawString('Diagnostic.unpackExpectedTypedDict');
        export const unpackExpectedTypeVarTuple = () => getRawString('Diagnostic.unpackExpectedTypeVarTuple');
        export const unpackIllegalInComprehension = () => getRawString('Diagnostic.unpackIllegalInComprehension');
        export const unpackInAnnotation = () => getRawString('Diagnostic.unpackInAnnotation');
        export const unpackInDict = () => getRawString('Diagnostic.unpackInDict');
        export const unpackInSet = () => getRawString('Diagnostic.unpackInSet');
        export const unpackNotAllowed = () => getRawString('Diagnostic.unpackNotAllowed');
        export const unpackOperatorNotAllowed = () => getRawString('Diagnostic.unpackOperatorNotAllowed');
        export const unpackTuplesIllegal = () => getRawString('Diagnostic.unpackTuplesIllegal');
        export const unreachableCode = () => getRawString('Diagnostic.unreachableCode');
        export const unreachableCodeType = () => getRawString('Diagnostic.unreachableCodeType');
        export const unreachableExcept = () => getRawString('Diagnostic.unreachableExcept');
        export const unsupportedDunderAllOperation = () => getRawString('Diagnostic.unsupportedDunderAllOperation');
        export const unusedCallResult = () =>
            new ParameterizedString<{ type: string }>(getRawString('Diagnostic.unusedCallResult'));
        export const unusedCoroutine = () => getRawString('Diagnostic.unusedCoroutine');
        export const unusedExpression = () => getRawString('Diagnostic.unusedExpression');
        export const varAnnotationIllegal = () => getRawString('Diagnostic.varAnnotationIllegal');
        export const variableFinalOverride = () =>
            new ParameterizedString<{ className: string; name: string }>(
                getRawString('Diagnostic.variableFinalOverride')
            );
        export const variadicTypeArgsTooMany = () => getRawString('Diagnostic.variadicTypeArgsTooMany');
        export const variadicTypeParamTooManyAlias = () =>
            new ParameterizedString<{ names: string }>(getRawString('Diagnostic.variadicTypeParamTooManyAlias'));
        export const variadicTypeParamTooManyClass = () =>
            new ParameterizedString<{ names: string }>(getRawString('Diagnostic.variadicTypeParamTooManyClass'));
        export const walrusIllegal = () => getRawString('Diagnostic.walrusIllegal');
        export const walrusNotAllowed = () => getRawString('Diagnostic.walrusNotAllowed');
        export const wildcardInFunction = () => getRawString('Diagnostic.wildcardInFunction');
        export const wildcardPatternTypeUnknown = () => getRawString('Diagnostic.wildcardPatternTypeUnknown');
        export const wildcardPatternTypePartiallyUnknown = () =>
            getRawString('Diagnostic.wildcardPatternTypePartiallyUnknown');
        export const wildcardLibraryImport = () => getRawString('Diagnostic.wildcardLibraryImport');
        export const yieldFromIllegal = () => getRawString('Diagnostic.yieldFromIllegal');
        export const yieldFromOutsideAsync = () => getRawString('Diagnostic.yieldFromOutsideAsync');
        export const yieldOutsideFunction = () => getRawString('Diagnostic.yieldOutsideFunction');
        export const yieldWithinComprehension = () => getRawString('Diagnostic.yieldWithinComprehension');
        export const zeroCaseStatementsFound = () => getRawString('Diagnostic.zeroCaseStatementsFound');
        export const zeroLengthTupleNotAllowed = () => getRawString('Diagnostic.zeroLengthTupleNotAllowed');
    }

    export namespace DiagnosticAddendum {
        export const annotatedNotAllowed = () => getRawString('DiagnosticAddendum.annotatedNotAllowed');
        export const argParam = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('DiagnosticAddendum.argParam'));
        export const argParamFunction = () =>
            new ParameterizedString<{ paramName: string; functionName: string }>(
                getRawString('DiagnosticAddendum.argParamFunction')
            );
        export const argsParamMissing = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('DiagnosticAddendum.argsParamMissing'));
        export const argsPositionOnly = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('DiagnosticAddendum.argsPositionOnly')
            );
        export const argumentType = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.argumentType'));
        export const argumentTypes = () =>
            new ParameterizedString<{ types: string }>(getRawString('DiagnosticAddendum.argumentTypes'));
        export const assignToNone = () => getRawString('DiagnosticAddendum.assignToNone');
        export const asyncHelp = () => getRawString('DiagnosticAddendum.asyncHelp');
        export const baseClassIncompatible = () =>
            new ParameterizedString<{ baseClass: string; type: string }>(
                getRawString('DiagnosticAddendum.baseClassIncompatible')
            );
        export const baseClassIncompatibleSubclass = () =>
            new ParameterizedString<{ baseClass: string; subclass: string; type: string }>(
                getRawString('DiagnosticAddendum.baseClassIncompatibleSubclass')
            );
        export const baseClassOverriddenType = () =>
            new ParameterizedString<{ baseClass: string; type: string }>(
                getRawString('DiagnosticAddendum.baseClassOverriddenType')
            );
        export const baseClassOverridesType = () =>
            new ParameterizedString<{ baseClass: string; type: string }>(
                getRawString('DiagnosticAddendum.baseClassOverridesType')
            );
        export const bytesTypePromotions = () => getRawString('DiagnosticAddendum.bytesTypePromotions');
        export const conditionalRequiresBool = () =>
            new ParameterizedString<{ operandType: string; boolReturnType: string }>(
                getRawString('DiagnosticAddendum.conditionalRequiresBool')
            );
        export const dataClassFrozen = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.dataClassFrozen'));
        export const dataClassFieldLocation = () => getRawString('DiagnosticAddendum.dataClassFieldLocation');
        export const dataProtocolUnsupported = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.dataProtocolUnsupported'));
        export const descriptorAccessBindingFailed = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('DiagnosticAddendum.descriptorAccessBindingFailed')
            );
        export const descriptorAccessCallFailed = () =>
            new ParameterizedString<{ name: string; className: string }>(
                getRawString('DiagnosticAddendum.descriptorAccessCallFailed')
            );
        export const finalMethod = () => getRawString('DiagnosticAddendum.finalMethod');
        export const functionParamDefaultMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.functionParamDefaultMissing'));
        export const functionParamName = () =>
            new ParameterizedString<{ destName: string; srcName: string }>(
                getRawString('DiagnosticAddendum.functionParamName')
            );
        export const functionParamPositionOnly = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.functionParamPositionOnly'));
        export const functionReturnTypeMismatch = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.functionReturnTypeMismatch')
            );
        export const functionTooFewParams = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('DiagnosticAddendum.functionTooFewParams')
            );
        export const genericClassNotAllowed = () => getRawString('DiagnosticAddendum.genericClassNotAllowed');
        export const incompatibleGetter = () => getRawString('DiagnosticAddendum.incompatibleGetter');
        export const incompatibleSetter = () => getRawString('DiagnosticAddendum.incompatibleSetter');
        export const incompatibleDeleter = () => getRawString('DiagnosticAddendum.incompatibleDeleter');
        export const initMethodLocation = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.initMethodLocation'));
        export const initMethodSignature = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.initMethodSignature'));
        export const initSubclassLocation = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.initSubclassLocation'));
        export const invariantSuggestionDict = () => getRawString('DiagnosticAddendum.invariantSuggestionDict');
        export const invariantSuggestionList = () => getRawString('DiagnosticAddendum.invariantSuggestionList');
        export const invariantSuggestionSet = () => getRawString('DiagnosticAddendum.invariantSuggestionSet');
        export const isinstanceClassNotSupported = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.isinstanceClassNotSupported'));
        export const functionTooManyParams = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('DiagnosticAddendum.functionTooManyParams')
            );
        export const keyNotRequired = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('DiagnosticAddendum.keyNotRequired'));
        export const keyReadOnly = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('DiagnosticAddendum.keyReadOnly'));
        export const keyRequiredDeleted = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.keyRequiredDeleted'));
        export const keyUndefined = () =>
            new ParameterizedString<{ name: string; type: string }>(getRawString('DiagnosticAddendum.keyUndefined'));
        export const kwargsParamMissing = () =>
            new ParameterizedString<{ paramName: string }>(getRawString('DiagnosticAddendum.kwargsParamMissing'));
        export const listAssignmentMismatch = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.listAssignmentMismatch'));
        export const literalAssignmentMismatch = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.literalAssignmentMismatch')
            );
        export const literalNotAllowed = () => getRawString('DiagnosticAddendum.literalNotAllowed');
        export const matchIsNotExhaustiveType = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.matchIsNotExhaustiveType'));
        export const matchIsNotExhaustiveHint = () => getRawString('DiagnosticAddendum.matchIsNotExhaustiveHint');
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
        export const memberIsClassVarInProtocol = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsClassVarInProtocol'));
        export const memberIsInitVar = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsInitVar'));
        export const memberIsInvariant = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsInvariant'));
        export const memberIsNotClassVarInClass = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsNotClassVarInClass'));
        export const memberIsNotClassVarInProtocol = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsNotClassVarInProtocol'));
        export const memberIsNotReadOnlyInProtocol = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsNotReadOnlyInProtocol'));
        export const memberIsReadOnlyInProtocol = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsReadOnlyInProtocol'));
        export const memberIsWritableInProtocol = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberIsWritableInProtocol'));
        export const memberSetClassVar = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberSetClassVar'));
        export const memberTypeMismatch = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberTypeMismatch'));
        export const memberUnknown = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.memberUnknown'));
        export const metaclassConflict = () =>
            new ParameterizedString<{ metaclass1: string; metaclass2: string }>(
                getRawString('DiagnosticAddendum.metaclassConflict')
            );
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
        export const namedTupleNotAllowed = () => getRawString('DiagnosticAddendum.namedTupleNotAllowed');
        export const newMethodLocation = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.newMethodLocation'));
        export const newMethodSignature = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.newMethodSignature'));
        export const noneNotAllowed = () => getRawString('DiagnosticAddendum.noneNotAllowed');
        export const newTypeClassNotAllowed = () => getRawString('DiagnosticAddendum.newTypeClassNotAllowed');
        export const noOverloadAssignable = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.noOverloadAssignable'));
        export const orPatternMissingName = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.orPatternMissingName'));
        export const overloadIndex = () =>
            new ParameterizedString<{ index: number }>(getRawString('DiagnosticAddendum.overloadIndex'));
        export const overloadSignature = () => getRawString('DiagnosticAddendum.overloadSignature');
        export const overloadNotAssignable = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.overloadNotAssignable'));
        export const overriddenMethod = () => getRawString('DiagnosticAddendum.overriddenMethod');
        export const overriddenSymbol = () => getRawString('DiagnosticAddendum.overriddenSymbol');
        export const overrideIsInvariant = () => getRawString('DiagnosticAddendum.overrideIsInvariant');
        export const overrideInvariantMismatch = () =>
            new ParameterizedString<{ overrideType: string; baseType: string }>(
                getRawString('DiagnosticAddendum.overrideInvariantMismatch')
            );
        export const overrideNoOverloadMatches = () => getRawString('DiagnosticAddendum.overrideNoOverloadMatches');
        export const overrideNotClassMethod = () => getRawString('DiagnosticAddendum.overrideNotClassMethod');
        export const overrideNotInstanceMethod = () => getRawString('DiagnosticAddendum.overrideNotInstanceMethod');
        export const overrideNotStaticMethod = () => getRawString('DiagnosticAddendum.overrideNotStaticMethod');
        export const overrideOverloadNoMatch = () => getRawString('DiagnosticAddendum.overrideOverloadNoMatch');
        export const overrideOverloadOrder = () => getRawString('DiagnosticAddendum.overrideOverloadOrder');
        export const overrideParamKeywordNoDefault = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.overrideParamKeywordNoDefault'));
        export const overrideParamKeywordType = () =>
            new ParameterizedString<{ name: string; baseType: string; overrideType: string }>(
                getRawString('DiagnosticAddendum.overrideParamKeywordType')
            );
        export const overrideParamName = () =>
            new ParameterizedString<{ index: number; baseName: string; overrideName: string }>(
                getRawString('DiagnosticAddendum.overrideParamName')
            );
        export const overrideParamNameExtra = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.overrideParamNameExtra'));
        export const overrideParamNameMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.overrideParamNameMissing'));
        export const overrideParamNamePositionOnly = () =>
            new ParameterizedString<{ index: number; baseName: string }>(
                getRawString('DiagnosticAddendum.overrideParamNamePositionOnly')
            );
        export const overrideParamNoDefault = () =>
            new ParameterizedString<{ index: number }>(getRawString('DiagnosticAddendum.overrideParamNoDefault'));
        export const overrideParamType = () =>
            new ParameterizedString<{ index: number; baseType: string; overrideType: string }>(
                getRawString('DiagnosticAddendum.overrideParamType')
            );
        export const overridePositionalParamCount = () =>
            new ParameterizedString<{ baseCount: number; overrideCount: number }>(
                getRawString('DiagnosticAddendum.overridePositionalParamCount')
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
        export const paramSpecMissingInOverride = () => getRawString('DiagnosticAddendum.paramSpecMissingInOverride');
        export const paramType = () =>
            new ParameterizedString<{ paramType: string }>(getRawString('DiagnosticAddendum.paramType'));
        export const privateImportFromPyTypedSource = () =>
            new ParameterizedString<{ module: string }>(
                getRawString('DiagnosticAddendum.privateImportFromPyTypedSource')
            );
        export const propertyAccessFromProtocolClass = () =>
            getRawString('DiagnosticAddendum.propertyAccessFromProtocolClass');
        export const propertyMethodIncompatible = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.propertyMethodIncompatible'));
        export const propertyMethodMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.propertyMethodMissing'));
        export const propertyMissingDeleter = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.propertyMissingDeleter'));
        export const propertyMissingSetter = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.propertyMissingSetter'));
        export const protocolIncompatible = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.protocolIncompatible')
            );
        export const protocolMemberMissing = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.protocolMemberMissing'));
        export const protocolRequiresRuntimeCheckable = () =>
            getRawString('DiagnosticAddendum.protocolRequiresRuntimeCheckable');
        export const protocolSourceIsNotConcrete = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.protocolSourceIsNotConcrete')
            );
        export const protocolUnsafeOverlap = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.protocolUnsafeOverlap'));
        export const pyrightCommentIgnoreTip = () => getRawString('DiagnosticAddendum.pyrightCommentIgnoreTip');
        export const readOnlyAttribute = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.readOnlyAttribute'));
        export const seeDeclaration = () => getRawString('DiagnosticAddendum.seeDeclaration');
        export const seeClassDeclaration = () => getRawString('DiagnosticAddendum.seeClassDeclaration');
        export const seeFunctionDeclaration = () => getRawString('DiagnosticAddendum.seeFunctionDeclaration');
        export const seeMethodDeclaration = () => getRawString('DiagnosticAddendum.seeMethodDeclaration');
        export const seeParameterDeclaration = () => getRawString('DiagnosticAddendum.seeParameterDeclaration');
        export const seeTypeAliasDeclaration = () => getRawString('DiagnosticAddendum.seeTypeAliasDeclaration');
        export const seeVariableDeclaration = () => getRawString('DiagnosticAddendum.seeVariableDeclaration');
        export const tupleEntryTypeMismatch = () =>
            new ParameterizedString<{ entry: number }>(getRawString('DiagnosticAddendum.tupleEntryTypeMismatch'));
        export const tupleAssignmentMismatch = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.tupleAssignmentMismatch'));
        export const tupleSizeIndeterminateSrc = () =>
            new ParameterizedString<{ expected: number }>(getRawString('DiagnosticAddendum.tupleSizeIndeterminateSrc'));
        export const tupleSizeIndeterminateSrcDest = () =>
            new ParameterizedString<{ expected: number }>(
                getRawString('DiagnosticAddendum.tupleSizeIndeterminateSrcDest')
            );
        export const tupleSizeMismatch = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('DiagnosticAddendum.tupleSizeMismatch')
            );
        export const tupleSizeMismatchIndeterminateDest = () =>
            new ParameterizedString<{ expected: number; received: number }>(
                getRawString('DiagnosticAddendum.tupleSizeMismatchIndeterminateDest')
            );
        export const typeAliasInstanceCheck = () => getRawString('DiagnosticAddendum.typeAliasInstanceCheck');
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
        export const typedDictBaseClass = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.typedDictBaseClass'));
        export const typedDictClassNotAllowed = () => getRawString('DiagnosticAddendum.typedDictClassNotAllowed');
        export const typedDictExtraFieldNotAllowed = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictExtraFieldNotAllowed')
            );
        export const typedDictExtraFieldTypeMismatch = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictExtraFieldTypeMismatch')
            );
        export const typedDictFieldMissing = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldMissing')
            );
        export const typedDictClosedExtraNotAllowed = () =>
            new ParameterizedString<{ name: string }>(
                getRawString('DiagnosticAddendum.typedDictClosedExtraNotAllowed')
            );
        export const typedDictClosedExtraTypeMismatch = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictClosedExtraTypeMismatch')
            );
        export const typedDictClosedFieldNotRequired = () =>
            new ParameterizedString<{ name: string }>(
                getRawString('DiagnosticAddendum.typedDictClosedFieldNotRequired')
            );
        export const typedDictFieldNotReadOnly = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldNotReadOnly')
            );
        export const typedDictFieldNotRequired = () =>
            new ParameterizedString<{ name: string; type: string }>(
                getRawString('DiagnosticAddendum.typedDictFieldNotRequired')
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
        export const typedDictKeyAccess = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.typedDictKeyAccess'));
        export const typedDictNotAllowed = () => getRawString('DiagnosticAddendum.typedDictNotAllowed');
        export const typeIncompatible = () =>
            new ParameterizedString<{ sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.typeIncompatible')
            );
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
        export const typeVarDefaultOutOfScope = () =>
            new ParameterizedString<{ name: string }>(getRawString('DiagnosticAddendum.typeVarDefaultOutOfScope'));
        export const typeVarIsContravariant = () =>
            new ParameterizedString<{ name: string; sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.typeVarIsContravariant')
            );
        export const typeVarIsCovariant = () =>
            new ParameterizedString<{ name: string; sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.typeVarIsCovariant')
            );
        export const typeVarIsInvariant = () =>
            new ParameterizedString<{ name: string; sourceType: string; destType: string }>(
                getRawString('DiagnosticAddendum.typeVarIsInvariant')
            );
        export const typeVarsMissing = () =>
            new ParameterizedString<{ names: string }>(getRawString('DiagnosticAddendum.typeVarsMissing'));
        export const typeVarNotAllowed = () => getRawString('DiagnosticAddendum.typeVarNotAllowed');
        export const typeVarTupleRequiresKnownLength = () =>
            getRawString('DiagnosticAddendum.typeVarTupleRequiresKnownLength');
        export const typeVarUnnecessarySuggestion = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.typeVarUnnecessarySuggestion'));
        export const typeVarUnsolvableRemedy = () => getRawString('DiagnosticAddendum.typeVarUnsolvableRemedy');
        export const unhashableType = () =>
            new ParameterizedString<{ type: string }>(getRawString('DiagnosticAddendum.unhashableType'));
        export const uninitializedAbstractVariable = () =>
            new ParameterizedString<{ name: string; classType: string }>(
                getRawString('DiagnosticAddendum.uninitializedAbstractVariable')
            );
        export const unreachableExcept = () =>
            new ParameterizedString<{ exceptionType: string; parentType: string }>(
                getRawString('DiagnosticAddendum.unreachableExcept')
            );
        export const useDictInstead = () => getRawString('DiagnosticAddendum.useDictInstead');
        export const useListInstead = () => getRawString('DiagnosticAddendum.useListInstead');
        export const useTupleInstead = () => getRawString('DiagnosticAddendum.useTupleInstead');
        export const useTypeInstead = () => getRawString('DiagnosticAddendum.useTypeInstead');
        export const varianceMismatchForClass = () =>
            new ParameterizedString<{ typeVarName: string; className: string }>(
                getRawString('DiagnosticAddendum.varianceMismatchForClass')
            );
        export const varianceMismatchForTypeAlias = () =>
            new ParameterizedString<{ typeVarName: string; typeAliasParam: string }>(
                getRawString('DiagnosticAddendum.varianceMismatchForTypeAlias')
            );
    }

    export namespace CodeAction {
        export const createTypeStub = () => getRawString('CodeAction.createTypeStub');
        export const createTypeStubFor = () =>
            new ParameterizedString<{ moduleName: string }>(getRawString('CodeAction.createTypeStubFor'));
        export const executingCommand = () => getRawString('CodeAction.executingCommand');
        export const filesToAnalyzeOne = () => getRawString('CodeAction.filesToAnalyzeOne');
        export const filesToAnalyzeCount = () =>
            new ParameterizedString<{ count: number }>(getRawString('CodeAction.filesToAnalyzeCount'));
        export const findingReferences = () => getRawString('CodeAction.findingReferences');
        export const organizeImports = () => getRawString('CodeAction.organizeImports');
        export const renameShadowedFile = () =>
            new ParameterizedString<{ newFile: string; oldFile: string }>(
                getRawString('CodeAction.renameShadowedFile')
            );
    }

    export namespace Completion {
        export const autoImportDetail = () => getRawString('Completion.autoImportDetail');
        export const indexValueDetail = () => getRawString('Completion.indexValueDetail');
    }

    export namespace Service {
        export const longOperation = () => getRawString('Service.longOperation');
    }
}

export const LocMessage = Localizer.Diagnostic;
export const LocAddendum = Localizer.DiagnosticAddendum;
