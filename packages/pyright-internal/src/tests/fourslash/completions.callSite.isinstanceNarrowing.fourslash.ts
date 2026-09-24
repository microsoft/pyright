/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Geometry:
////     def geo_method(self): ...
//// class Document:
////     def newfolder(self): ...
////     def newschema(self): ...
//// class Container:
////     def _newfeature(self, cls, **kwargs):
////         feat = cls(**kwargs)
////         # The isinstance narrowing below must not suppress call-site return
////         # type inference, so member completions on the result still include
////         # the concrete Document members.
////         if isinstance(feat, Geometry):
////             pass
////         return feat
////     def newdocument(self, **kwargs):
////         return self._newfeature(Document, **kwargs)
//// doc = Container().newdocument()
//// doc.[|/*marker*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker: {
            completions: [
                {
                    label: 'newfolder',
                    kind: Consts.CompletionItemKind.Method,
                },
                {
                    label: 'newschema',
                    kind: Consts.CompletionItemKind.Method,
                },
            ],
        },
    });
}
