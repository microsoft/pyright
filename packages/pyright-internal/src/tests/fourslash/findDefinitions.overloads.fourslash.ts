/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.pyi
// @library: true
//// from typing import overload
////
//// class C:
////     @overload
////     def method(self): ...
////     @overload
////     def method(self, a): ...
////
//// class C2:
////     @overload
////     def method2(self): ...
////     @overload
////     def method2(self, a): ...
////
//// class C3(C2):
////     @overload
////     def method2(self): ...
////     @overload
////     def method2(self, a): ...
////
//// class C4:
////     @overload
////     def method4(self): ...
////     @overload
////     def method4(self, a): ...
////
//// class C5:
////     @overload
////     def method5(self): ...
////     @overload
////     def method5(self, a): ...
////
//// class C6:
////     @overload
////     def method6(self): ...
////     @overload
////     def method6(self, a): ...
////
//// @overload
//// def method7(): ...
//// @overload
//// def method7(a): ...

// @filename: testLib1/__init__.py
// @library: true
//// from .M import C2, C3 as MC3, method7 as m7
//// from . import D
////
//// class C:
////     @overload
////     def [|method|](self):
////         pass
////
////     @overload
////     def [|method|](self, a):
////         pass
////
//// C3 = MC3
//// C4 = D.N.C4
////
//// class B:
////     @overload
////     def [|method5|](self):
////         pass
////
////     def [|method5|](self, a):
////         pass
////
////     @overload
////     def method6(self):
////         pass
////
////     @overload
////     def method6(self, a):
////         pass
////
//// class C5(B):
////     pass
////
//// class C6(B):
////     @overload
////     def [|method6|](self):
////         pass
////
////     @overload
////     def [|method6|](self, a):
////         pass
////
//// [|method7|] = m7

// @filename: testLib1/M.pyi
// @library: true
//// from . import D
//// C2 = D.C2
//// C3 = D.C3
//// method7 = D.method7

// @filename: testLib1/M.py
// @library: true
//// from . import D
//// C2 = D.C2
//// C3 = D.C3
//// method7 = D.method7

// @filename: testLib1/D.pyi
// @library: true
//// class C2:
////     @overload
////     def method2(self): ...
////     @overload
////     def method2(self, a): ...
////
//// class C3(C2): ...
////
//// class N:
////     class C4:
////         @overload
////         def method4(self): ...
////         @overload
////         def method4(self, a): ...
////
//// @overload
//// def method7(): ...
//// @overload
//// def method7(a): ...

// @filename: testLib1/D.py
// @library: true
//// class C2:
////     def [|method2|](self, a):
////         pass
////
//// class C3(C2):
////     pass
////
//// class N:
////     class C4:
////         def [|method4|](self, a):
////             pass
////
//// def [|method7|](a):
////     pass

// @filename: test.py
//// import testLib1
////
//// testLib1.C().[|/*marker1*/method|]()
//// testLib1.C2().[|/*marker2*/method2|]()
//// testLib1.C3().[|/*marker3*/method2|]()
//// testLib1.C4().[|/*marker4*/method4|](1)
//// testLib1.C5().[|/*marker5*/method5|]()
//// testLib1.C6().[|/*marker6*/method6|](1)
//// testLib1.[|/*marker7*/method7|](1)

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
                    .get('method2')!
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
        },
        'preferSource'
    );
}
