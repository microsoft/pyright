# This sample tests the case where isinstance or issubclass is used to
# narrow the type of a specialized class to a subclass where the type
# arguments are implied by the type arguments of the wider class.

from typing import Generic, Literal, Type, TypeVar, Union

T = TypeVar("T")


class SomeClass(Generic[T]):
    ...


class OtherClass(SomeClass[T]):
    ...


def func1(a: SomeClass[int], b: Union[SomeClass[str], SomeClass[complex]]) -> None:
    if isinstance(a, OtherClass):
        t1: Literal["OtherClass[int]"] = reveal_type(a)

    if isinstance(b, OtherClass):
        t2: Literal["OtherClass[str] | OtherClass[complex]"] = reveal_type(b)


def func2(
    a: Type[SomeClass[int]], b: Union[Type[SomeClass[str]], Type[SomeClass[complex]]]
) -> None:
    if issubclass(a, OtherClass):
        t1: Literal["Type[OtherClass[int]]"] = reveal_type(a)

    if issubclass(b, OtherClass):
        t2: Literal["Type[OtherClass[str]] | Type[OtherClass[complex]]"] = reveal_type(
            b
        )
