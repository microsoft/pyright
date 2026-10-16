# This sample tests deprecated calls made by decorator expressions, including
# callable instances returned by factories and selected overloads.

# pyright: reportMissingModuleSource=false

from collections.abc import Callable
from typing import Any, Literal, TypeVar, overload
from typing_extensions import deprecated

F = TypeVar("F", bound=Callable[..., Any])


class DeprecatedDecorator:
    @deprecated("Use a supported decorator")
    def __call__(self, func: F, /) -> F:
        return func


class ConditionalDecorator:
    @overload
    def __call__(self, func: Callable[[Literal["good"]], None], /) -> Callable[[Literal["good"]], None]: ...

    @overload
    @deprecated("The bad overload is deprecated")
    def __call__(self, func: Callable[[Literal["bad"]], None], /) -> Callable[[Literal["bad"]], None]: ...

    def __call__(self, func: Callable[..., None], /) -> Callable[..., None]:
        return func


unconditional = DeprecatedDecorator()
conditional = ConditionalDecorator()


# deprecated use
@unconditional
def direct() -> int:
    return 1


@conditional
def direct_good(value: Literal["good"], /) -> None: ...


# deprecated use
@conditional
def direct_bad(value: Literal["bad"], /) -> None: ...


# deprecated use
@DeprecatedDecorator()
def constructed() -> str:
    return ""


@ConditionalDecorator()
def constructed_good(value: Literal["good"], /) -> None: ...


# deprecated use
@ConditionalDecorator()
def constructed_bad(value: Literal["bad"], /) -> None: ...


def make_decorator() -> DeprecatedDecorator:
    return DeprecatedDecorator()


# deprecated use
@make_decorator()
def from_factory() -> float:
    return 1.0


# Index expressions retain their existing diagnostic behavior.
@[unconditional][0]
def from_index() -> bytes:
    return b""


# deprecated use
@DeprecatedDecorator()
class DecoratedClass:
    pass


class Namespace:
    decorator = unconditional


# deprecated use
@Namespace.decorator
def from_member() -> bool:
    return True


@deprecated("Use a supported function decorator")
def deprecated_function(func: F, /) -> F:
    return func


# A conditional expression already reports its referenced deprecated function.
# The implicit decorator call should not add a duplicate diagnostic.
# deprecated use
@(deprecated_function if True else deprecated_function)
def from_conditional() -> int:
    return 1


def function_factory():
    # deprecated use
    return deprecated_function


# deprecated use
@function_factory()
def from_function_factory() -> int:
    return 1


class EmptyMessageDecorator:
    @deprecated("")
    def __call__(self, func: F, /) -> F:
        return func


# deprecated use
@EmptyMessageDecorator()
def empty_message() -> str:
    return ""


reveal_type(direct(), expected_text="int")
reveal_type(constructed(), expected_text="str")
reveal_type(from_factory(), expected_text="float")
reveal_type(from_index(), expected_text="bytes")
reveal_type(DecoratedClass(), expected_text="DecoratedClass")
reveal_type(from_member(), expected_text="bool")
reveal_type(from_conditional(), expected_text="int")
reveal_type(from_function_factory(), expected_text="int")
reveal_type(empty_message(), expected_text="str")
