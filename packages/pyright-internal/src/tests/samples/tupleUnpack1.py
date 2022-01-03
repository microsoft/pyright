# This sample tests the handling of Unpack[Tuple[...]] as described
# in PEP 646.

from typing import Literal, Tuple, Union
from typing_extensions import Unpack


def func1(v1: Tuple[int, Unpack[Tuple[bool, bool]], str]):
    t1: Literal["Tuple[int, bool, bool, str]"] = reveal_type(v1)


# This should generate an error because multiple unpacks.
def func2(v2: Tuple[int, Unpack[Tuple[bool, bool]], str, Unpack[Tuple[bool, bool]]]):
    pass


def func3(v3: Tuple[int, Unpack[Tuple[bool, ...]], str]):
    t3: Literal["Tuple[int, *tuple[bool, ...], str]"] = reveal_type(v3)


# This should generate an error because there are multiple unbounded tuples.
def func4(v4: Tuple[Unpack[Tuple[bool, ...]], ...]):
    pass


# This should generate an error because there are multiple unbounded tuples.
def func5(v5: Tuple[Unpack[Tuple[Unpack[Tuple[bool, ...]]]], ...]):
    pass


def func6(v6: Tuple[Unpack[Tuple[bool]], ...]):
    t6: Literal["Tuple[bool, ...]"] = reveal_type(v6)


def func7(v7: Tuple[Unpack[Tuple[bool, Unpack[Tuple[int, float]]]]]):
    t7: Literal["Tuple[bool, int, float]"] = reveal_type(v7)


def func8(v8: Union[Unpack[Tuple[Unpack[Tuple[bool, Unpack[Tuple[int, ...]]]]]]]):
    t8: Literal["bool | int"] = reveal_type(v8)
