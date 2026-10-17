/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Fields:
////     def install(self):
////         self.[|mixin_tag|]: str = "installed"
////
//// class Meta(type, Fields):
////     def __init__(cls, name, bases, namespace):
////         cls.[|tag|]: str = "created"
////         cls.install()
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
////     value.[|/*mixinInstance*/mixin_tag|]
////     derived.[|/*mixinDerived*/mixin_tag|]
////     Custom.[|/*mixinClassObject*/mixin_tag|]

{
    const definitions = (name: string) =>
        helper
            .getRangesByText()
            .get(name)!
            .filter((r) => !r.marker)
            .map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            });

    helper.verifyFindDefinitions({
        instance: { definitions: definitions('tag') },
        derived: { definitions: definitions('tag') },
        classObject: { definitions: definitions('tag') },
        mixinInstance: { definitions: definitions('mixin_tag') },
        mixinDerived: { definitions: definitions('mixin_tag') },
        mixinClassObject: { definitions: definitions('mixin_tag') },
    });
}
