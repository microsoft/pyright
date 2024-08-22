/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.py
// @library: true
//// class [|/*marker*/Test1|]:
////    def M(self, a: '[|Test1|]'):
////        pass

// @filename: testLib2/__init__.py
// @library: true
//// # We need an indexer to discover references in closed files
//// # that are not referenced in open files (or workspace depends on diagnostic mode)
//// from testLib1 import Test1
////
//// a = Test1()

// @filename: testLib3/__init__.py
// @library: true
//// from testLib1 import [|Test1|]
////
//// class Test3:
////    def M(self, a: [|Test1|]):
////        pass

// @filename: test.py
//// from testLib1 import [|Test1|]
////
//// a = [|Test1|]()

// @filename: test2.py
//// from testLib1 import [|Test1|]
//// from testLib3 import Test3
////
//// a = Test3()
//// b = [|Test1|]()

{
    const ranges = helper.getRanges();

    helper.verifyFindAllReferences({
        marker: {
            references: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
    });
}
