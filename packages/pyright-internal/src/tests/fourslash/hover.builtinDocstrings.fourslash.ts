/// <reference path="typings/fourslash.d.ts" />

// @filename: docstrings.py
//// [|/*object*/object|]
//// [|/*objectInit*/object|]()
//// object().[|/*objectDir*/__dir__|]
////
//// class A: ...
////
//// [|/*a*/A|]
//// [|/*aInit*/A|]()
//// A().[|/*aDir*/__dir__|]
////
//// class B:
////     """This is the class doc for B."""
////     def __init__(self):
////         """This is the __init__ doc for B."""
////
//// [|/*b*/B|]
//// [|/*bInit*/B|]()
////
//// class C:
////     """This is the class doc for C."""
////     def __init__(self):
////         pass
////
//// [|/*c*/C|]
//// [|/*cInit*/C|]()
////
//// class D:
////     def __init__(self):
////         """This is the __init__ doc for D."""
////         pass
////
//// [|/*d*/D|]
//// [|/*dInit*/D|]()

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
    helper.verifyHover('plaintext', {
        object: '(class) object\n\nThis is the class doc for object.',
        objectInit: 'class object()\n\nThis is the __init__ doc for object.',
        objectDir: '(method) def __dir__() -> Iterable[str]\n\nThis is the __dir__ doc for object.',
        a: '(class) A',
        aInit: 'class A()',
        aDir: '(method) def __dir__() -> Iterable[str]',
        b: '(class) B\n\nThis is the class doc for B.',
        bInit: 'class B()\n\nThis is the __init__ doc for B.',
        c: '(class) C\n\nThis is the class doc for C.',
        cInit: 'class C()\n\nThis is the class doc for C.',
        d: '(class) D',
        dInit: 'class D()\n\nThis is the __init__ doc for D.',
    });
}
