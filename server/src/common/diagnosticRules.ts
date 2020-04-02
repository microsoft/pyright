/*
 * diagnosticRules.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Strings that represent each of the diagnostic rules
 * that can be enabled or disabled in the configuration.
 */

export const enum DiagnosticRule {
    strictListInference = 'strictListInference',
    strictDictionaryInference = 'strictDictionaryInference',
    strictParameterNoneValue = 'strictParameterNoneValue',
    enableTypeIgnoreComments = 'enableTypeIgnoreComments',

    reportGeneralTypeIssues = 'reportGeneralTypeIssues',
    reportTypeshedErrors = 'reportTypeshedErrors',
    reportMissingImports = 'reportMissingImports',
    reportMissingTypeStubs = 'reportMissingTypeStubs',
    reportImportCycles = 'reportImportCycles',
    reportUnusedImport = 'reportUnusedImport',
    reportUnusedClass = 'reportUnusedClass',
    reportUnusedFunction = 'reportUnusedFunction',
    reportUnusedVariable = 'reportUnusedVariable',
    reportDuplicateImport = 'reportDuplicateImport',
    reportOptionalSubscript = 'reportOptionalSubscript',
    reportOptionalMemberAccess = 'reportOptionalMemberAccess',
    reportOptionalCall = 'reportOptionalCall',
    reportOptionalIterable = 'reportOptionalIterable',
    reportOptionalContextManager = 'reportOptionalContextManager',
    reportOptionalOperand = 'reportOptionalOperand',
    reportUntypedFunctionDecorator = 'reportUntypedFunctionDecorator',
    reportUntypedClassDecorator = 'reportUntypedClassDecorator',
    reportUntypedBaseClass = 'reportUntypedBaseClass',
    reportUntypedNamedTuple = 'reportUntypedNamedTuple',
    reportPrivateUsage = 'reportPrivateUsage',
    reportConstantRedefinition = 'reportConstantRedefinition',
    reportIncompatibleMethodOverride = 'reportIncompatibleMethodOverride',
    reportInvalidStringEscapeSequence = 'reportInvalidStringEscapeSequence',
    reportUnknownParameterType = 'reportUnknownParameterType',
    reportUnknownArgumentType = 'reportUnknownArgumentType',
    reportUnknownLambdaType = 'reportUnknownLambdaType',
    reportUnknownVariableType = 'reportUnknownVariableType',
    reportUnknownMemberType = 'reportUnknownMemberType',
    reportCallInDefaultInitializer = 'reportCallInDefaultInitializer',
    reportUnnecessaryIsInstance = 'reportUnnecessaryIsInstance',
    reportUnnecessaryCast = 'reportUnnecessaryCast',
    reportAssertAlwaysTrue = 'reportAssertAlwaysTrue',
    reportSelfClsParameterName = 'reportSelfClsParameterName',
    reportImplicitStringConcatenation = 'reportImplicitStringConcatenation'
}
