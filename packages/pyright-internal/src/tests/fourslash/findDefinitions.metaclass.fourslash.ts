/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Meta(type):
////     def __init__(cls, name, bases, namespace):
////         cls.[|tag|]: str = "created"
////
//// class Custom(metaclass=Meta):
////     pass
////
//// class Derived(Custom):
////     pass
////
//// def check(value: Custom, derived: Derived):
////     value.[|/*instance*/tag|]
////     derived.[|/*derived*/tag|]
////     Custom.[|/*classObject*/tag|]

{
    const definitions = helper
        .getRangesByText()
        .get('tag')!
        .filter((r) => !r.marker)
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    helper.verifyFindDefinitions({
        instance: { definitions },
        derived: { definitions },
        classObject: { definitions },
    });
}
