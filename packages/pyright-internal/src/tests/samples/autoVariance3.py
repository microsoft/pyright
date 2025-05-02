# This sample tests variance inference for traditional type variables.

from typing import Generic, Iterator, Sequence, overload
from typing_extensions import TypeVar  # pyright: ignore[reportMissingModuleSource]
from dataclasses import dataclass

T = TypeVar("T", infer_variance=True)
K = TypeVar("K", infer_variance=True)
V = TypeVar("V", infer_variance=True)

# This should generate an error because covariant cannot be used
# with infer_variance.
S1 = TypeVar("S1", covariant=True, infer_variance=True)

# This should generate an error because contravariant cannot be used
# with infer_variance.
S2 = TypeVar("S2", contravariant=True, infer_variance=True)


class ShouldBeCovariant1(Generic[T]):
    def __getitem__(self, index: int) -> T: ...

    def __iter__(self) -> Iterator[T]: ...


vco1_1: ShouldBeCovariant1[float] = ShouldBeCovariant1[int]()

# This should generate an error based on variance.
vco1_2: ShouldBeCovariant1[int] = ShouldBeCovariant1[float]()


class ShouldBeCovariant2(Sequence[T]):
    def __len__(self) -> int: ...
    @overload
    def __getitem__(self, index: int) -> T: ...
    @overload
    def __getitem__(self, index: slice) -> Sequence[T]: ...
    def __getitem__(self, index: int | slice) -> T | Sequence[T]: ...


vco2_1: ShouldBeCovariant2[float] = ShouldBeCovariant2[int]()
# This should generate an error based on variance.
vco2_2: ShouldBeCovariant2[int] = ShouldBeCovariant2[float]()


class ShouldBeCovariant3(Generic[T]):
    def method1(self) -> "ShouldBeCovariant2[T]": ...


vco3_1: ShouldBeCovariant3[float] = ShouldBeCovariant3[int]()
# This should generate an error based on variance.
vco3_2: ShouldBeCovariant3[int] = ShouldBeCovariant3[float]()


@dataclass(frozen=True)
class ShouldBeCovariant4(Generic[T]):
    x: T


vo4_1: ShouldBeCovariant4[float] = ShouldBeCovariant4[int](1)
# This should generate an error based on variance.
vo4_4: ShouldBeCovariant4[int] = ShouldBeCovariant4[float](1.0)


class ShouldBeCovariant5(Generic[T]):
    def __init__(self, x: T) -> None:
        self._x = x

    @property
    def x(self) -> T:
        return self._x


vo5_1: ShouldBeCovariant5[float] = ShouldBeCovariant5[int](1)
# This should generate an error based on variance.
vo5_2: ShouldBeCovariant5[int] = ShouldBeCovariant5[float](1.0)


class ShouldBeInvariant1(Generic[T]):
    def __init__(self, value: T) -> None:
        self._value = value

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, value: T):
        self._value = value


# This should generate an error based on variance.
vinv1_1: ShouldBeInvariant1[float] = ShouldBeInvariant1[int](1)

# This should generate an error based on variance.
vinv1_2: ShouldBeInvariant1[int] = ShouldBeInvariant1[float](1.1)


class ShouldBeInvariant2(Generic[T]):
    def __init__(self, value: T) -> None:
        self._value = value

    def get_value(self) -> T:
        return self._value

    def set_value(self, value: T):
        self._value = value


# This should generate an error based on variance.
vinv2_1: ShouldBeInvariant2[float] = ShouldBeInvariant2[int](1)

# This should generate an error based on variance.
vinv2_2: ShouldBeInvariant2[int] = ShouldBeInvariant2[float](1.1)


class ShouldBeInvariant3(dict[K, V]):
    pass


# This should generate an error based on variance.
vinv3_1: ShouldBeInvariant3[float, str] = ShouldBeInvariant3[int, str]()

# This should generate an error based on variance.
vinv3_2: ShouldBeInvariant3[int, str] = ShouldBeInvariant3[float, str]()

# This should generate an error based on variance.
vinv3_3: ShouldBeInvariant3[str, float] = ShouldBeInvariant3[str, int]()

# This should generate an error based on variance.
vinv3_4: ShouldBeInvariant3[str, int] = ShouldBeInvariant3[str, float]()


@dataclass
class ShouldBeInvariant4[T]:
    x: T


# This should generate an error based on variance.
vinv4_1: ShouldBeInvariant4[float] = ShouldBeInvariant4[int](1)


class ShouldBeInvariant5[T]:
    def __init__(self, x: T) -> None:
        self.x = x


# This should generate an error based on variance.
vinv5_1: ShouldBeInvariant5[float] = ShouldBeInvariant5[int](1)


class ShouldBeContravariant1(Generic[T]):
    def __init__(self, value: T) -> None:
        pass

    def set_value(self, value: T):
        pass


# This should generate an error based on variance.
vcontra1_1: ShouldBeContravariant1[float] = ShouldBeContravariant1[int](1)

vcontra1_2: ShouldBeContravariant1[int] = ShouldBeContravariant1[float](1.2)
