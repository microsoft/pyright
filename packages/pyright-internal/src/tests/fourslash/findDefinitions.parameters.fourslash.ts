/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.pyi
// @library: true
//// from typing import overload
////
//// class C:
////     def method(self, a): ...
////
//// class C2:
////     def method2(self, a2): ...
////
//// class C3:
////     def method3(self, a3): ...
////
//// class C4:
////     def method4(self, a4): ...
////
//// class C5:
////     def method5(self, a5): ...
////
//// class C6:
////     def method6(self, a6): ...
////
//// class C7:
////     @overload
////     def method7(self, a7): ...
////     @overload
////     def method7(self, a7, b7): ...

// @filename: testLib1/__init__.py
// @library: true
//// from .M import C2
//// from . import D
////
//// class C:
////     def method(self, [|a|]):
////         pass
////
//// C3 = D.C3
//// C4 = D.N.C4
////
//// class B:
////     def method5(self, [|a5|]):
////         pass
////
////     def method6(self, a6):
////         pass
////
//// class C5(B):
////     pass
////
//// class C6(B):
////     def method6(self, [|a6|]):
////         pass
////
//// class C7:
////     def method7(self, [|a7|], [|b7|]):
////         pass

// @filename: testLib1/M.py
// @library: true
//// class C2:
////     def method2(self, [|a2|]):
////         pass

// @filename: testLib1/D.py
// @library: true
//// class C3:
////     def method3(self, [|a3|]):
////         pass
////
//// class N:
////     class C4:
////         def method4(self, [|a4|]):
////             pass

// @filename: test.py
//// import testLib1
////
//// testLib1.C().method([|/*marker1*/a|] = 1)
//// testLib1.C2().method2([|/*marker2*/a2|] = 1)
//// testLib1.C3().method3([|/*marker3*/a3|] = 1)
//// testLib1.C4().method4([|/*marker4*/a4|] = 1)
//// testLib1.C5().method5([|/*marker5*/a5|] = 1)
//// testLib1.C6().method6([|/*marker6*/a6|] = 1)
//// testLib1.C7().method7([|/*marker7*/a7|] = 1)
//// testLib1.C7().method7(a7 = 1, [|/*marker7_1*/b7|] = 1)

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: rangeMap
                    .get('a')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker2: {
                definitions: rangeMap
                    .get('a2')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker3: {
                definitions: rangeMap
                    .get('a3')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker4: {
                definitions: rangeMap
                    .get('a4')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker5: {
                definitions: rangeMap
                    .get('a5')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker6: {
                definitions: rangeMap
                    .get('a6')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker7: {
                definitions: rangeMap
                    .get('a7')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker7_1: {
                definitions: rangeMap
                    .get('b7')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
