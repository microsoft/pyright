# This sample tests the mechanism defined in PEP 746 for validating
# the consistency of Annotated metadata with its corresponding type.

from typing import Annotated, Any, Callable, Literal, Protocol, overload


class SupportsGt[T](Protocol):
    def __gt__(self, __other: T) -> bool: ...


class Gt[T]:
    def __init__(self, value: T) -> None:
        self.value = value

    def __supports_type__(self, obj: SupportsGt[T]) -> bool:
        return obj > self.value


x1: Annotated[int, Gt(0)] = 1

# This should generate an error because int is not compatible with str.
x2: Annotated[str, Gt(0)] = ""

x3: Annotated[int, Gt(1)] = 0


class MetaString:
    @classmethod
    def __supports_type__(cls, obj: str) -> bool:
        return isinstance(obj, str)


s1: Annotated[str, MetaString] = ""

# This should generate an error because int is not compatible with str.
s2: Annotated[int, MetaString] = 1


class ParentA: ...


class ChildA(ParentA): ...


class MetaA:
    def __supports_type__(self, obj: ParentA) -> bool:
        return isinstance(ParentA, str)


a1: Annotated[ParentA, 1, "", MetaA()] = ParentA()
a2: Annotated[ChildA, MetaA(), 1, ""] = ChildA()

# This should generate an error.
a3: Annotated[int, 1, "", MetaA(), ""] = 1


class MetaInt:
    __supports_type__: Callable[[int], bool]


i1: Annotated[int, MetaInt()] = 1

# This should generate an error.
i2: Annotated[float, MetaInt()] = 1.0


class MetaWithOverload:
    @overload
    def __supports_type__(self, obj: int, /) -> bool: ...
    @overload
    def __supports_type__(self, obj: None, /) -> Literal[True]: ...
    @overload
    def __supports_type__(self, obj: str, /) -> Literal[False]: ...
    def __supports_type__(self, obj: Any, /) -> bool: ...


v1: Annotated[int, MetaWithOverload()] = 1
v2: Annotated[None, MetaWithOverload()] = None

# This should generate an error.
v3: Annotated[str, MetaWithOverload()] = ""

# This should generate an error.
v4: Annotated[complex, MetaWithOverload()] = 3j
