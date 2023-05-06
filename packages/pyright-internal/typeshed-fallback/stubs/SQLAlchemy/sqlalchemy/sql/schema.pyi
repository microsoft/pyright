from _typeshed import Incomplete
from typing import Any

from ..util.langhelpers import memoized_property
from . import visitors
from .base import DialectKWArgs, Executable, SchemaEventTarget
from .elements import ColumnClause
from .selectable import TableClause

RETAIN_SCHEMA: Any
BLANK_SCHEMA: Any
NULL_UNSPECIFIED: Any

class SchemaItem(SchemaEventTarget, visitors.Visitable):
    __visit_name__: str
    create_drop_stringify_dialect: str
    @property  # Should be @memoized_property, but that causes issues with regr_test
    def info(self): ...

class Table(DialectKWArgs, SchemaItem, TableClause):
    __visit_name__: str
    constraints: Any
    indexes: Any
    def __new__(cls, *args, **kw): ...
    def __init__(self, *args, **kw) -> None: ...
    @property
    def foreign_key_constraints(self): ...
    @property
    def key(self): ...
    @property
    def bind(self): ...
    def add_is_dependent_on(self, table) -> None: ...
    def append_column(self, column, replace_existing: bool = False) -> None: ...  # type: ignore[override]
    def append_constraint(self, constraint) -> None: ...
    def exists(self, bind: Incomplete | None = None): ...
    def create(self, bind: Incomplete | None = None, checkfirst: bool = False) -> None: ...
    def drop(self, bind: Incomplete | None = None, checkfirst: bool = False) -> None: ...
    def tometadata(self, metadata, schema=..., referred_schema_fn: Incomplete | None = None, name: Incomplete | None = None): ...
    def to_metadata(self, metadata, schema=..., referred_schema_fn: Incomplete | None = None, name: Incomplete | None = None): ...

class Column(DialectKWArgs, SchemaItem, ColumnClause):
    __visit_name__: str
    inherit_cache: bool
    key: Any
    primary_key: Any
    nullable: Any
    default: Any
    server_default: Any
    server_onupdate: Any
    index: Any
    unique: Any
    system: Any
    doc: Any
    onupdate: Any
    autoincrement: Any
    constraints: Any
    foreign_keys: Any
    comment: Any
    computed: Any
    identity: Any
    info: Any
    def __init__(self, *args, **kwargs) -> None: ...
    def references(self, column): ...
    def append_foreign_key(self, fk) -> None: ...
    def copy(self, **kw): ...

class ForeignKey(DialectKWArgs, SchemaItem):
    __visit_name__: str
    constraint: Any
    parent: Any
    use_alter: Any
    name: Any
    onupdate: Any
    ondelete: Any
    deferrable: Any
    initially: Any
    link_to_name: Any
    match: Any
    info: Any
    def __init__(
        self,
        column,
        _constraint: Incomplete | None = None,
        use_alter: bool = False,
        name: Incomplete | None = None,
        onupdate: Incomplete | None = None,
        ondelete: Incomplete | None = None,
        deferrable: Incomplete | None = None,
        initially: Incomplete | None = None,
        link_to_name: bool = False,
        match: Incomplete | None = None,
        info: Incomplete | None = None,
        _unresolvable: bool = False,
        **dialect_kw,
    ) -> None: ...
    def copy(self, schema: Incomplete | None = None, **kw): ...
    @property
    def target_fullname(self): ...
    def references(self, table): ...
    def get_referent(self, table): ...
    @memoized_property
    def column(self): ...

class DefaultGenerator(Executable, SchemaItem):
    __visit_name__: str
    is_sequence: bool
    is_server_default: bool
    column: Any
    for_update: Any
    def __init__(self, for_update: bool = False) -> None: ...
    def execute(self, bind: Incomplete | None = None): ...  # type: ignore[override]
    @property
    def bind(self): ...

class ColumnDefault(DefaultGenerator):
    arg: Any
    def __init__(self, arg, **kwargs) -> None: ...
    @memoized_property
    def is_callable(self): ...
    @memoized_property
    def is_clause_element(self): ...
    @memoized_property
    def is_scalar(self): ...

