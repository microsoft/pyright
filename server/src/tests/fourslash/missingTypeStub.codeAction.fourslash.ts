/// <reference path="fourslash.ts" />

// @filename: mspythonconfig.json
//// {
////   "reportMissingTypeStubs": "warning"
//// }

// @filename: testLib/__init__.py
// @library: true
//// # This is a library file
//// class MyLibrary:
////     def DoEveryThing(self, code: str):
////         pass

// @filename: .src/test.py
//// import [|/*marker*/testLi|]b

helper.verifyCodeActions({
    marker: {
        codeActions: [
            {
                title: `Create Type Stub For "testLib"`,
                kind: Consts.CodeActionKind.QuickFix,
                command: {
                    title: 'Create Type Stub',
                    command: Consts.Commands.createTypeStub,
                    arguments: ['\\', 'testLib', '\\.src\\test.py']
                }
            }
        ]
    }
});
