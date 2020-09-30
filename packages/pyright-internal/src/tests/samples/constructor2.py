# This sample tests bidirectional type inference when the RHS
# is a call to a constructor.

from typing import (
    Any,
    Dict,
    Generic,
    Iterable,
    List,
    Literal,
    Optional,
    Protocol,
    TypeVar,
    Union,
)


_T1 = TypeVar("_T1")
_T2 = TypeVar("_T2")
_T3 = TypeVar("_T3")


class Animal(Generic[_T1, _T2]):
    pass


class Bear(Animal[_T3, int]):
    def __init__(self, p1: Optional[_T3] = None):
        pass


class Donkey(Animal[int, int], Generic[_T3]):
    pass


class Flyer(Protocol[_T1]):
    def get_wingspan(self, p1: _T1) -> float:
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
    t2: Literal["List[str]"] = reveal_type(b)
    c: Iterable[str] = list()
    t3: Literal["list[str]"] = reveal_type(c)


def s11():
    a: Animal[Any, Any] = Donkey[int]()
    t: Literal["Donkey[int]"] = reveal_type(a)


def s12(p: Bear[_T1]):
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
    t: Literal["Bear[int]"] = reveal_type(a)

