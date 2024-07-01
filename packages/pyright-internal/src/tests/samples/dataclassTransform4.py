# This sample tests the case where a field descriptor has an implicit
# "init" parameter type based on an overload.

from typing import (
    Any,
    Callable,
    Literal,
    TypeVar,
    overload,
)

T = TypeVar("T")


@overload
def field1(
    *,
    default: str | None = None,
    resolver: Callable[[], Any],
    init: Literal[False] = False,
) -> Any: ...


@overload
def field1(
    *,
    default: str | None = None,
    resolver: None = None,
    init: Literal[True] = True,
) -> Any: ...


def field1(
    *,
    default: str | None = None,
    resolver: Callable[[], Any] | None = None,
    init: bool = True,
) -> Any: ...


def field2(*, init=False, kw_only=True) -> Any: ...


def __dataclass_transform__(
    *,
    eq_default: bool = True,
    order_default: bool = False,
    kw_only_default: bool = False,
    field_specifiers: tuple[type | Callable[..., Any], ...] = (()),
) -> Callable[[T], T]:
    # If used within a stub file, the following implementation can be
    # replaced with "...".
    return lambda a: a


@__dataclass_transform__(kw_only_default=True, field_specifiers=(field1, field2))
def create_model(*, init: bool = True) -> Callable[[type[T]], type[T]]: ...


@create_model()
class CustomerModel1:
    id: int = field1(resolver=lambda: 0)
    name: str = field1(default="Voldemort")


CustomerModel1()
CustomerModel1(name="hi")

# This should generate an error because "id" is not
# supposed to be part of the init function.
CustomerModel1(id=1, name="hi")


@create_model()
class CustomerModel2:
    id: int = field2()
    name: str = field2(init=True)


# This should generate an error because kw_only is True
# by default for field2.
CustomerModel2(1)

CustomerModel2(name="Fred")
