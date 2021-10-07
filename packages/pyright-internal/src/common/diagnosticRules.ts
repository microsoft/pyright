/*
 * diagnosticRules.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Strings that represent each of the diagnostic rules
 * that can be enabled or disabled in the configuration.
 */

// Not const enum since keys need to be inspected in tests
// to match declaration of user-visible settings in package.json
export enum DiagnosticRule {
    strictListInference = 'strictListInference',
    strictSetInference = 'strictSetInference',
    strictDictionaryInference = 'strictDictionaryInference',
    strictParameterNoneValue = 'strictParameterNoneValue',
    enableTypeIgnoreComments = 'enableTypeIgnoreComments',

    reportGeneralTypeIssues = 'reportGeneralTypeIssues',
    reportPropertyTypeMismatch = 'reportPropertyTypeMismatch',
    reportFunctionMemberAccess = 'reportFunctionMemberAccess',
    reportMissingImports = 'reportMissingImports',
    reportMissingModuleSource = 'reportMissingModuleSource',
    reportMissingTypeStubs = 'reportMissingTypeStubs',
    reportImportCycles = 'reportImportCycles',
    reportUnusedImport = 'reportUnusedImport',
    reportUnusedClass = 'reportUnusedClass',
    reportUnusedFunction = 'reportUnusedFunction',
    reportUnusedVariable = 'reportUnusedVariable',
    reportDuplicateImport = 'reportDuplicateImport',
    reportWildcardImportFromLibrary = 'reportWildcardImportFromLibrary',
    reportOptionalSubscript = 'reportOptionalSubscript',
    reportOptionalMemberAccess = 'reportOptionalMemberAccess',
    reportOptionalCall = 'reportOptionalCall',
    reportOptionalIterable = 'reportOptionalIterable',
    reportOptionalContextManager = 'reportOptionalContextManager',
    reportOptionalOperand = 'reportOptionalOperand',
    reportTypedDictNotRequiredAccess = 'reportTypedDictNotRequiredAccess',
    reportUntypedFunctionDecorator = 'reportUntypedFunctionDecorator',
    reportUntypedClassDecorator = 'reportUntypedClassDecorator',
    reportUntypedBaseClass = 'reportUntypedBaseClass',
    reportUntypedNamedTuple = 'reportUntypedNamedTuple',
    reportPrivateUsage = 'reportPrivateUsage',
    reportPrivateImportUsage = 'reportPrivateImportUsage',
    reportConstantRedefinition = 'reportConstantRedefinition',
    reportIncompatibleMethodOverride = 'reportIncompatibleMethodOverride',
    reportIncompatibleVariableOverride = 'reportIncompatibleVariableOverride',
    reportOverlappingOverload = 'reportOverlappingOverload',
    reportUninitializedInstanceVariable = 'reportUninitializedInstanceVariable',
    reportInvalidStringEscapeSequence = 'reportInvalidStringEscapeSequence',
    reportUnknownParameterType = 'reportUnknownParameterType',
    reportUnknownArgumentType = 'reportUnknownArgumentType',
    reportUnknownLambdaType = 'reportUnknownLambdaType',
    reportUnknownVariableType = 'reportUnknownVariableType',
    reportUnknownMemberType = 'reportUnknownMemberType',
    reportMissingParameterType = 'reportMissingParameterType',
    reportMissingTypeArgument = 'reportMissingTypeArgument',
    reportInvalidTypeVarUse = 'reportInvalidTypeVarUse',
    reportCallInDefaultInitializer = 'reportCallInDefaultInitializer',
    reportUnnecessaryIsInstance = 'reportUnnecessaryIsInstance',
    reportUnnecessaryCast = 'reportUnnecessaryCast',
    reportUnnecessaryComparison = 'reportUnnecessaryComparison',
    reportAssertAlwaysTrue = 'reportAssertAlwaysTrue',
    reportSelfClsParameterName = 'reportSelfClsParameterName',
    reportImplicitStringConcatenation = 'reportImplicitStringConcatenation',
    reportUndefinedVariable = 'reportUndefinedVariable',
    reportUnboundVariable = 'reportUnboundVariable',
    reportInvalidStubStatement = 'reportInvalidStubStatement',
    reportIncompleteStub = 'reportIncompleteStub',
    reportUnsupportedDunderAll = 'reportUnsupportedDunderAll',
    reportUnusedCallResult = 'reportUnusedCallResult',
    reportUnusedCoroutine = 'reportUnusedCoroutine',
}
