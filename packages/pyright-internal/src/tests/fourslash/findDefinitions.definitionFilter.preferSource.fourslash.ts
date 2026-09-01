/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
// @library: true
//// def [|func1|](a):
////     pass

// @filename: typings/testLib1/__init__.pyi
//// def [|/*ignore*/func1|](a: str): ...

// @filename: test.py
//// from testLib1 import func1
////
//// [|/*marker*/func1|]('')

// @filename: mylib/__init__.py
// @library: true
//// from ._private import Foo as _Foo
//// foo = _Foo()

// @filename: mylib/_private.py
// @library: true
//// class Foo:
////     def [|func|](self) -> int:
////         return 1

// @filename: typings/mylib/__init__.pyi
//// class Foo:
////     def [|/*ignore2*/func|](self) -> int: ...
////
//// foo: Foo

// @filename: test2.py
//// from mylib import foo
//// foo.[|/*marker2*/func|]()

{
    const ranges = helper.getRanges().filter((r) => !r.marker);
    const testLib1Ranges = ranges.filter((r) => r.fileName.replace(/\\/g, '/').endsWith('testLib1/__init__.py'));
    const myLibRanges = ranges.filter((r) => r.fileName.replace(/\\/g, '/').endsWith('mylib/_private.py'));

    helper.verifyFindDefinitions(
        {
            marker: {
                definitions: testLib1Ranges.map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
            },
            marker2: {
                definitions: myLibRanges.map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
            },
        },
        'preferSource'
    );
}
