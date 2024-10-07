/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// [|/*marker1*/a|] = 1

// @filename: typeshed-fallback/stdlib/builtins.pyi
//// class [|int|]:
////     @overload
////     def __new__(cls: Type[_T], x: str | bytes | SupportsInt | SupportsIndex | _SupportsTrunc = ...) -> _T: ...
////     @overload
////     def __new__(cls: Type[_T], x: str | bytes | bytearray, base: SupportsIndex) -> _T: ...

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindTypeDefinitions({
        marker1: {
            definitions: rangeMap
                .get('int')!
                .filter((r) => !r.marker)
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
    });
}
