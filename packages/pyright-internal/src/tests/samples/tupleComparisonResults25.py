# Tuple ordering checks a growing recursive alias up to the recursion limit,
# and every element of a long or aliased operand.

from typing import Callable, Concatenate, Literal


class Box[T]:
    def __init__(self, value: T) -> None:
        self.value = value

    def __lt__(self, other: "T | Box[T]") -> bool:
        return True

    def __gt__(self, other: "T | Box[T]") -> bool:
        return True


type Shifted[T] = tuple[*tuple[T, ...], int, tuple[Shifted[list[T]], ...]]


def shifted(a: Shifted[int], b: Shifted[int]) -> None:
    # This should generate an error.
    _ = a < b


type Deep[T] = tuple[*tuple[T, ...], int, tuple[Deep[Box[T]], ...]]


def deep(a: Deep[int], b: Deep[int]) -> None:
    # This should generate an error.
    _ = a < b


class Value[T]:
    def __init__(self, value: T) -> None:
        self.value = value

    def __lt__(self, other: "Value[T]") -> T:
        return self.value


type Tree[T] = tuple[T, tuple[Tree[Value[T]], ...]]


def growing_result(a: Tree[int], b: Tree[int]) -> None:
    reveal_type(
        a < b,
        expected_text="int | Value[int] | Value[Value[int]] | Value[Value[Value[int]]] | Value[Value[Value[Value[int]]]] | Value[Value[Value[Value[Value[int]]]]] | Value[Value[Value[Value[Value[Value[int]]]]]] | Value[Value[Value[Value[Value[Value[Value[int]]]]]]] | Value[Value[Value[Value[Value[Value[Value[Value[int]]]]]]]] | Value[Value[Value[Value[Value[Value[Value[Value[Value[int]]]]]]]]] | Value[Value[Value[Value[Value[Value[Value[Value[Value[Value[int]]]]]]]]]] | Unknown | bool",
    )


class Callback[**P]:
    def __init__(self, f: Callable[P, int]) -> None:
        self.f = f

    def __lt__(self, other: object) -> bool:
        return True


type Signatures[**P] = tuple[Callback[P], tuple[Signatures[Concatenate[int, P]], ...]]


def growing_param_spec(a: Signatures[[]], b: Signatures[[]]) -> None:
    reveal_type(a < b, expected_text="bool")


type Variadic[*Ts] = tuple[*Ts, tuple[Variadic[*Ts, int], ...]]


def variadic(a: Variadic[int, str], b: Variadic[int, str]) -> None:
    reveal_type(a < b, expected_text="bool")


def variadic_mismatch(a: Variadic[int, str], b: Variadic[int, bytes]) -> None:
    # This should generate an error.
    _ = a < b


type Ping[T] = tuple[T, tuple[Pong[list[T]], ...]]
type Pong[T] = tuple[T, tuple[Ping[T], ...]]


def growing_mutual(a: Ping[int], b: Ping[int]) -> None:
    reveal_type(a < b, expected_text="bool")


def growing_mutual_mismatch(a: Ping[int], b: Pong[int]) -> None:
    # This should generate an error.
    _ = a < b


A = tuple[int]


def many_aliases(
    a: tuple[A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, A, tuple[str]],
    b: tuple[tuple[Literal[0]], tuple[Literal[1]], tuple[Literal[2]], tuple[Literal[3]], tuple[Literal[4]], tuple[Literal[5]], tuple[Literal[6]], tuple[Literal[7]], tuple[Literal[8]], tuple[Literal[9]], tuple[Literal[10]], tuple[Literal[11]], tuple[Literal[12]], tuple[Literal[13]], tuple[Literal[14]], tuple[Literal[15]], tuple[Literal[16]], tuple[Literal[17]], tuple[Literal[18]], tuple[Literal[19]], tuple[Literal[20]], tuple[Literal[21]], tuple[Literal[22]], tuple[Literal[23]], tuple[Literal[24]], tuple[Literal[25]], tuple[Literal[26]], tuple[Literal[27]], tuple[Literal[28]], tuple[Literal[29]], tuple[Literal[30]], tuple[Literal[31]], tuple[Literal[32]], tuple[Literal[33]], tuple[Literal[34]], tuple[Literal[35]], tuple[Literal[36]], tuple[Literal[37]], tuple[Literal[38]], tuple[Literal[39]], tuple[Literal[40]], tuple[Literal[41]], tuple[Literal[42]], tuple[Literal[43]], tuple[Literal[44]], tuple[Literal[45]], tuple[Literal[46]], tuple[Literal[47]], tuple[Literal[48]], tuple[Literal[49]], tuple[Literal[50]], tuple[Literal[51]], tuple[Literal[52]], tuple[Literal[53]], tuple[Literal[54]], tuple[Literal[55]], tuple[Literal[56]], tuple[Literal[57]], tuple[Literal[58]], tuple[Literal[59]], tuple[Literal[60]], tuple[Literal[61]], tuple[Literal[62]], tuple[Literal[63]], tuple[Literal[64]], tuple[Literal[65]], tuple[Literal[66]], tuple[Literal[67]], tuple[Literal[68]], tuple[Literal[69]], tuple[int]],
) -> None:
    # This should generate an error.
    _ = a < b


type J = list[J]


class D(dict[str, list[int]]): ...


def recursive_alias_with_dict(a: tuple[J, dict[str, list[int]]], b: tuple[J, D]) -> None:
    # This should generate an error.
    _ = a < b


def same_name_prefix(x: int) -> None:
    # This should generate an error.
    _ = (x, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, "s") < (x, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1)
