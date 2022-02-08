# This sample tests the handling of *tuple[...] as described
# in PEP 646. This test is the same as tupleUnpack1.py but
# it uses the * syntax instead of the backward compatibility
# "Unpack" form.

from typing import Union


def func1(v1: tuple[int, *tuple[bool, bool], str]):
    reveal_type(v1, expected_text="tuple[int, bool, bool, str]")


# This should generate an error because multiple unpacks.
def func2(v2: tuple[int, *tuple[bool, bool], str, *tuple[bool, bool]]):
    pass


def func3(v3: tuple[int, *tuple[bool, ...], str]):
    reveal_type(v3, expected_text="tuple[int, *tuple[bool, ...], str]")


# This should generate an error because there are multiple unbounded tuples.
def func4(v4: tuple[*tuple[bool, ...], ...]):
    pass


# This should generate an error because there are multiple unbounded tuples.
def func5(v5: tuple[*tuple[*tuple[bool, ...]], ...]):
    pass


def func6(v6: tuple[*tuple[bool], ...]):
    reveal_type(v6, expected_text="tuple[bool, ...]")


def func7(v7: tuple[*tuple[bool, *tuple[int, float]]]):
    reveal_type(v7, expected_text="tuple[bool, int, float]")


def func8(v8: Union[*tuple[*tuple[bool, *tuple[int, ...]]]]):
    reveal_type(v8, expected_text="bool | int")

# This should generate an error because unpack isn't allowed for simple parameters.
def func9(v9: *tuple[int, int]):
    pass

# This should generate an error because unpack isn't allowed for **kwargs parameters.
def func10(**v10: *tuple[int, int]):
    pass

def func11(*v11: *tuple[int, ...]):
    pass

def func12(*v11: *tuple[int, int]):
    pass

