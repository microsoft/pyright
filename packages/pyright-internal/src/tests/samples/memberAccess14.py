# This sample tests the use of a generic descriptor class that
# is parameterized based on the type of the object that instantiates
# the descriptor.


from typing import Any, Callable, Generic, Literal, TypeVar, Union, overload

T = TypeVar("T")
T_contra = TypeVar("T_contra", contravariant=True)
V_co = TypeVar("V_co", covariant=True)
CachedSlotPropertyT = TypeVar(
    "CachedSlotPropertyT", bound="CachedSlotProperty[Any, Any]"
)


class CachedSlotProperty(Generic[T_contra, V_co]):
    def __init__(self, name: str, function: Callable[[T_contra], V_co]) -> None:
        ...

    @overload
    def __get__(
        self: CachedSlotPropertyT, instance: None, owner: type[T_contra]
    ) -> CachedSlotPropertyT:
        ...

    @overload
    def __get__(self, instance: T_contra, owner: Any) -> V_co:
        ...

    def __get__(
        self: CachedSlotPropertyT, instance: Union[T_contra, None], owner: Any
    ) -> Union[CachedSlotPropertyT, V_co]:
        ...


def cached_slot_property(
    name: str,
) -> Callable[[Callable[[T_contra], V_co]], CachedSlotProperty[T_contra, V_co]]:
    ...


class C(Generic[T]):
    def __init__(self, data: T) -> None:
        ...

    @cached_slot_property("_prop")
    def prop(self) -> int:
        ...


class D(C[float]):
    ...


t1: Literal["CachedSlotProperty[C[T@C], int]"] = reveal_type(C.prop)
t2: Literal["CachedSlotProperty[C[float], int]"] = reveal_type(D.prop)


c = C("")
t3: Literal["int"] = reveal_type(c.prop)

d = D(1)
t4: Literal["int"] = reveal_type(d.prop)
