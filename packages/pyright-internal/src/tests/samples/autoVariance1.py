# This sample tests variance inference for type variables that use
# autovariance.

from typing import Iterator, Sequence


class ShouldBeCovariant1[T]:
    def __getitem__(self, index: int) -> T: ...
    def __iter__(self) -> Iterator[T]: ...


vco1_1: ShouldBeCovariant1[float] = ShouldBeCovariant1[int]()

# This should generate an error based on variance
vco1_2: ShouldBeCovariant1[int] = ShouldBeCovariant1[float]()


class ShouldBeCovariant2[T](Sequence[T]):
    pass

vco2_1: ShouldBeCovariant2[float] = ShouldBeCovariant2[int]()

# This should generate an error based on variance
vco2_2: ShouldBeCovariant2[int] = ShouldBeCovariant2[float]()


class ShouldBeCovariant3[T]:
    def method1(self) -> "ShouldBeCovariant2[T]":
        ...
 

vco3_1: ShouldBeCovariant3[float] = ShouldBeCovariant3[int]()


class ShouldBeInvariant1[T]:
    def __init__(self, value: T) -> None:
        self._value = value

    @property
    def value(self):
        return self._value

    @value.setter
    def value(self, value: T):
        self._value = value

# This should generate an error based on variance
vinv1_1: ShouldBeInvariant1[float] = ShouldBeInvariant1[int](1)

# This should generate an error based on variance
vinv1_2: ShouldBeInvariant1[int] = ShouldBeInvariant1[float](1.1)


class ShouldBeInvariant2[T]:
    def __init__(self, value: T) -> None:
        self._value = value

    def get_value(self) ->T:
        return self._value

    def set_value(self, value: T):
        self._value = value

# This should generate an error based on variance
vinv2_1: ShouldBeInvariant2[float] = ShouldBeInvariant2[int](1)

# This should generate an error based on variance
vinv2_2: ShouldBeInvariant2[int] = ShouldBeInvariant2[float](1.1)


class ShouldBeInvariant3[K, V](dict[K, V]):
    pass

# This should generate an error based on variance
vinv3_1: ShouldBeInvariant3[float, str] = ShouldBeInvariant3[int, str]()

# This should generate an error based on variance
vinv3_2: ShouldBeInvariant3[int, str] = ShouldBeInvariant3[float, str]()

# This should generate an error based on variance
vinv3_3: ShouldBeInvariant3[str, float] = ShouldBeInvariant3[str, int]()

# This should generate an error based on variance
vinv3_4: ShouldBeInvariant3[str, int] = ShouldBeInvariant3[str, float]()


class ShouldBeContravariant1[T]:
    def __init__(self, value: T) -> None:
        self._value = value
    
    def set_value(self, value: T) -> None:
        self._value = value


# This should generate an error based on variance
vcontra1_1: ShouldBeContravariant1[float] = ShouldBeContravariant1[int](1)

vcontra1_2: ShouldBeContravariant1[int] = ShouldBeContravariant1[float](1.2)
