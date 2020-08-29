/// <reference path="fourslash.ts" />

// @filename: mspythonconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.py
// @library: true
//// class Test1:
////    def M(self, a: Test1):
////     pass

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
