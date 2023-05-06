from _typeshed import Incomplete
from typing import Any

from . import roles
from .base import CompileState, DialectKWArgs, Executable, HasCompileState
from .elements import ClauseElement
from .selectable import HasCTE, HasPrefixes, ReturnsRows

class DMLState(CompileState):
    isupdate: bool
    isdelete: bool
    isinsert: bool
    def __init__(self, statement, compiler, **kw) -> None: ...
    @property
    def dml_table(self): ...
    @classmethod
    def get_entity_description(cls, statement) -> dict[str, Incomplete]: ...
    @classmethod
    def get_returning_column_descriptions(cls, statement) -> list[dict[str, Incomplete]]: ...

class InsertDMLState(DMLState):
    isinsert: bool
    include_table_with_column_exprs: bool
    statement: Any
    def __init__(self, statement, compiler, **kw) -> None: ...

class UpdateDMLState(DMLState):
    isupdate: bool
    include_table_with_column_exprs: bool
    statement: Any
    is_multitable: Any
    def __init__(self, statement, compiler, **kw) -> None: ...

class DeleteDMLState(DMLState):
    isdelete: bool
    statement: Any
    def __init__(self, statement, compiler, **kw) -> None: ...

class UpdateBase(roles.DMLRole, HasCTE, HasCompileState, DialectKWArgs, HasPrefixes, ReturnsRows, Executable, ClauseElement):
    __visit_name__: str
    named_with_column: bool
    is_dml: bool
    def params(self, *arg, **kw) -> None: ...
    def with_dialect_options(self, **opt) -> None: ...
    bind: Any
    def returning(self, *cols) -> None: ...
    @property
    def exported_columns(self): ...
    def with_hint(self, text, selectable: Incomplete | None = None, dialect_name: str = "*") -> None: ...
    @property
    def entity_description(self): ...
    @property
    def returning_column_descriptions(self): ...

class ValuesBase(UpdateBase):
    __visit_name__: str
    select: Any
    table: Any
    def __init__(self, table, values, prefixes) -> None: ...
    def values(self, *args, **kwargs) -> None: ...
    def return_defaults(self, *cols) -> None: ...

class Insert(ValuesBase):
    __visit_name__: str
    select: Any
    include_insert_from_select_defaults: bool
    is_insert: bool
    def __init__(
        self,
        table,
        values: Incomplete | None = None,
        inline: bool = False,
        bind: Incomplete | None = None,
        prefixes: Incomplete | None = None,
        returning: Incomplete | None = None,
        return_defaults: bool = False,
        **dialect_kw,
    ) -> None: ...
    def inline(self) -> None: ...
    def from_select(self, names, select, include_defaults: bool = True) -> None: ...

class DMLWhereBase:
    def where(self, *whereclause) -> None: ...
    def filter(self, *criteria): ...
    def filter_by(self, **kwargs): ...
    @property
    def whereclause(self): ...

class Update(DMLWhereBase, ValuesBase):
    __visit_name__: str
    is_update: bool
    def __init__(
        self,
        table,
        whereclause: Incomplete | None = None,
        values: Incomplete | None = None,
        inline: bool = False,
        bind: Incomplete | None = None,
        prefixes: Incomplete | None = None,
        returning: Incomplete | None = None,
        return_defaults: bool = False,
        preserve_parameter_order: bool = False,
        **dialect_kw,
    ) -> None: ...
    def ordered_values(self, *args) -> None: ...
    def inline(self) -> None: ...

class Delete(DMLWhereBase, UpdateBase):
    __visit_name__: str
    is_delete: bool
    table: Any
    def __init__(
        self,
        table,
        whereclause: Incomplete | None = None,
        bind: Incomplete | None = None,
        returning: Incomplete | None = None,
        prefixes: Incomplete | None = None,
        **dialect_kw,
    ) -> None: ...
