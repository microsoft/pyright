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
////     def method(self): ...
////
//// class C2:
////     def method2(self): ...
////
//// class C3:
////     def method3(self): ...
////
//// class C4:
////     def method4(self): ...
////
//// class C5:
////     def method5(self): ...
////
//// class C6:
////     def method6(self): ...
////
//// class C7:
////     @overload
////     def method7(self): ...
////     @overload
////     def method7(self, a): ...

// @filename: testLib1/__init__.py
// @library: true
//// from .M import C2
//// from . import D
////
//// class C:
////     def [|method|](self):
////         pass
////
//// C3 = D.C3
//// C4 = D.N.C4
////
//// class B:
////     def [|method5|](self):
////         pass
////
////     def method6(self):
////         pass
////
//// class C5(B):
////     pass
////
//// class C6(B):
////     def [|method6|](self):
////         pass
////
//// class C7:
////     def [|method7|](self, a):
////         pass

// @filename: testLib1/M.py
// @library: true
//// class C2:
////     def [|method2|](self):
////         pass

// @filename: testLib1/D.py
// @library: true
//// class C3:
////     def [|method3|](self):
////         pass
////
//// class N:
////     class C4:
////         def [|method4|](self):
////             pass

// @filename: test.py
//// import testLib1
////
//// testLib1.C().[|/*marker1*/method|]()
//// testLib1.C2().[|/*marker2*/method2|]()
//// testLib1.C3().[|/*marker3*/method3|]()
//// testLib1.C4().[|/*marker4*/method4|]()
//// testLib1.C5().[|/*marker5*/method5|]()
//// testLib1.C6().[|/*marker6*/method6|]()
//// testLib1.C7().[|/*marker7*/method7|]()
//// testLib1.C7().[|/*marker7_1*/method7|](1)

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: rangeMap
                    .get('method')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker2: {
                definitions: rangeMap
                    .get('method2')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker3: {
                definitions: rangeMap
                    .get('method3')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker4: {
                definitions: rangeMap
                    .get('method4')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker5: {
                definitions: rangeMap
                    .get('method5')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker6: {
                definitions: rangeMap
                    .get('method6')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker7: {
                definitions: rangeMap
                    .get('method7')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker7_1: {
                definitions: rangeMap
                    .get('method7')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