class IdentityOptions:
    start: Any
    increment: Any
    minvalue: Any
    maxvalue: Any
    nominvalue: Any
    nomaxvalue: Any
    cycle: Any
    cache: Any
    order: Any
    def __init__(
        self,
        start: Incomplete | None = None,
        increment: Incomplete | None = None,
        minvalue: Incomplete | None = None,
        maxvalue: Incomplete | None = None,
        nominvalue: Incomplete | None = None,
        nomaxvalue: Incomplete | None = None,
        cycle: Incomplete | None = None,
        cache: Incomplete | None = None,
        order: Incomplete | None = None,
    ) -> None: ...

class Sequence(IdentityOptions, DefaultGenerator):
    __visit_name__: str
    is_sequence: bool
    name: Any
    optional: Any
    schema: Any
    metadata: Any
    data_type: Any
    def __init__(
        self,
        name,
        start: Incomplete | None = None,
        increment: Incomplete | None = None,
        minvalue: Incomplete | None = None,
        maxvalue: Incomplete | None = None,
        nominvalue: Incomplete | None = None,
        nomaxvalue: Incomplete | None = None,
        cycle: Incomplete | None = None,
        schema: Incomplete | None = None,
        cache: Incomplete | None = None,
        order: Incomplete | None = None,
        data_type: Incomplete | None = None,
        optional: bool = False,
        quote: Incomplete | None = None,
        metadata: Incomplete | None = None,
        quote_schema: Incomplete | None = None,
        for_update: bool = False,
    ) -> None: ...
    @memoized_property
    def is_callable(self): ...
    @memoized_property
    def is_clause_element(self): ...
    def next_value(self): ...
    @property
    def bind(self): ...
    def create(self, bind: Incomplete | None = None, checkfirst: bool = True) -> None: ...
    def drop(self, bind: Incomplete | None = None, checkfirst: bool = True) -> None: ...

class FetchedValue(SchemaEventTarget):
    is_server_default: bool
    reflected: bool
    has_argument: bool
    is_clause_element: bool
    for_update: Any
    def __init__(self, for_update: bool = False) -> None: ...

class DefaultClause(FetchedValue):
    has_argument: bool
    arg: Any
    reflected: Any
    def __init__(self, arg, for_update: bool = False, _reflected: bool = False) -> None: ...

class Constraint(DialectKWArgs, SchemaItem):
    __visit_name__: str
    name: Any
    deferrable: Any
    initially: Any
    info: Any
    def __init__(
        self,
        name: Incomplete | None = None,
        deferrable: Incomplete | None = None,
        initially: Incomplete | None = None,
        _create_rule: Incomplete | None = None,
        info: Incomplete | None = None,
        _type_bound: bool = False,
        **dialect_kw,
    ) -> None: ...
    @property
    def table(self): ...
    def copy(self, **kw): ...

class ColumnCollectionMixin:
    columns: Any
    def __init__(self, *columns, **kw) -> None: ...

class ColumnCollectionConstraint(ColumnCollectionMixin, Constraint):
    def __init__(self, *columns, **kw) -> None: ...
    columns: Any
    def __contains__(self, x): ...
    def copy(self, target_table: Incomplete | None = None, **kw): ...
    def contains_column(self, col): ...
    def __iter__(self): ...
    def __len__(self) -> int: ...

class CheckConstraint(ColumnCollectionConstraint):
    __visit_name__: str
    sqltext: Any
    def __init__(
        self,
        sqltext,
        name: Incomplete | None = None,
        deferrable: Incomplete | None = None,
        initially: Incomplete | None = None,
        table: Incomplete | None = None,
        info: Incomplete | None = None,
        _create_rule: Incomplete | None = None,
        _autoattach: bool = True,
        _type_bound: bool = False,
        **kw,
    ) -> None: ...
    @property
    def is_column_level(self): ...
    def copy(self, target_table: Incomplete | None = None, **kw): ...

