# This sample tests the case where isinstance or issubclass is used to
# narrow the type of a specialized class to a subclass where the type
# arguments are implied by the type arguments of the wider class.

from typing import Any, Generic, Iterable, Literal, Sequence, Type, TypeVar, Union

_T1 = TypeVar("_T1")


class SomeClass(Generic[_T1]):
    ...


class OtherClass(SomeClass[_T1]):
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


def func3(value: Iterable[_T1]) -> Sequence[_T1] | None:
    if isinstance(value, Sequence):
        return value


_T2 = TypeVar("_T2", bound=float, covariant=True)


class Parent1(Generic[_T2]):
    pass


class Child1(Parent1[_T2]):
    pass


def func4(var: Parent1[int]):
    if isinstance(var, Child1):
        t1: Literal["Child1[int]"] = reveal_type(var)


def func5(var: Parent1[Any]):
    if isinstance(var, Child1):
        t1: Literal["Child1[Any]"] = reveal_type(var)


_T3 = TypeVar("_T3", float, str)


class Parent2(Generic[_T3]):
    pass


class Child2(Parent2[_T3]):
    pass


def func6(var: Parent2[int]):
    if isinstance(var, Child2):
        t1: Literal["Child2[int]"] = reveal_type(var)
