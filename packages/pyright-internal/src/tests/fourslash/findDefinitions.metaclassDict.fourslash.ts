/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Meta(type):
////     pass
////
//// class Custom(metaclass=Meta):
////     pass
////
//// class Derived(Custom):
////     pass
////
//// def check(value: Custom, derived: Derived, meta: Meta):
////     value.[|/*instance*/__dict__|]
////     derived.[|/*derived*/__dict__|]
////     Custom.[|/*classObject*/__dict__|]
////     Derived.[|/*derivedClassObject*/__dict__|]
////     meta.[|/*metaclassInstance*/__dict__|]

// @filename: typeshed-fallback/stdlib/builtins.pyi
//// class object:
////     [|__dict__|]: object
////
//// class type:
////     [|__dict__|]: object

{
    const [instanceDefinition, classDefinition] = helper
        .getRangesByText()
        .get('__dict__')!
        .filter((r) => !r.marker)
        .map((r) => {
            return { path: r.fileName, range: helper.convertPositionRange(r) };
        });

    helper.verifyFindDefinitions({
        instance: { definitions: [instanceDefinition] },
        derived: { definitions: [instanceDefinition] },
        classObject: { definitions: [classDefinition] },
        derivedClassObject: { definitions: [classDefinition] },
        metaclassInstance: { definitions: [classDefinition] },
    });
}
