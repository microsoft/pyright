from ...connectors.mxodbc import MxODBCConnector
from .base import SybaseDialect, SybaseExecutionContext

class SybaseExecutionContext_mxodbc(SybaseExecutionContext): ...

class SybaseDialect_mxodbc(MxODBCConnector, SybaseDialect):
    supports_statement_cache: bool

dialect = SybaseDialect_mxodbc
