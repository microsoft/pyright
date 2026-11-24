# This sample tests runtime origin and lookup order for Annotated alias reads.

import annotated10 as other
from typing import Annotated, ClassVar, Generic, LiteralString, Never, NewType, TypeGuard, TypeVar


class C:
    value: ClassVar[int] = 1
    ____: ClassVar[int] = 2
    _name: ClassVar[int] = 3

    @staticmethod
    def copy_with() -> int:
        return 42


class Namespace:
    Alias = Annotated[C, "meta"]


A = Annotated[C, "meta"]
Nested = Annotated[A, "outer"]
reveal_type(Nested.value, expected_text="int")
reveal_type(Namespace.Alias.value, expected_text="int")
reveal_type(other.A.bar, expected_text="int")

Text = Annotated[LiteralString, "meta"]
Guard = Annotated[TypeGuard[C], "meta"]
ClassValue = Annotated[ClassVar[C], "meta"]
Text.upper
Guard.bit_length
ClassValue.value

Forward = Annotated[Annotated["C", "inner"], "outer"]
Reduced = Annotated[C | Never, "meta"]
Nominal = NewType("Nominal", C)
NominalAlias = Annotated[Nominal, "meta"]
Forward.value
Reduced.value
NominalAlias.value

A.copy_with()
A.____
A._name

T = TypeVar("T")


class Box(Generic[T]):
    @staticmethod
    def echo(value: T) -> T:
        return value


BoxAlias = Annotated[Box[int], "meta"]
reveal_type(BoxAlias.echo(1), expected_text="int")


class Other:
    value: ClassVar[str] = "not an int"


class Custom(Generic[T]):
    value: ClassVar[int] = 1

    @classmethod
    def __class_getitem__(cls, key: object) -> type[Other]:
        return Other


CustomAlias = Annotated[Custom[int], "meta"]
CustomAlias.value


class Descriptor:
    def __get__(self, instance: "Owner", owner: type["Owner"]) -> int:
        return 42


class Owner:
    field = Descriptor()


OwnerAlias = Annotated[Owner, "meta"]
reveal_type(Owner().field, expected_text="int")
OwnerAlias.field
OwnerAlias.missing


class ModernBox[T]:
    @staticmethod
    def echo(value: T) -> T:
        return value


ModernAlias = Annotated[ModernBox[int], "meta"]
reveal_type(ModernAlias.echo(1), expected_text="int")
