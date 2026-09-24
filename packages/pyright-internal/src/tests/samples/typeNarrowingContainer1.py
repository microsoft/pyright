# This sample tests negative type narrowing for tuple membership checks (in / not in)
# containing instantiable class objects (type[T]).

from typing import Generic, TypeVar, final
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
