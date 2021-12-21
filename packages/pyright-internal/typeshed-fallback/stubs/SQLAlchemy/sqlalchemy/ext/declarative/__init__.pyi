from ...orm.decl_api import DeclarativeMeta as DeclarativeMeta, declared_attr as declared_attr
from .extensions import (
    AbstractConcreteBase as AbstractConcreteBase,
    ConcreteBase as ConcreteBase,
    DeferredReflection as DeferredReflection,
    instrument_declarative as instrument_declarative,
)

__all__ = [
    "declarative_base",
    "synonym_for",
    "has_inherited_table",
    "instrument_declarative",
    "declared_attr",
    "as_declarative",
    "ConcreteBase",
    "AbstractConcreteBase",
    "DeclarativeMeta",
    "DeferredReflection",
]

def declarative_base(*arg, **kw): ...
def as_declarative(*arg, **kw): ...
def has_inherited_table(*arg, **kw): ...
def synonym_for(*arg, **kw): ...
