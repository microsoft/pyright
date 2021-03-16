# This sample tests bidirectional type inference when the RHS
# is a call to a constructor.

from typing import (
    Any,
    Dict,
    Generic,
    Iterable,
    List,
    Literal,
    Mapping,
    Optional,
    Protocol,
    TypeVar,
    Union,
)


_T1 = TypeVar("_T1")
_T1_contra = TypeVar("_T1_contra", contravariant=True)
_T2 = TypeVar("_T2")
_T3 = TypeVar("_T3")


class Animal(Generic[_T1, _T2]):
    pass


class Bear(Animal[_T3, int]):
    def __init__(self, p1: Optional[_T3] = None):
        pass


class Donkey(Animal[int, int], Generic[_T3]):
    pass


class Flyer(Protocol[_T1_contra]):
    def get_wingspan(self, p1: _T1_contra) -> float:
        raise NotImplemented


class CaveDweller(Generic[_T1]):
    pass


class Bat(Animal[int, int], CaveDweller[int]):
    def get_wingspan(self, p1: int) -> float:
        raise NotImplemented


def s1():
    b: Bear[str] = Bear()
    a: Animal[str, int] = b
    t: Literal["Bear[str]"] = reveal_type(a)


def s2():
    a: Animal[str, int] = Bear()
    t: Literal["Bear[str]"] = reveal_type(a)


def s3():
    a: Animal[str, int] = Bear()
    t: Literal["Bear[str]"] = reveal_type(a)


def s4():
    a: Bear[Any] = Bear[int]()
    t: Literal["Bear[Any]"] = reveal_type(a)


def s5():
    a: Animal[Any, Any] = Bear[int]()
    t: Literal["Bear[Any]"] = reveal_type(a)


def s6():
    a: Union[Bat, Bear[str]] = Bear()
    t: Literal["Bear[str]"] = reveal_type(a)


def s7(p: Union[Bat, Bear[int]]):
    a: Animal[int, int] = p
    t: Literal["Bat | Bear[int]"] = reveal_type(a)


def s8():
    a: Animal[int, int] = Bear[int]()
    t: Literal["Bear[int]"] = reveal_type(a)


def s9(p: Dict[str, str]):
    a: Dict[str, Any] = p
    t: Literal["Dict[str, Any]"] = reveal_type(a)


def s10(p: List[str]):
    a: Iterable[Any] = p
    t1: Literal["List[Any]"] = reveal_type(a)
    b: Iterable[str] = []
    t2: Literal["list[str]"] = reveal_type(b)
    c: Iterable[str] = list()
    t3: Literal["list[str]"] = reveal_type(c)


def s11():
    a: Animal[Any, Any] = Donkey[int]()
    t: Literal["Donkey[int]"] = reveal_type(a)


def s12(p: Bear[_T1], b: _T1):
    a: Animal[Any, int] = p
    t: Literal["Bear[Any]"] = reveal_type(a)


def s13(p: Bat):
    a: Flyer[int] = p
    t: Literal["Bat"] = reveal_type(a)


def s14(p: Bat):
    a: CaveDweller[int] = p
    t: Literal["Bat"] = reveal_type(a)


def s15():
    a = Bear(1)
    t1: Literal["Bear[int]"] = reveal_type(a)
    b = Bear[int](1)
    t2: Literal["Bear[int]"] = reveal_type(b)
    c = Bear[float](1)
    t3: Literal["Bear[float]"] = reveal_type(c)
    d = Bear[Union[str, int]](1)
    t4: Literal["Bear[str | int]"] = reveal_type(d)


def s16():
    a: Any = Bear(1)
    t: Literal["Any"] = reveal_type(a)


def s17():
    a1: Iterable[object] = [2, 3, 4]
    ta1: Literal["list[int]"] = reveal_type(a1)

    a2: List[object] = [2, 3, 4]
    ta2: Literal["list[object]"] = reveal_type(a2)

    b1: Iterable[float] = [2, 3, 4]
    tb1: Literal["list[int]"] = reveal_type(b1)

    b2: List[float] = [2, 3, 4]
    tb2: Literal["list[float]"] = reveal_type(b2)

    c1: Iterable[Literal["A", "B", "C"]] = ["A", "B"]
    tc1: Literal["list[Literal['A', 'B']]"] = reveal_type(c1)

    c2: List[Literal["A", "B", "C"]] = ["A", "B"]
    tc2: Literal["list[Literal['A', 'B', 'C']]"] = reveal_type(c2)


def s18():
    a1: Mapping[object, object] = {"a": 3, "b": 5.6}
    ta1: Literal["dict[object, float]"] = reveal_type(a1)

    a2: Dict[object, object] = {"a": 3, "b": 5.6}
    ta2: Literal["dict[object, object]"] = reveal_type(a2)

    b1: Mapping[str, float] = {"a": 3, "b": 5}
    tb1: Literal["dict[str, int]"] = reveal_type(b1)

    b2: Dict[str, float] = {"a": 3, "b": 5}
    tb2: Literal["dict[str, float]"] = reveal_type(b2)

    c1: Mapping[Literal["A", "B"], Literal[3, 4]] = {"A": 3}
    tc1: Literal["dict[Literal['A', 'B'], Literal[3]]"] = reveal_type(c1)

    c2: Dict[Literal["A", "B"], Literal[3, 4]] = {"A": 3}
    tc2: Literal["dict[Literal['A', 'B'], Literal[3, 4]]"] = reveal_type(c2)
