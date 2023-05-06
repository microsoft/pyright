from typing import Any

from ...connectors.pyodbc import PyODBCConnector
from ...sql import sqltypes
from .base import SybaseDialect, SybaseExecutionContext

class _SybNumeric_pyodbc(sqltypes.Numeric):
    def bind_processor(self, dialect): ...

class SybaseExecutionContext_pyodbc(SybaseExecutionContext):
    def set_ddl_autocommit(self, connection, value) -> None: ...

class SybaseDialect_pyodbc(PyODBCConnector, SybaseDialect):
    supports_statement_cache: bool
    colspecs: Any
    @classmethod
    def dbapi(cls): ...

dialect = SybaseDialect_pyodbc
