# This sample tests speculative overload results across contextual parameter bindings.

from typing import TypeAlias, TypeVar

T = TypeVar("T")
Nested: TypeAlias = list["Nested[T]"]


def sort_factors(factors, **args):
    def key(factor):
        coefficients, multiplicity = factor
        return len(coefficients), multiplicity

    return sorted(factors, key=key)


def forward(factors):
    return sort_factors(factors)


def seed(factors: list[tuple[Nested[str], str]]):
    return forward(factors)


reveal_type(
    seed,
    expected_text="(factors: list[tuple[list[Nested[str]], str]]) -> list[tuple[list[Nested[str]], str]]",
)


def check(coefficients: list[int], nested: list[tuple[Nested[str], str]]) -> None:
    reveal_type(sort_factors(nested), expected_text="list[tuple[list[Nested[str]], str]]")
    reveal_type(sort_factors([(coefficients, 1)]), expected_text="list[tuple[list[int], int]]")
    reveal_type(sort_factors(nested), expected_text="list[tuple[list[Nested[str]], str]]")
    reveal_type(sort_factors([(coefficients, 1)]), expected_text="list[tuple[list[int], int]]")
    result = forward([(coefficients, 1)])
    reveal_type(result, expected_text="list[tuple[list[int], int]]")
    for base, multiplicity in result:
        reveal_type(base, expected_text="list[int]")
        reveal_type(multiplicity, expected_text="int")
        reveal_type(-base[0], expected_text="int")
        # This should generate an error because multiplicity remains int.
        bad_multiplicity: str = multiplicity
        # This should generate an error because the coefficient list is flat.
        bad_shape: list[list[int]] = base


def sort_by_first(values):
    return sorted(values, key=lambda value: value[0])


def first(values: list[tuple[list[list[str]], str]]) -> None:
    reveal_type(sort_by_first(values), expected_text="list[tuple[list[list[str]], str]]")


def second(values: list[tuple[list[int], int]]) -> None:
    reveal_type(sort_by_first(values), expected_text="list[tuple[list[int], int]]")


def third(values: list[tuple[list[list[str]], str]]) -> None:
    reveal_type(sort_by_first(values), expected_text="list[tuple[list[list[str]], str]]")
