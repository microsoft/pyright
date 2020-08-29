/// <reference path="fourslash.ts" />

// @filename: dj/__init__.py
// @library: true
//// # empty

// @filename: dj/db/__init__.py
// @library: true
//// # empty

// @filename: dj/db/models/__init__.py
// @library: true
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
//// from .base import Model as Model

// @filename: typings/dj/db/models/base.pyi
//// class Model:
////     def clean_fields(self) -> None: ...

// @filename: test.py
//// from dj.db import models
////
//// class Person(models.Model):
////     pass
////
//// p = Person()
//// p.[|/*marker*/clean_fields|]()

helper.verifyHover({
    marker: {
        value: '```python\n(method) clean_fields: () -> None\n```\nclean\\_fields docs',
        kind: 'markdown',
    },
});
