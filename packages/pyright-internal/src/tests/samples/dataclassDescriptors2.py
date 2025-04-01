# This sample tests the handling of fields within a dataclass that
# are descriptors.

from dataclasses import dataclass

from typing import overload, Any, TypeVar, Generic, Optional, Union, Callable, Type
from typing_extensions import (  # pyright: ignore[reportMissingModuleSource]
    dataclass_transform,
)


_T = TypeVar("_T")


class A(Generic[_T]): ...


class Desc(Generic[_T]):
    @overload
    def __get__(self, instance: None, owner: Any) -> A[_T]: ...

    @overload
    def __get__(self, instance: object, owner: Any) -> _T: ...

    def __get__(self, instance: Optional[object], owner: Any) -> Union[A[_T], _T]: ...


@dataclass_transform(field_specifiers=(Desc[Any],))
def dataclass_like(
    *,
    init: bool = True,
    repr: bool = True,  # noqa: A002
    eq: bool = True,
    order: bool = False,
    unsafe_hash: bool = False,
) -> Callable[[Type[_T]], Type[_T]]: ...


@dataclass_like()
class B:
    x: Desc[int]
    y: Desc[str]
    z: Desc[str] = Desc()


@dataclass
class C:
    x: Desc[int]
    y: Desc[str]
    z: Desc[str] = Desc()


reveal_type(B.x, expected_text="A[int]")
reveal_type(B.y, expected_text="A[str]")
reveal_type(B.z, expected_text="A[str]")
reveal_type(C.x, expected_text="A[int]")
reveal_type(C.y, expected_text="A[str]")
reveal_type(C.z, expected_text="A[str]")

b = B(Desc(), Desc(), Desc())
reveal_type(b.x, expected_text="int")
reveal_type(b.y, expected_text="str")
reveal_type(b.z, expected_text="str")

c = C(Desc(), Desc(), Desc())
reveal_type(c.x, expected_text="int")
reveal_type(c.y, expected_text="str")
reveal_type(c.z, expected_text="str")
