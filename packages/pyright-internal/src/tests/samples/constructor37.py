# This sample tests that recursive constructor annotations do not cause
# unbounded recursion when validating a constructor call.

from typing import Generic, TypedDict, TypeVar


class RecursiveInit:
    __init__: type["RecursiveInit"]


reveal_type(RecursiveInit(), expected_text="RecursiveInit")


class RecursiveNew:
    __new__: type["RecursiveNew"]


RecursiveNew()


class Meta(type):
    # This should generate an error: __call__ is incompatible with type.__call__.
    __call__: type["RecursiveCall"]


class RecursiveCall(metaclass=Meta): ...


RecursiveCall()


class First:
    __new__: type["Second"]


class Second:
    __new__: type[First]


First()


# Nonrecursive class-valued constructor methods must still be evaluated.
class Other:
    def __init__(self, value: int): ...


class Nonrecursive:
    __init__: type[Other]


reveal_type(Nonrecursive(1), expected_text="Nonrecursive")
# This should generate an error: the nonrecursive constructor requires an int.
Nonrecursive("bad")


# A nested call at a different expression must not be mistaken for a cycle.
class Nested:
    def __init__(self, value: "Nested | None" = None): ...


reveal_type(Nested(Nested()), expected_text="Nested")


class GenericCycle[T]:
    __init__: type["GenericCycle[T]"]


reveal_type(GenericCycle[int](), expected_text="GenericCycle[int]")


# Specializations can grow on every recursive constructor call.
class Growing[T]:
    __new__: type["Growing[list[T]]"]


Growing[int]()


# Finite specializations of the same generic class must reach their target.
class Chain[T]:
    __new__: T


reveal_type(Chain[type[int]]("12"), expected_text="int")
reveal_type(Chain[type[Chain[type[int]]]]("12"), expected_text="int")
Chain[type[Chain[type[int]]]]("12").bit_length()


class InitChain[T]:
    __init__: T


reveal_type(InitChain[type[InitChain[type[Other]]]](1), expected_text="InitChain[type[InitChain[type[Other]]]]")
# This should generate an error: the nested target requires an int.
InitChain[type[InitChain[type[Other]]]]("bad")
# This should generate an error: __new__ must validate the nested target too.
Chain[type[Chain[type[Other]]]]("bad")


class Derived[T](Chain[T]): ...


reveal_type(Derived[type[Chain[type[Other]]]](1), expected_text="Other")


class InitDerived[T](InitChain[T]): ...


# This should generate an error: inherited hooks validate the final target.
InitDerived[type[InitChain[type[Other]]]]("bad")


# Both orders of a union must preserve the final constructor result.
def forward(cls: type[Chain[type[Chain[type[Other]]]]] | type[Other]):
    reveal_type(cls(1), expected_text="Other")


def reverse(cls: type[Other] | type[Chain[type[Chain[type[Other]]]]]):
    reveal_type(cls(1), expected_text="Other")


Alias = Chain[type[Chain[type[int]]]]
reveal_type(Alias("12"), expected_text="int")


class Call:
    __call__: type[Chain[type[Chain[type[int]]]]]


reveal_type(Call()("12"), expected_text="int")


# A deep finite chain below the recursion limit must also reach its target.
Deep = Chain[type[Chain[type[Chain[type[Chain[type[Chain[type[Chain[type[Chain[type[Chain[type[Chain[type[Chain[type[int]]]]]]]]]]]]]]]]]]]]
reveal_type(Deep("12"), expected_text="int")


# Legacy generic syntax follows the same specialization path.
U = TypeVar("U")


class Legacy(Generic[U]):
    __new__: U


reveal_type(Legacy[type[Legacy[type[str]]]](12), expected_text="str")


# Invalid calls must retain diagnostics for all argument forms.
# This should generate an error: the inherited __new__ target requires an int.
Derived[type[Chain[type[Other]]]]("bad")
# This should generate an error: named arguments reach the nested target.
InitChain[type[InitChain[type[Other]]]](value="bad")
# This should generate an error: unpacked positional arguments reach the target.
InitChain[type[InitChain[type[Other]]]](*("bad",))


class Args(TypedDict):
    value: str


def mapping(args: Args):
    # This should generate an error: unpacked keyword arguments reach the target.
    InitChain[type[InitChain[type[Other]]]](**args)


# A nested same-generic argument is not evidence of progress when it grows.
class NestedGrowing[T]:
    __new__: type["NestedGrowing[type[NestedGrowing[T]]]"]


NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[type[NestedGrowing[int]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]()
