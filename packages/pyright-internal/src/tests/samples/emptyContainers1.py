# This sample tests type inference for empty lists and dictionaries.

# pyright: reportUnknownVariableType=true, reportUnknownArgumentType=true

from typing import List, Literal


def func1(a: bool):
    val1 = []

    if a:
        val1 = [2, 3]

    t_val1: Literal["list[int]"] = reveal_type(val1)

    if a:
        val2 = []
    else:
        val2 = []

    t_val2: Literal["list[Unknown]"] = reveal_type(val2)

    # This should generate an error because val2 is partially unknown.
    val2 += [3]

    val3 = val2

    # This should generate an error because val3 is partially unknown.
    print(val3)
    t_val3_1: Literal["list[Unknown]"] = reveal_type(val3)

    if a:
        val3 = [3.4]

    print(val3)
    t_val3_2: Literal["list[float]"] = reveal_type(val3)


def func2(a: bool):
    val1 = {}

    if a:
        val1 = {"a": 2}

    t_val1: Literal["dict[str, int]"] = reveal_type(val1)

    if a:
        val2 = {}
    else:
        val2 = {}

    t_val2: Literal["dict[Unknown, Unknown]"] = reveal_type(val2)

    # This should generate an error because val2 is partially unknown.
    val2.pop()

    val3 = val2

    # This should generate an error because val3 is partially unknown.
    print(val3)
    t_val3_1: Literal["dict[Unknown, Unknown]"] = reveal_type(val3)

    if a:
        val3 = {"b": 3.4}

    print(val3)
    t_val3_2: Literal["dict[str, float]"] = reveal_type(val3)


class A:
    def method1(self):
        self.val1 = []
        self.val2 = {}
        self.val3 = []

    def method2(self):
        self.val1 = [3.4]
        self.val2 = {"a": 1}

    def method3(self):
        t_val1: Literal["list[float]"] = reveal_type(self.val1)
        t_val2: Literal["dict[str, int]"] = reveal_type(self.val2)
        t_val3: Literal["list[Unknown]"] = reveal_type(self.val3)

    def method4(self) -> List[int]:
        # This should generate an error because of a type mismatch.
        return self.val1
