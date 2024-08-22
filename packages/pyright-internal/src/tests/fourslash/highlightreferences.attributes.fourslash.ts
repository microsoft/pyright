/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class DummyClass:
////     def __init__(self):
////         self.[|{| "kind":"write" |}var|] = 1
////         self.[|{| "kind":"write" |}var|] += 1
////
////     def method_1(self):
////         self.[|{| "kind":"write" |}var|] += 2
////         self.[|{| "kind":"write" |}var|] = None
////
////     def method_2(self):
////         self.[|{| "kind":"write" |}var|] += 3
////         self.[|{| "kind":"write" |}var|] = None
////         self.[|{| "name":"marker", "kind":"write" |}var|] = 1
////
//// x = DummyClass()
//// print(x.[|{| "kind":"read" |}var|])

{
    const ranges = helper.getRanges();

    helper.verifyHighlightReferences({
        marker: {
            references: ranges.map((r) => {
                return { range: helper.convertPositionRange(r), kind: helper.getDocumentHighlightKind(r.marker) };
            }),
        },
    });
}
