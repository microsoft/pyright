# This sample tests special forms that are not compatible with type[T],
# type[object] or type[Any].

from typing import (
    Annotated,
    Any,
    Callable,
    ClassVar,
    Concatenate,
    Final,
    Generic,
    Literal,
    LiteralString,
    NotRequired,
    Optional,
    Protocol,
    Required,
    Self,
    TypeAlias,
    TypeGuard,
    Union,
    Unpack,
)
from typing_extensions import ReadOnly  # pyright: ignore[reportMissingModuleSource]

# The following should all generate an error.
Literal()
Literal[0]()
ClassVar()
Unpack()
Required()
NotRequired()
Protocol()
Generic()
Final()
Callable()
Callable[..., Any]()
Union()
Optional()
LiteralString()
Self()
Concatenate()
TypeAlias()
TypeGuard()
Annotated()
ReadOnly()
Union[int, str]()
(int | str)()
