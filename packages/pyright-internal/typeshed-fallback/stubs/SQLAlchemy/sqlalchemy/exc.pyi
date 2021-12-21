from typing import Any

class HasDescriptionCode:
    code: Any
    def __init__(self, *arg, **kw) -> None: ...

class SQLAlchemyError(HasDescriptionCode, Exception):
    def __unicode__(self): ...

class ArgumentError(SQLAlchemyError): ...

class ObjectNotExecutableError(ArgumentError):
    target: Any
    def __init__(self, target) -> None: ...
    def __reduce__(self): ...

class NoSuchModuleError(ArgumentError): ...
class NoForeignKeysError(ArgumentError): ...
class AmbiguousForeignKeysError(ArgumentError): ...

class CircularDependencyError(SQLAlchemyError):
    cycles: Any
    edges: Any
    def __init__(self, message, cycles, edges, msg: Any | None = ..., code: Any | None = ...) -> None: ...
    def __reduce__(self): ...

class CompileError(SQLAlchemyError): ...

class UnsupportedCompilationError(CompileError):
    code: str
    compiler: Any
    element_type: Any
    message: Any
    def __init__(self, compiler, element_type, message: Any | None = ...) -> None: ...
    def __reduce__(self): ...

class IdentifierError(SQLAlchemyError): ...

class DisconnectionError(SQLAlchemyError):
    invalidate_pool: bool

class InvalidatePoolError(DisconnectionError):
    invalidate_pool: bool

class TimeoutError(SQLAlchemyError): ...
class InvalidRequestError(SQLAlchemyError): ...
class NoInspectionAvailable(InvalidRequestError): ...
class PendingRollbackError(InvalidRequestError): ...
class ResourceClosedError(InvalidRequestError): ...
class NoSuchColumnError(InvalidRequestError, KeyError): ...
class NoResultFound(InvalidRequestError): ...
class MultipleResultsFound(InvalidRequestError): ...
class NoReferenceError(InvalidRequestError): ...

class AwaitRequired(InvalidRequestError):
    code: str

class MissingGreenlet(InvalidRequestError):
    code: str

class NoReferencedTableError(NoReferenceError):
    table_name: Any
    def __init__(self, message, tname) -> None: ...
    def __reduce__(self): ...

class NoReferencedColumnError(NoReferenceError):
    table_name: Any
    column_name: Any
    def __init__(self, message, tname, cname) -> None: ...
    def __reduce__(self): ...

class NoSuchTableError(InvalidRequestError): ...
class UnreflectableTableError(InvalidRequestError): ...
class UnboundExecutionError(InvalidRequestError): ...
class DontWrapMixin: ...

class StatementError(SQLAlchemyError):
    statement: Any
    params: Any
    orig: Any
    ismulti: Any
    hide_parameters: Any
    detail: Any
    def __init__(
        self, message, statement, params, orig, hide_parameters: bool = ..., code: Any | None = ..., ismulti: Any | None = ...
    ) -> None: ...
    def add_detail(self, msg) -> None: ...
    def __reduce__(self): ...

class DBAPIError(StatementError):
    code: str
    @classmethod
    def instance(
        cls,
        statement,
        params,
        orig,
        dbapi_base_err,
        hide_parameters: bool = ...,
        connection_invalidated: bool = ...,
        dialect: Any | None = ...,
        ismulti: Any | None = ...,
    ): ...
    def __reduce__(self): ...
    connection_invalidated: Any
    def __init__(
        self,
        statement,
        params,
        orig,
        hide_parameters: bool = ...,
        connection_invalidated: bool = ...,
        code: Any | None = ...,
        ismulti: Any | None = ...,
    ) -> None: ...

class InterfaceError(DBAPIError):
    code: str

class DatabaseError(DBAPIError):
    code: str

class DataError(DatabaseError):
    code: str

class OperationalError(DatabaseError):
    code: str

class IntegrityError(DatabaseError):
    code: str

class InternalError(DatabaseError):
    code: str

class ProgrammingError(DatabaseError):
    code: str

class NotSupportedError(DatabaseError):
    code: str

class SADeprecationWarning(HasDescriptionCode, DeprecationWarning):
    deprecated_since: Any

class Base20DeprecationWarning(SADeprecationWarning):
    deprecated_since: str

class LegacyAPIWarning(Base20DeprecationWarning): ...
class RemovedIn20Warning(Base20DeprecationWarning): ...
class MovedIn20Warning(RemovedIn20Warning): ...

class SAPendingDeprecationWarning(PendingDeprecationWarning):
    deprecated_since: Any

class SAWarning(HasDescriptionCode, RuntimeWarning): ...
