from _typeshed import Incomplete
from typing import Any

from ..sql import base as sql_base, expression, util as sql_util
from ..sql.annotation import SupportsCloneAnnotations
from .base import (
    InspectionAttr as InspectionAttr,
    _class_to_mapper as _class_to_mapper,
    _never_set as _never_set,
    _none_set as _none_set,
    attribute_str as attribute_str,
    class_mapper as class_mapper,
    instance_str as instance_str,
    object_mapper as object_mapper,
    object_state as object_state,
    state_attribute_str as state_attribute_str,
    state_class_str as state_class_str,
    state_str as state_str,
)
from .interfaces import CriteriaOption, ORMColumnsClauseRole, ORMEntityColumnsClauseRole, ORMFromClauseRole

all_cascades: Any

class CascadeOptions(frozenset[Any]):
    save_update: Any
    delete: Any
    refresh_expire: Any
    merge: Any
    expunge: Any
    delete_orphan: Any
    def __new__(cls, value_list): ...
    @classmethod
    def from_string(cls, arg): ...

def polymorphic_union(table_map, typecolname, aliasname: str = "p_union", cast_nulls: bool = True): ...
def identity_key(*args, **kwargs): ...

class ORMAdapter(sql_util.ColumnAdapter):
    mapper: Any
    aliased_class: Any
    def __init__(
        self,
        entity,
        equivalents: Incomplete | None = None,
        adapt_required: bool = False,
        allow_label_resolve: bool = True,
        anonymize_labels: bool = False,
    ) -> None: ...

class AliasedClass:
    __name__: Any
    def __init__(
        self,
        mapped_class_or_ac,
        alias: Incomplete | None = None,
        name: Incomplete | None = None,
        flat: bool = False,
        adapt_on_names: bool = False,
        with_polymorphic_mappers=(),
        with_polymorphic_discriminator: Incomplete | None = None,
        base_alias: Incomplete | None = None,
        use_mapper_path: bool = False,
        represents_outer_join: bool = False,
    ) -> None: ...
    def __getattr__(self, key: str): ...

class AliasedInsp(ORMEntityColumnsClauseRole, ORMFromClauseRole, sql_base.MemoizedHasCacheKey, InspectionAttr):
    mapper: Any
    selectable: Any
    name: Any
    polymorphic_on: Any
    represents_outer_join: Any
    with_polymorphic_mappers: Any
    def __init__(
        self,
        entity,
        inspected,
        selectable,
        name,
        with_polymorphic_mappers,
        polymorphic_on,
        _base_alias,
        _use_mapper_path,
        adapt_on_names,
        represents_outer_join,
        nest_adapters: bool,  # added in 1.4.30
    ) -> None: ...
    @property
    def entity(self): ...
    is_aliased_class: bool
    def __clause_element__(self): ...
    @property
    def entity_namespace(self): ...
    @property
    def class_(self): ...

class _WrapUserEntity:
    subject: Any
    def __init__(self, subject) -> None: ...
    def __getattribute__(self, name: str): ...

class LoaderCriteriaOption(CriteriaOption):
    root_entity: Any
    entity: Any
    deferred_where_criteria: bool
    where_criteria: Any
    include_aliases: Any
    propagate_to_loaders: Any
    def __init__(
        self,
        entity_or_base,
        where_criteria,
        loader_only: bool = False,
        include_aliases: bool = False,
        propagate_to_loaders: bool = True,
        track_closure_variables: bool = True,
    ) -> None: ...
    def process_compile_state_replaced_entities(self, compile_state, mapper_entities): ...
    def process_compile_state(self, compile_state) -> None: ...
    def get_global_criteria(self, attributes) -> None: ...

def aliased(
    element, alias: Incomplete | None = None, name: Incomplete | None = None, flat: bool = False, adapt_on_names: bool = False
): ...
def with_polymorphic(
    base,
    classes,
    selectable: bool = False,
    flat: bool = False,
    polymorphic_on: Incomplete | None = None,
    aliased: bool = False,
    adapt_on_names: bool = False,
    innerjoin: bool = False,
    _use_mapper_path: bool = False,
    _existing_alias: Incomplete | None = None,
) -> AliasedClass: ...

class Bundle(ORMColumnsClauseRole, SupportsCloneAnnotations, sql_base.MemoizedHasCacheKey, InspectionAttr):
    single_entity: bool
    is_clause_element: bool
    is_mapper: bool
    is_aliased_class: bool
    is_bundle: bool
    name: Any
    exprs: Any
    c: Any
    def __init__(self, name, *exprs, **kw) -> None: ...
    @property
    def mapper(self): ...
    @property
    def entity(self): ...
    @property
    def entity_namespace(self): ...
    columns: Any
    def __clause_element__(self): ...
    @property
    def clauses(self): ...
    def label(self, name): ...
    def create_row_processor(self, query, procs, labels): ...

class _ORMJoin(expression.Join):
    __visit_name__: Any
    inherit_cache: bool
    onclause: Any
    def __init__(
        self,
        left,
        right,
        onclause: Incomplete | None = None,
        isouter: bool = False,
        full: bool = False,
        _left_memo: Incomplete | None = None,
        _right_memo: Incomplete | None = None,
        _extra_criteria=(),
    ) -> None: ...
    def join(
        self,
        right,
        onclause: Incomplete | None = None,
        isouter: bool = False,
        full: bool = False,
        join_to_left: Incomplete | None = None,
    ): ...
    def outerjoin(
        self, right, onclause: Incomplete | None = None, full: bool = False, join_to_left: Incomplete | None = None
    ): ...

def join(
    left,
    right,
    onclause: Incomplete | None = None,
    isouter: bool = False,
    full: bool = False,
    join_to_left: Incomplete | None = None,
): ...
def outerjoin(left, right, onclause: Incomplete | None = None, full: bool = False, join_to_left: Incomplete | None = None): ...
def with_parent(instance, prop, from_entity: Incomplete | None = None): ...
def has_identity(object_): ...
def was_deleted(object_): ...
def randomize_unitofwork() -> None: ...
