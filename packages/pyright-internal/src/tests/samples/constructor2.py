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
    reveal_type(a, expected_text="Bear[str]")


def s2():
    a: Animal[str, int] = Bear()
    reveal_type(a, expected_text="Bear[str]")


def s3():
    a: Animal[str, int] = Bear()
    reveal_type(a, expected_text="Bear[str]")


def s4():
    a: Bear[Any] = Bear[int]()
    reveal_type(a, expected_text="Bear[Any]")


def s5():
    a: Animal[Any, Any] = Bear[int]()
    reveal_type(a, expected_text="Bear[Any]")


def s6():
    a: Union[Bat, Bear[str]] = Bear()
    reveal_type(a, expected_text="Bear[str]")


def s7(p: Union[Bat, Bear[int]]):
    a: Animal[int, int] = p
    reveal_type(a, expected_text="Bat | Bear[int]")


def s8():
    a: Animal[int, int] = Bear[int]()
    reveal_type(a, expected_text="Bear[int]")


def s9(p: Dict[str, str]):
    a: Dict[str, Any] = p
    reveal_type(a, expected_text="Dict[str, Any]")


def s10(p: List[str]):
    a: Iterable[Any] = p
    reveal_type(a, expected_text="List[Any]")
    b: Iterable[str] = []
    reveal_type(b, expected_text="list[str]")
    c: Iterable[str] = list()
    reveal_type(c, expected_text="list[str]")


def s11():
    a: Animal[Any, Any] = Donkey[int]()
    reveal_type(a, expected_text="Donkey[int]")


def s12(p: Bear[_T1], b: _T1):
    a: Animal[Any, int] = p
    reveal_type(a, expected_text="Bear[Any]")


def s13(p: Bat):
    a: Flyer[int] = p
    reveal_type(a, expected_text="Bat")


def s14(p: Bat):
    a: CaveDweller[int] = p
    reveal_type(a, expected_text="Bat")


def s15():
    a = Bear(1)
    reveal_type(a, expected_text="Bear[int]")
    b = Bear[int](1)
    reveal_type(b, expected_text="Bear[int]")
    c = Bear[float](1)
    reveal_type(c, expected_text="Bear[float]")
    d = Bear[Union[str, int]](1)
    reveal_type(d, expected_text="Bear[str | int]")


def s16():
    a: Any = Bear(1)
    reveal_type(a, expected_text="Any")


def s17():
    a1: Iterable[object] = [2, 3, 4]
    reveal_type(a1, expected_text="list[int]")

    a2: List[object] = [2, 3, 4]
    reveal_type(a2, expected_text="list[object]")

    b1: Iterable[float] = [2, 3, 4]
    reveal_type(b1, expected_text="list[int]")

    b2: List[float] = [2, 3, 4]
    reveal_type(b2, expected_text="list[float]")

    c1: Iterable[Literal["A", "B", "C"]] = ["A", "B"]
    reveal_type(c1, expected_text="list[Literal['A', 'B']]")

    c2: List[Literal["A", "B", "C"]] = ["A", "B"]
    reveal_type(c2, expected_text="list[Literal['A', 'B', 'C']]")


def s18():
    a1: Mapping[object, object] = {"a": 3, "b": 5.6}
    reveal_type(a1, expected_text="dict[object, float]")

    a2: Dict[object, object] = {"a": 3, "b": 5.6}
    reveal_type(a2, expected_text="dict[object, object]")

    b1: Mapping[str, float] = {"a": 3, "b": 5}
    reveal_type(b1, expected_text="dict[str, int]")

    b2: Dict[str, float] = {"a": 3, "b": 5}
    reveal_type(b2, expected_text="dict[str, float]")

    c1: Mapping[Literal["A", "B"], Literal[3, 4]] = {"A": 3}
    reveal_type(c1, expected_text="dict[Literal['A', 'B'], Literal[3]]")

    c2: Dict[Literal["A", "B"], Literal[3, 4]] = {"A": 3}
    reveal_type(c2, expected_text="dict[Literal['A', 'B'], Literal[3, 4]]")
