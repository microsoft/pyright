/// <reference path="fourslash.ts" />

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
//// object([|/*object*/|])
//// A([|/*a*/|])
//// B([|/*b*/|])
//// C([|/*c*/|])
//// D([|/*d*/|])

// @filename: typeshed-fallback/stdlib/builtins.py
//// class object():
////     """This is the class doc for object."""
////     def __init__(self):
////         """This is the __init__ doc for object."""
////         pass
////
////     def __dir__(self):
////         """This is the __dir__ doc for object."""
////         pass

{
    helper.verifySignature('plaintext', {
        object: {
            signatures: [
                { label: '() -> None', parameters: [], documentation: 'This is the __init__ doc for object.' },
            ],
            activeParameters: [undefined],
        },
        a: {
            signatures: [{ label: '() -> None', parameters: [] }],
            activeParameters: [undefined],
        },
        b: {
            signatures: [{ label: '() -> None', parameters: [], documentation: 'This is the __init__ doc for B.' }],
            activeParameters: [undefined],
        },
        c: {
            signatures: [{ label: '() -> None', parameters: [], documentation: 'This is the class doc for C.' }],
            activeParameters: [undefined],
        },
        d: {
            signatures: [{ label: '() -> None', parameters: [], documentation: 'This is the __init__ doc for D.' }],
            activeParameters: [undefined],
        },
    });
}
