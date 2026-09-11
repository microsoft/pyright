# This sample tests a constrained TypeVar that includes Never as one of its
# constraints.

from typing import Any, Callable, Generic, Never, NoReturn, TypeAlias, TypeVar, assert_type

T1 = TypeVar("T1", int, Never)
T2 = TypeVar("T2", Never, int)
T3 = TypeVar("T3", str, Never, int)
T4 = TypeVar("T4", int, str)


class ClassA(Generic[T1]):
    pass


class ClassB(Generic[T2]):
    pass


class ClassC(Generic[T3]):
    pass


class ClassD[T5: (int, Never)]:
    pass


def func1(value: ClassA[T1]) -> T1:
    raise NotImplementedError


def func2(value: ClassB[T2]) -> T2:
    raise NotImplementedError


def func3(value: ClassC[T3]) -> T3:
    raise NotImplementedError


def func4(value: tuple[ClassA[T1], ...]) -> T1:
    raise NotImplementedError


def func5(value1: ClassA[T1], value2: ClassA[T1]) -> T1:
    raise NotImplementedError


def func6(value: T1) -> T1:
    raise NotImplementedError


def func7(value: Callable[[T1], None]) -> T1:
    raise NotImplementedError


def func8(value: T4) -> T4:
    raise NotImplementedError


def func9[T5: (int, Never)](value: ClassD[T5]) -> T5:
    raise NotImplementedError


def accepts_never(value: Never) -> None:
    pass


def get_never() -> Never:
    raise NotImplementedError


assert_type(func1(ClassA[Never]()), Never)
assert_type(func2(ClassB[Never]()), Never)
assert_type(func3(ClassC[Never]()), Never)
assert_type(func9(ClassD[Never]()), Never)
assert_type(func4((ClassA[Never](),)), Never)
assert_type(func5(ClassA[Never](), ClassA[Never]()), Never)

Bottom: TypeAlias = Never
assert_type(func1(ClassA[Bottom]()), Never)
assert_type(func1(ClassA[NoReturn]()), Never)

# Never is compatible with the int solution because it is the bottom type.
assert_type(func5(ClassA[Never](), ClassA[int]()), int)
assert_type(func5(ClassA[int](), ClassA[Never]()), int)

assert_type(func7(accepts_never), Never)

any_value: Any = 1
assert_type(func6(any_value), Any)

# This should generate an error because str doesn't satisfy any constraint.
func6("not compatible")

# Preserve the existing behavior when Never is not an explicit constraint.
assert_type(func8(get_never()), int)
