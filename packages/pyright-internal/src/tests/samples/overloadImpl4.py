# This sample tests overload implementation compatibility for variadic
# parameter lists.

# pyright: reportOverlappingOverload=false

from typing import Any, Callable, ParamSpec, TypeVarTuple, overload


class Base:
    @overload
    def get(self, key: str) -> Any: ...

    @overload
    def get(self, *keys: str) -> Any: ...

    # This should generate an error because the second overload allows no keys.
    def get(self, key: str, *keys: str) -> Any: ...


class Derived(Base):
    # This should continue to generate an override error. The issue does not
    # require suppressing truthful diagnostics on subclasses.
    def get(self, key: str, *keys: str) -> Any: ...


class IncompatibleDerived(Base):
    # This should generate an additional override error for incompatible types,
    # even though the base implementation is itself invalid.
    def get(self, key: int, *keys: int) -> Any: ...


@overload
def with_default(key: str) -> Any: ...


@overload
def with_default(*keys: str) -> Any: ...


def with_default(key: str = "", *keys: str) -> Any: ...


@overload
def keyword_only(*values: int, flag: bool) -> int: ...


@overload
def keyword_only(*values: str, flag: bool) -> str: ...


def keyword_only(*values: int | str, flag: bool) -> int | str: ...


P = ParamSpec("P")


@overload
def paramspec(func: Callable[P, int], *args: P.args, **kwargs: P.kwargs) -> int: ...


@overload
def paramspec(func: None, *args: Any, **kwargs: Any) -> None: ...


def paramspec(
    func: Callable[P, int] | None, *args: P.args, **kwargs: P.kwargs
) -> int | None: ...


Ts = TypeVarTuple("Ts")


@overload
def variadic_tuple() -> tuple[()]: ...


@overload
def variadic_tuple(*values: *tuple[*Ts]) -> tuple[*Ts]: ...


def variadic_tuple(*values: *tuple[*Ts]) -> tuple[*Ts]: ...
