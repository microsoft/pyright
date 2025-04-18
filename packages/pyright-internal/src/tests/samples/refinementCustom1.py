# This sample tests the handling of custom refinement types.

# pyright: reportMissingModuleSource=false

from typing_extensions import StrRefinement


class Units(StrRefinement):
    def __str__(self) -> str:
        return ""


type FloatYards = float @ Units(value="yards")
type FloatMeters = float @ Units(value="meters")


def add_units(a: float @ Units("x"), b: float @ Units("x")) -> float @ Units("x"):
    return a + b


def convert_yards_to_meters(a: float @ Units("'yards'")) -> float @ Units("'meters'"):
    return a * 0.9144


def test2(a: float @ Units("'meters'"), b: float @ Units("'yards'")):
    m = convert_yards_to_meters(b)
    reveal_type(m, expected_text="float @ Units(\"'meters'\")")
    add_units(a, m)

    # This should generate an error.
    add_units(a, b)


def test3(a: FloatMeters, b: FloatYards):
    m = convert_yards_to_meters(b)
    reveal_type(m, expected_text="float @ Units(\"'meters'\")")
    add_units(a, m)

    # This should generate an error.
    add_units(a, b)
