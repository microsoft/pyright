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


class ModelField:
    def __init__(
        self,
        *,
        default: Any | None = ...,
        init: bool | None = True,
        **kwargs: Any,
    ) -> None:
        ...


@overload
def field(
    *,
    default: str | None = None,
    resolver: Callable[[], Any],
    init: Literal[False] = False,
) -> Any:
    ...


@overload
def field(
    *,
    default: str | None = None,
    resolver: None = None,
    init: Literal[True] = True,
) -> Any:
    ...


def field(
    *,
    default: str | None = None,
    resolver: Callable[[], Any] | None = None,
    init: bool = True,
) -> Any:
    ...


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


@__dataclass_transform__(kw_only_default=True, field_specifiers=(field,))
def create_model(*, init: bool = True) -> Callable[[type[T]], type[T]]:
    ...


@create_model()
class CustomerModel:
    id: int = field(resolver=lambda: 0)
    name: str = field(default="Voldemort")


CustomerModel()
CustomerModel(name="hi")

# This should generate an error because "id" is not
# supposed to be part of the init function.
CustomerModel(id=1, name="hi")
