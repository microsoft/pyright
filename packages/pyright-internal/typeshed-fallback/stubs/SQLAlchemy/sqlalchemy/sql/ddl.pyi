from _typeshed import Incomplete
from typing import Any

from . import roles
from .base import Executable, SchemaVisitor
from .elements import ClauseElement

class _DDLCompiles(ClauseElement): ...

class DDLElement(roles.DDLRole, Executable, _DDLCompiles):
    target: Any
    on: Any
    dialect: Any
    callable_: Any
    def execute(self, bind: Incomplete | None = None, target: Incomplete | None = None): ...  # type: ignore[override]
    def against(self, target) -> None: ...
    state: Any
    def execute_if(
        self, dialect: Incomplete | None = None, callable_: Incomplete | None = None, state: Incomplete | None = None
    ) -> None: ...
    def __call__(self, target, bind, **kw): ...
    bind: Any

class DDL(DDLElement):
    __visit_name__: str
    statement: Any
    context: Any
    def __init__(self, statement, context: Incomplete | None = None, bind: Incomplete | None = None) -> None: ...

class _CreateDropBase(DDLElement):
    element: Any
    bind: Any
    if_exists: Any
    if_not_exists: Any
    def __init__(
        self,
        element,
        bind: Incomplete | None = None,
        if_exists: bool = False,
        if_not_exists: bool = False,
        _legacy_bind: Incomplete | None = None,
    ) -> None: ...
    @property
    def stringify_dialect(self): ...

class CreateSchema(_CreateDropBase):
    __visit_name__: str
    quote: Any
    def __init__(self, name, quote: Incomplete | None = None, **kw) -> None: ...

class DropSchema(_CreateDropBase):
    __visit_name__: str
    quote: Any
    cascade: Any
    def __init__(self, name, quote: Incomplete | None = None, cascade: bool = False, **kw) -> None: ...

class CreateTable(_CreateDropBase):
    __visit_name__: str
    columns: Any
    include_foreign_key_constraints: Any
    def __init__(
        self,
        element,
        bind: Incomplete | None = None,
        include_foreign_key_constraints: Incomplete | None = None,
        if_not_exists: bool = False,
    ) -> None: ...

class _DropView(_CreateDropBase):
    __visit_name__: str

class CreateColumn(_DDLCompiles):
    __visit_name__: str
    element: Any
    def __init__(self, element) -> None: ...

class DropTable(_CreateDropBase):
    __visit_name__: str
    def __init__(self, element, bind: Incomplete | None = None, if_exists: bool = False) -> None: ...

class CreateSequence(_CreateDropBase):
    __visit_name__: str

class DropSequence(_CreateDropBase):
    __visit_name__: str

class CreateIndex(_CreateDropBase):
    __visit_name__: str
    def __init__(self, element, bind: Incomplete | None = None, if_not_exists: bool = False) -> None: ...

class DropIndex(_CreateDropBase):
    __visit_name__: str
    def __init__(self, element, bind: Incomplete | None = None, if_exists: bool = False) -> None: ...

class AddConstraint(_CreateDropBase):
    __visit_name__: str
    def __init__(self, element, *args, **kw) -> None: ...

class DropConstraint(_CreateDropBase):
    __visit_name__: str
    cascade: Any
    def __init__(self, element, cascade: bool = False, **kw) -> None: ...

class SetTableComment(_CreateDropBase):
    __visit_name__: str

class DropTableComment(_CreateDropBase):
    __visit_name__: str

class SetColumnComment(_CreateDropBase):
    __visit_name__: str

class DropColumnComment(_CreateDropBase):
    __visit_name__: str

class DDLBase(SchemaVisitor):
    connection: Any
    def __init__(self, connection) -> None: ...

class SchemaGenerator(DDLBase):
    checkfirst: Any
    tables: Any
    preparer: Any
    dialect: Any
    memo: Any
    def __init__(self, dialect, connection, checkfirst: bool = False, tables: Incomplete | None = None, **kwargs) -> None: ...
    def visit_metadata(self, metadata) -> None: ...
    def visit_table(
        self,
        table,
        create_ok: bool = False,
        include_foreign_key_constraints: Incomplete | None = None,
        _is_metadata_operation: bool = False,
    ) -> None: ...
    def visit_foreign_key_constraint(self, constraint) -> None: ...
    def visit_sequence(self, sequence, create_ok: bool = False) -> None: ...
    def visit_index(self, index, create_ok: bool = False) -> None: ...

class SchemaDropper(DDLBase):
    checkfirst: Any
    tables: Any
    preparer: Any
    dialect: Any
    memo: Any
    def __init__(self, dialect, connection, checkfirst: bool = False, tables: Incomplete | None = None, **kwargs) -> None: ...
    def visit_metadata(self, metadata): ...
    def visit_index(self, index, drop_ok: bool = False) -> None: ...
    def visit_table(self, table, drop_ok: bool = False, _is_metadata_operation: bool = False, _ignore_sequences=()) -> None: ...
    def visit_foreign_key_constraint(self, constraint) -> None: ...
    def visit_sequence(self, sequence, drop_ok: bool = False) -> None: ...

def sort_tables(tables, skip_fn: Incomplete | None = None, extra_dependencies: Incomplete | None = None): ...
def sort_tables_and_constraints(
    tables, filter_fn: Incomplete | None = None, extra_dependencies: Incomplete | None = None, _warn_for_cycles: bool = False
): ...
