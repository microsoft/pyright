# This sample tests negative type narrowing for tuple membership checks (in / not in)
# containing instantiable class objects (type[T]).

from enum import Enum
from types import GenericAlias
from typing import Generic, Literal, TypeVar, final
from typing_extensions import assert_type

@final
class FinalClassA: pass

@final
class FinalClassB: pass

class ClassC: pass

class NonFinalClassA: pass
class SubA(NonFinalClassA): pass


def test_in_final_class_tuple(x: type[FinalClassA] | type[FinalClassB] | type[ClassC]):
    if x in (FinalClassA, FinalClassB):
        assert_type(x, type[FinalClassA] | type[FinalClassB])
    else:
        assert_type(x, type[ClassC])

def test_not_in_final_class_tuple(x: type[FinalClassA] | type[FinalClassB] | type[ClassC]):
    if x not in (FinalClassA, FinalClassB):
        assert_type(x, type[ClassC])
    else:
        assert_type(x, type[FinalClassA] | type[FinalClassB])

def test_not_in_non_final_class_tuple(x: type[NonFinalClassA] | type[ClassC]):
    if x not in (NonFinalClassA,):
        # SubA is a subclass of NonFinalClassA. At runtime, SubA in (NonFinalClassA,)
        # evaluates to False, so SubA reaches this negative branch. Therefore,
        # type[NonFinalClassA] must not be eliminated when NonFinalClassA is not final.
        assert_type(x, type[NonFinalClassA] | type[ClassC])
    else:
        assert_type(x, type[NonFinalClassA])


T = TypeVar("T")


@final
class FinalBox(Generic[T]): pass


def test_not_in_specialized_generic_final_class(x: type[FinalBox[int]]):
    if x not in (FinalBox[int],):
        # FinalBox and FinalBox[int] are distinct runtime objects, so
        # the negative branch must not be eliminated.
        assert_type(x, type[FinalBox[int]])


TConstrained = TypeVar("TConstrained", FinalClassA, ClassC)


def test_not_in_constrained_typevar(x: type[TConstrained]) -> type[TConstrained]:
    assert x not in (FinalClassA,)
    assert_type(x, type[TConstrained])
    return x


@final
class FinalClassGetItem:
    def __class_getitem__(cls, item: object) -> GenericAlias:
        return GenericAlias(cls, item)


def test_not_in_custom_class_getitem(x: type[FinalClassGetItem] | type[ClassC]):
    if x not in (FinalClassGetItem[int],):
        # FinalClassGetItem[int] is a GenericAlias rather than the class
        # object, so type[FinalClassGetItem] must not be eliminated.
        assert_type(x, type[FinalClassGetItem] | type[ClassC])


@final
class FinalIntList(list[int]): pass


def test_not_in_inherited_class_getitem(x: type[FinalIntList] | type[ClassC]):
    if x not in (FinalIntList[()],):
        assert_type(x, type[FinalIntList] | type[ClassC])


def test_in_inherited_class_getitem(x: type[FinalIntList] | type[ClassC]):
    if x in (FinalIntList[()],):
        pass
    else:
        assert_type(x, type[FinalIntList] | type[ClassC])


def test_not_in_unsubscripted_class_getitem(x: type[FinalIntList] | type[ClassC]):
    if x not in (FinalIntList,):
        # Subscription-capable classes are conservatively excluded even when bare.
        assert_type(x, type[FinalIntList] | type[ClassC])


class IntListBase(list[int]): pass


@final
class FinalIndirectIntList(IntListBase): pass


def test_not_in_indirect_class_getitem(x: type[FinalIndirectIntList] | type[ClassC]):
    if x not in (FinalIndirectIntList[()],):
        assert_type(x, type[FinalIndirectIntList] | type[ClassC])


class ContainerEnum(Enum):
    A = 1
    B = 2
    C = 3


def test_not_in_class_tuple_with_enum(x: type[FinalClassA] | ContainerEnum):
    if x not in (FinalClassA,):
        reveal_type(x, expected_text="ContainerEnum")


def test_not_in_class_tuple_with_bool(x: type[FinalClassA] | bool):
    if x not in (FinalClassA,):
        assert_type(x, bool)


def test_not_in_mixed_class_enum_tuple(x: type[FinalClassA] | ContainerEnum | None):
    if x not in (FinalClassA, ContainerEnum.A, None):
        assert_type(x, Literal[ContainerEnum.B, ContainerEnum.C])


def test_not_in_mixed_class_bool_tuple(x: type[FinalClassA] | bool | None):
    if x not in (FinalClassA, True, None):
        assert_type(x, Literal[False])
