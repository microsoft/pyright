# This sample tests protocol matching where a nested check of the same
# protocol has different type arguments, including ones that grow.

from collections.abc import Iterator, Sequence
from typing import Any, Callable, Concatenate, NamedTuple, Protocol, TypeVar, overload


class ProtoA[T](Protocol):
    def f(self) -> "ProtoA[str]": ...


class ClassA[T]:
    def f(self) -> "ClassA[str]": ...


def func1(v: ClassA[int]):
    a: ProtoA[int] = v


class ProtoB[T](Protocol):
    def f(self) -> "ProtoB[list[T]]": ...
    def g(self) -> "ProtoB[set[T]]": ...
    def h(self) -> "ProtoB[tuple[T]]": ...
    def get(self) -> T: ...


class ClassB[T]:
    def f(self) -> "ClassB[list[T]]": ...
    def g(self) -> "ClassB[set[T]]": ...
    def h(self) -> "ClassB[tuple[T]]": ...
    def get(self) -> T: ...


def func2(v: ClassB[int]):
    b: ProtoB[int] = v


class ClassC[T]:
    def f(self) -> "ClassC[list[T]]": ...
    def g(self) -> "ClassC[set[T]]": ...
    def h(self) -> "ClassC[tuple[T]]": ...
    def get(self) -> int: ...


def func3(v: ClassC[int]):
    # This should generate an error.
    b: ProtoB[int] = v


class ProtoD[T](Protocol):
    def f(self) -> "ProtoD[list[T]]": ...
    def put(self, x: T) -> None: ...


class ClassD[T]:
    def f(self) -> "ClassD[list[T]]": ...
    def put(self, x: int | list[int] | list[list[int]]) -> None: ...


def func4(v: ClassD[int]):
    # This should generate an error.
    d: ProtoD[int] = v


class ProtoE[*Ts](Protocol):
    def f(self) -> "ProtoE[*Ts, int]": ...
    def g(self) -> "ProtoE[*Ts, str]": ...
    def h(self) -> "ProtoE[*Ts, bytes]": ...


class ClassE[*Ts]:
    def f(self) -> "ClassE[*Ts, int]": ...
    def g(self) -> "ClassE[*Ts, str]": ...
    def h(self) -> "ClassE[*Ts, bytes]": ...


def func5(v: ClassE[int]):
    e: ProtoE[int] = v


class ProtoF[**P](Protocol):
    def f(self) -> "ProtoF[Concatenate[int, P]]": ...
    def g(self) -> "ProtoF[Concatenate[str, P]]": ...
    def h(self) -> "ProtoF[Concatenate[bytes, P]]": ...
    def call(self) -> Callable[P, None]: ...


class ClassF[**P]:
    def f(self) -> "ClassF[Concatenate[int, P]]": ...
    def g(self) -> "ClassF[Concatenate[str, P]]": ...
    def h(self) -> "ClassF[Concatenate[bytes, P]]": ...
    def call(self) -> Callable[P, None]: ...


def func6(v: ClassF[[str]]):
    f: ProtoF[[str]] = v


class ProtoG[T](Protocol):
    def f(self) -> "ProtoG[list[T]]": ...
    def get(self) -> T: ...


class ClassG[T]:
    def f(self) -> "ClassG[list[T]]": ...
    def get(self) -> int: ...


type Three[T] = tuple[tuple[tuple[T]]]
type Deep[T] = Three[Three[Three[Three[Three[Three[T]]]]]]


def func7(v: Deep[ClassG[int]]):
    g: Deep[ProtoG[int]] = v


def func8(v: ClassG[object]):
    # This should generate an error.
    g: ProtoG[object] = v


class ProtoH[T](Protocol):
    def __len__(self, /) -> int: ...
    def __contains__(self, value: object, /) -> bool: ...
    def __getitem__(self, index: int, /) -> "T | ProtoH[T]": ...
    def __iter__(self, /) -> Iterator["T | ProtoH[T]"]: ...
    def __reversed__(self, /) -> Iterator["T | ProtoH[T]"]: ...
    def count(self, value: Any, /) -> int: ...
    def index(self, value: Any, /) -> int: ...


@overload
def func9(v: Sequence[float]) -> int: ...
@overload
def func9(v: ProtoH[float | str]) -> float: ...
def func9(v: Any) -> Any: ...


def func10(v: list[list[list[list[list[list[float]]]]]]):
    reveal_type(func9(v), expected_text="float")


# This sample tests specialization-specific protocol failures when type
# parameters have defaults.

T_co = TypeVar("T_co", covariant=True, default=Any)


class NestedSequence(Protocol[T_co]):
    def __len__(self, /) -> int: ...

    def __getitem__(self, index: int, /) -> "T_co | NestedSequence[T_co]": ...

    def __iter__(self, /) -> "Iterator[T_co | NestedSequence[T_co]]": ...


class P(NamedTuple):
    d: float
    q: float


def func11(value: NestedSequence[str] | NestedSequence[float]) -> None: ...


def func12(value: NestedSequence[float] | NestedSequence[str]) -> None: ...


func11([(1.0, 2.0)])
func11([P(1.0, 2.0)])
after_call: NestedSequence[float] = [P(1.0, 2.0)]
func11(P(1.0, 2.0))

points = [P(1.0, 2.0)]
reveal_type(points, expected_text="list[P]")
func11(points)


class Q(tuple[float, float]):
    pass


func11([Q((1.0, 2.0))])
after_subclass_call: NestedSequence[float] = [Q((1.0, 2.0))]


class Reversed(P):
    pass


func12([Reversed(1.0, 2.0)])
func11([Reversed(1.0, 2.0)])


class Prechecked(P):
    pass


before_call: NestedSequence[float] = [Prechecked(1.0, 2.0)]
func11([Prechecked(1.0, 2.0)])

# This should generate an error because object satisfies neither specialization.
func11([object()])
