from _typeshed import Incomplete
from typing import Any

def classname_for_table(base, tablename, table): ...
def name_for_scalar_relationship(base, local_cls, referred_cls, constraint): ...
def name_for_collection_relationship(base, local_cls, referred_cls, constraint): ...
def generate_relationship(base, direction, return_fn, attrname, local_cls, referred_cls, **kw): ...

class AutomapBase:
    __abstract__: bool
    classes: Any
    @classmethod
    def prepare(
        cls,
        autoload_with: Incomplete | None = None,
        engine: Incomplete | None = None,
        reflect: bool = False,
        schema: Incomplete | None = None,
        classname_for_table: Incomplete | None = None,
        collection_class: Incomplete | None = None,
        name_for_scalar_relationship: Incomplete | None = None,
        name_for_collection_relationship: Incomplete | None = None,
        generate_relationship: Incomplete | None = None,
        reflection_options=...,
    ) -> None: ...

def automap_base(declarative_base: Incomplete | None = None, **kw): ...
