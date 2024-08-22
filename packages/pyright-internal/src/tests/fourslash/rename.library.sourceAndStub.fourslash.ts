/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.py
// @library: true
//// class Test1:
////    def M(self, a):
////     pass

// @filename: typings/testLib1/__init__.pyi
//// class Test1:
////    def M(self, a: Test1): ...

// @filename: test.py
//// from testLib1 import Test1
////
//// a = [|/*marker*/Test1|]()

// @filename: test2.py
//// from testLib1 import Test1
////
//// b = Test1()

helper.verifyRename({
    marker: {
        newName: 'NewTest1',
        changes: [],
    },
});
