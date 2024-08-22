/// <reference path="typings/fourslash.d.ts" />

// @filename: dj/__init__.py
// @library: true
//// '''dj doc string'''
//// # empty

// @filename: dj/db/__init__.py
// @library: true
//// '''db doc string'''
//// # empty

// @filename: dj/db/models/__init__.py
// @library: true
//// '''models doc string'''
//// from dj.db.models.base import Model

// @filename: dj/db/models/base.py
// @library: true
//// class Model:
////     def clean_fields(self):
////         '''clean_fields docs'''
////         pass

// @filename: typings/dj/__init__.pyi
//// # empty

// @filename: typings/dj/db/__init__.pyi
//// # empty

// @filename: typings/dj/db/models/__init__.pyi
//// '''models doc string'''
//// from .base import Model as Model

// @filename: typings/dj/db/models/base.pyi
//// class Model:
////     def clean_fields(self) -> None: ...

// @filename: test.py
//// from [|/*djmarker*/dj|].[|/*dbmarker*/db|] import [|/*modelsmarker*/models|]
////
//// class Person(models.Model):
////     pass
////
//// p = Person()
//// p.[|/*marker*/clean_fields|]()

helper.verifyHover('markdown', {
    marker: '```python\n(method) def clean_fields() -> None\n```\n---\nclean\\_fields docs',
    djmarker: '```python\n(module) dj\n```\n---\ndj doc string',
    dbmarker: '```python\n(module) db\n```\n---\ndb doc string',
    modelsmarker: '```python\n(module) models\n```\n---\nmodels doc string',
});