class ForeignKeyConstraint(ColumnCollectionConstraint):
    __visit_name__: str
    onupdate: Any
    ondelete: Any
    link_to_name: Any
    use_alter: Any
    match: Any
    elements: Any
    def __init__(
        self,
        columns,
        refcolumns,
        name: Incomplete | None = None,
        onupdate: Incomplete | None = None,
        ondelete: Incomplete | None = None,
        deferrable: Incomplete | None = None,
        initially: Incomplete | None = None,
        use_alter: bool = False,
        link_to_name: bool = False,
        match: Incomplete | None = None,
        table: Incomplete | None = None,
        info: Incomplete | None = None,
        **dialect_kw,
    ) -> None: ...
    columns: Any
    @property
    def referred_table(self): ...
    @property
    def column_keys(self): ...
    def copy(self, schema: Incomplete | None = None, target_table: Incomplete | None = None, **kw): ...  # type: ignore[override]

class PrimaryKeyConstraint(ColumnCollectionConstraint):
    __visit_name__: str
    def __init__(self, *columns, **kw) -> None: ...
    @property
    def columns_autoinc_first(self): ...

class UniqueConstraint(ColumnCollectionConstraint):
    __visit_name__: str

class Index(DialectKWArgs, ColumnCollectionMixin, SchemaItem):
    __visit_name__: str
    table: Any
    name: Any
    unique: Any
    info: Any
    expressions: Any
    def __init__(self, name, *expressions, **kw) -> None: ...
    @property
    def bind(self): ...
    def create(self, bind: Incomplete | None = None, checkfirst: bool = False): ...
    def drop(self, bind: Incomplete | None = None, checkfirst: bool = False) -> None: ...

DEFAULT_NAMING_CONVENTION: Any

class MetaData(SchemaItem):
    __visit_name__: str
    tables: Any
    schema: Any
    naming_convention: Any
    info: Any
    def __init__(
        self,
        bind: Incomplete | None = None,
        schema: Incomplete | None = None,
        quote_schema: Incomplete | None = None,
        naming_convention: Incomplete | None = None,
        info: Incomplete | None = None,
    ) -> None: ...
    def __contains__(self, table_or_key) -> bool: ...
    def is_bound(self): ...
    bind: Any
    def clear(self) -> None: ...
    def remove(self, table) -> None: ...
    @property
    def sorted_tables(self): ...
    def reflect(
        self,
        bind: Incomplete | None = None,
        schema: Incomplete | None = None,
        views: bool = False,
        only: Incomplete | None = None,
        extend_existing: bool = False,
        autoload_replace: bool = True,
        resolve_fks: bool = True,
        **dialect_kwargs,
    ) -> None: ...
    def create_all(self, bind: Incomplete | None = None, tables: Incomplete | None = None, checkfirst: bool = True) -> None: ...
    def drop_all(self, bind: Incomplete | None = None, tables: Incomplete | None = None, checkfirst: bool = True) -> None: ...

class ThreadLocalMetaData(MetaData):
    __visit_name__: str
    context: Any
    def __init__(self) -> None: ...
    bind: Any
    def is_bound(self): ...
    def dispose(self) -> None: ...

class Computed(FetchedValue, SchemaItem):
    __visit_name__: str
    sqltext: Any
    persisted: Any
    column: Any
    def __init__(self, sqltext, persisted: Incomplete | None = None) -> None: ...
    def copy(self, target_table: Incomplete | None = None, **kw): ...

class Identity(IdentityOptions, FetchedValue, SchemaItem):
    __visit_name__: str
    always: Any
    on_null: Any
    column: Any
    def __init__(
        self,
        always: bool = False,
        on_null: Incomplete | None = None,
        start: Incomplete | None = None,
        increment: Incomplete | None = None,
        minvalue: Incomplete | None = None,
        maxvalue: Incomplete | None = None,
        nominvalue: Incomplete | None = None,
        nomaxvalue: Incomplete | None = None,
        cycle: Incomplete | None = None,
        cache: Incomplete | None = None,
        order: Incomplete | None = None,
    ) -> None: ...
    def copy(self, **kw): ...
