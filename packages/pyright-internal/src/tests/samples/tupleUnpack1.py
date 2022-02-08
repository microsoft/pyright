# This sample tests the handling of Unpack[Tuple[...]] as described
# in PEP 646.

from typing import Tuple, Union
from typing_extensions import Unpack


def func1(v1: Tuple[int, Unpack[Tuple[bool, bool]], str]):
    reveal_type(v1, expected_text="Tuple[int, bool, bool, str]")


# This should generate an error because multiple unpacks.
def func2(v2: Tuple[int, Unpack[Tuple[bool, bool]], str, Unpack[Tuple[bool, bool]]]):
    pass


def func3(v3: Tuple[int, Unpack[Tuple[bool, ...]], str]):
    reveal_type(v3, expected_text="Tuple[int, *tuple[bool, ...], str]")


# This should generate an error because there are multiple unbounded tuples.
def func4(v4: Tuple[Unpack[Tuple[bool, ...]], ...]):
    pass


# This should generate an error because there are multiple unbounded tuples.
def func5(v5: Tuple[Unpack[Tuple[Unpack[Tuple[bool, ...]]]], ...]):
    pass


def func6(v6: Tuple[Unpack[Tuple[bool]], ...]):
    reveal_type(v6, expected_text="Tuple[bool, ...]")


def func7(v7: Tuple[Unpack[Tuple[bool, Unpack[Tuple[int, float]]]]]):
    reveal_type(v7, expected_text="Tuple[bool, int, float]")


def func8(v8: Union[Unpack[Tuple[Unpack[Tuple[bool, Unpack[Tuple[int, ...]]]]]]]):
    reveal_type(v8, expected_text="bool | int")


# This should generate an error because unpack isn't allowed for simple parameters.
def func9(v9: Unpack[tuple[int, int]]):
    pass


# This should generate an error because unpack isn't allowed for **kwargs parameters.
def func10(**v10: Unpack[tuple[int, int]]):
    pass


def func11(*v11: Unpack[tuple[int, ...]]):
    pass


def func12(*v11: Unpack[tuple[int, int]]):
    pass
