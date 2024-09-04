/// <reference path="typings/fourslash.d.ts" />

// @filename: docstrings.py
//// class A: ...
////
//// class B:
////     """This is the class doc for B."""
////     def __init__(self):
////         """This is the __init__ doc for B."""
////
//// class C:
////     """This is the class doc for C."""
////     def __init__(self):
////         pass
////
//// class D:
////     def __init__(self):
////         """This is the __init__ doc for D."""
////         pass
////
//// A([|/*a*/|])
//// B([|/*b*/|])
//// C([|/*c*/|])
//// D([|/*d*/|])

{
    helper.verifySignature('plaintext', {
        a: {
            signatures: [{ label: '() -> A', parameters: [] }],
            activeParameters: [undefined],
        },
        b: {
            signatures: [{ label: '() -> B', parameters: [], documentation: 'This is the __init__ doc for B.' }],
            activeParameters: [undefined],
        },
        c: {
            signatures: [{ label: '() -> C', parameters: [], documentation: 'This is the class doc for C.' }],
            activeParameters: [undefined],
        },
        d: {
            signatures: [{ label: '() -> D', parameters: [], documentation: 'This is the __init__ doc for D.' }],
            activeParameters: [undefined],
        },
    });
}
