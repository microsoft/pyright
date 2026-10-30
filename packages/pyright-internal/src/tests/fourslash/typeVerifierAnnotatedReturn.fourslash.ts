/// <reference path="typings/fourslash.d.ts" />

// @filename: typed_return/py.typed
// @library: true
////

// @filename: typed_return/__init__.py
// @library: true
////
//// def annotated() -> str:
////     return "hello"
////
//// def inferred():
////     return "hello"
////
//// class Example:
////     def __init__(self) -> None:
////         self.from_annotated = annotated()
////         self.from_inferred = inferred()
////         self.from_literal = "hello"
////         self.from_constructor = str()

{
    helper.verifyTypeVerifierResults('typed_return', false, false, {
        generalDiagnostics: [],
        missingClassDocStringCount: 1,
        missingDefaultParamCount: 0,
        missingFunctionDocStringCount: 2,
        moduleName: 'typed_return',
        packageName: 'typed_return',
        modules: new Map<string, object>([['/lib/site-packages/typed_return/__init__.py', {}]]),
        symbols: new Map<string, object>([
            ['typed_return.annotated', { typeKnownStatus: 0 }],
            ['typed_return.inferred', {}],
            ['typed_return.Example', {}],
            ['typed_return.Example.__init__', { typeKnownStatus: 0 }],
            ['typed_return.Example.from_annotated', { typeKnownStatus: 0 }],
            ['typed_return.Example.from_inferred', {}],
            ['typed_return.Example.from_literal', { typeKnownStatus: 0 }],
            ['typed_return.Example.from_constructor', { typeKnownStatus: 1 }],
        ]),
    });
}
