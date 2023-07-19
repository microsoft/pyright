/// <reference path="fourslash.ts" />

// @filename: callHierarchy.py
//// import abc
////
//// class Base(abc.ABC):
////     @abc.abstractmethod
////     def method(self):
////         pass
////
//// class Derived(Base):
////     def method(self):
////         pass
////
//// class BaseConsumer:
////     def [|consumer_base|](self, base: Base):
////         base./*marker1*/method()
////
//// class DerivedConsumer:
////     def [|consumer_derived|](self, derived: Derived):
////         derived./*marker2*/method()

{
    const ranges = helper.getRanges();
    const references = ranges.map((range) => {
        return { path: range.fileName, range: helper.convertPositionRange(range) };
    });
    const itemList = [
        { filePath: references[0].path, range: references[0].range, name: 'consumer_base' },
        { filePath: references[1].path, range: references[1].range, name: 'consumer_derived' },
    ];

    helper.verifyShowCallHierarchyGetIncomingCalls({
        marker1: {
            items: itemList,
        },
        marker2: {
            items: itemList,
        },
    });
}
