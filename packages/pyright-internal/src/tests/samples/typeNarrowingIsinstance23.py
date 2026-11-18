# This sample tests negative issubclass narrowing for ABCs and protocols
# without losing protection for final classes with custom subclass checks.

from abc import ABC
from typing import Protocol, TypeVar, assert_never, final, runtime_checkable


class SyncLogger(ABC):
    def __init__(self, value: int) -> None:
        pass


class AsyncLogger(ABC):
    pass


def check_sync(logger: SyncLogger) -> SyncLogger:
    return logger


def test_abc_constructor(cls: type[SyncLogger] | type[AsyncLogger]) -> SyncLogger | None:
    if issubclass(cls, AsyncLogger):
        reveal_type(cls, expected_text="type[AsyncLogger]")
        return None
    reveal_type(cls, expected_text="type[SyncLogger]")
    logger = cls(1)
    return check_sync(logger)


def test_abc_exhaustive(cls: type[SyncLogger] | type[AsyncLogger]) -> None:
    if issubclass(cls, SyncLogger):
        reveal_type(cls, expected_text="type[SyncLogger]")
        return
    if issubclass(cls, AsyncLogger):
        reveal_type(cls, expected_text="type[AsyncLogger]")
        return
    assert_never(cls)


def test_abc_nested_tuple(cls: type[SyncLogger] | type[AsyncLogger] | type[int]):
    if not issubclass(cls, ((SyncLogger,), AsyncLogger)):
        reveal_type(cls, expected_text="type[int]")


def test_abc_runtime_union(cls: type[SyncLogger] | type[AsyncLogger] | type[int]):
    if not issubclass(cls, SyncLogger | AsyncLogger):
        reveal_type(cls, expected_text="type[int]")


def test_abc_class_variable(cls: type[SyncLogger] | type[int], other: type[SyncLogger]):
    if not issubclass(cls, other):
        reveal_type(cls, expected_text="type[SyncLogger] | type[int]")


class RegularParameter(ABC):
    TIME: bool | None = True
    KEYWORDS: dict[str, int] = {}


class SpecialParameter(ABC):
    pass


ParameterT = TypeVar("ParameterT", bound=RegularParameter | SpecialParameter)


def test_parameter_metadata(cls: type[ParameterT]):
    if issubclass(cls, SpecialParameter):
        reveal_type(cls, expected_text="type[SpecialParameter]*")
    else:
        reveal_type(cls, expected_text="type[RegularParameter]*")
        return cls.TIME, cls.KEYWORDS


class JavaParams(ABC):
    pass


JP = TypeVar("JP", bound=JavaParams)


def test_from_java(py_type: type[JP]) -> JP:
    if issubclass(py_type, JavaParams):
        reveal_type(py_type, expected_text="type[JavaParams]*")
        py_stage = py_type()
    elif hasattr(py_type, "_from_java"):
        py_stage = py_type._from_java()
    else:
        raise NotImplementedError()
    reveal_type(py_stage, expected_text="JavaParams*")
    return py_stage


@runtime_checkable
class SupportsRun(Protocol):
    def run(self) -> None: ...


class Other:
    pass


def test_protocol_negative(cls: type[SupportsRun] | type[Other]) -> type[Other] | None:
    if issubclass(cls, SupportsRun):
        reveal_type(cls, expected_text="type[SupportsRun]")
        return None
    reveal_type(cls, expected_text="type[Other]")
    return cls


@final
class RejectingABC(ABC):
    @classmethod
    def __subclasshook__(cls, subclass: type) -> bool:
        return False


def test_final_abc(cls: type[RejectingABC], other: type[RejectingABC]) -> int:
    if not issubclass(cls, other):
        reveal_type(cls, expected_text="type[RejectingABC]")
        # This should generate an error because __subclasshook__ can return False.
        return cls
    reveal_type(cls, expected_text="type[RejectingABC]")
    return 0
