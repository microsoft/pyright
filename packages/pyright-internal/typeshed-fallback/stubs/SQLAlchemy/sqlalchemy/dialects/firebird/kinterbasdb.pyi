from _typeshed import Incomplete
from typing import Any

from ...sql.sqltypes import Float, Numeric
from .base import FBDialect, FBExecutionContext

class _kinterbasdb_numeric:
    def bind_processor(self, dialect): ...

class _FBNumeric_kinterbasdb(_kinterbasdb_numeric, Numeric): ...
class _FBFloat_kinterbasdb(_kinterbasdb_numeric, Float): ...

class FBExecutionContext_kinterbasdb(FBExecutionContext):
    @property
    def rowcount(self): ...

class FBDialect_kinterbasdb(FBDialect):
    driver: str
    supports_statement_cache: bool
    supports_sane_rowcount: bool
    supports_sane_multi_rowcount: bool
    supports_native_decimal: bool
    colspecs: Any
    enable_rowcount: Any
    type_conv: Any
    concurrency_level: Any
    retaining: Any
    def __init__(
        self, type_conv: int = 200, concurrency_level: int = 1, enable_rowcount: bool = True, retaining: bool = False, **kwargs
    ) -> None: ...
    @classmethod
    def dbapi(cls): ...
    def do_execute(self, cursor, statement, parameters, context: Incomplete | None = None) -> None: ...
    def do_rollback(self, dbapi_connection) -> None: ...
    def do_commit(self, dbapi_connection) -> None: ...
    def create_connect_args(self, url): ...
    def is_disconnect(self, e, connection, cursor): ...

dialect = FBDialect_kinterbasdb
