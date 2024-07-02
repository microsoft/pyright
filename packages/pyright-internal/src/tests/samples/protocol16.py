# This sample tests that function parameter names match in a protocol.

from typing import Any, Protocol


class Session(Protocol):
    def execute(self, statement: Any, *args: Any, **kwargs: Any) -> None: ...


class CoolSession(Protocol):
    def execute(self, stmt: Any, *args: Any, **kwargs: Any) -> None: ...


def func1(arg: Session) -> None: ...


def func2(x: CoolSession):
    # This should generate an error because "statement" and "stmt" don't match.
    func1(x)
