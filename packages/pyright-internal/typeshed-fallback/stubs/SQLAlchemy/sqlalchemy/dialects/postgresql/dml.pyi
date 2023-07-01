from _typeshed import Incomplete
from typing import Any

from ...sql.dml import Insert as StandardInsert
from ...sql.elements import ClauseElement
from ...util.langhelpers import memoized_property

class Insert(StandardInsert):
    stringify_dialect: str
    inherit_cache: bool
    @memoized_property
    def excluded(self): ...
    def on_conflict_do_update(
        self,
        constraint: Incomplete | None = None,
        index_elements: Incomplete | None = None,
        index_where: Incomplete | None = None,
        set_: Incomplete | None = None,
        where: Incomplete | None = None,
    ) -> None: ...
    def on_conflict_do_nothing(
        self,
        constraint: Incomplete | None = None,
        index_elements: Incomplete | None = None,
        index_where: Incomplete | None = None,
    ) -> None: ...

insert: Any

class OnConflictClause(ClauseElement):
    stringify_dialect: str
    constraint_target: Any
    inferred_target_elements: Any
    inferred_target_whereclause: Any
    def __init__(
        self,
        constraint: Incomplete | None = None,
        index_elements: Incomplete | None = None,
        index_where: Incomplete | None = None,
    ) -> None: ...

class OnConflictDoNothing(OnConflictClause):
    __visit_name__: str

class OnConflictDoUpdate(OnConflictClause):
    __visit_name__: str
    update_values_to_set: Any
    update_whereclause: Any
    def __init__(
        self,
        constraint: Incomplete | None = None,
        index_elements: Incomplete | None = None,
        index_where: Incomplete | None = None,
        set_: Incomplete | None = None,
        where: Incomplete | None = None,
    ) -> None: ...
