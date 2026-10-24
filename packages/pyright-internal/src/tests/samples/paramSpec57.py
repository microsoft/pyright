# This sample tests the case where an overloaded function that was
# produced by solving a ParamSpec is passed again to a function that
# accepts a ParamSpec-based callable.

from typing import Callable, Concatenate, ParamSpec, TypeVar, overload

P = ParamSpec("P")
R = TypeVar("R")
S = TypeVar("S")
M = TypeVar("M")


def delegate(f: Callable[P, R]) -> Callable[P, R]:
    return f


@overload
def add(x: int, y: int) -> int: ...
@overload
def add(x: str, y: str) -> str: ...
def add(x: int | str, y: int | str) -> int | str:
    return x


func1 = delegate(add)
func2 = delegate(func1)
reveal_type(func2(1, 2), expected_text="int")
reveal_type(func2("a", "b"), expected_text="str")

func3 = delegate(func2)
reveal_type(func3(1, 2), expected_text="int")


def delegate_method(
    method: Callable[Concatenate[M, P], R], getter: Callable[[S], M]
) -> Callable[Concatenate[S, P], R]: ...


class Adder:
    @overload
    def add(self, x: int, y: int) -> int: ...
    @overload
    def add(self, x: str, y: str) -> str: ...
    def add(self, x: int | str, y: int | str) -> int | str:
        return x


class ALU:
    adder: Adder

    def get_adder(self) -> Adder:
        return self.adder

    add = delegate_method(Adder.add, get_adder)


class CPU:
    alu: ALU

    def get_alu(self) -> ALU:
        return self.alu

    add = delegate_method(ALU.add, get_alu)


def func4(cpu: CPU):
    reveal_type(cpu.add(1, 2), expected_text="int")
    reveal_type(cpu.add("a", "b"), expected_text="str")
