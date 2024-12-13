# This sample tests the reportUnnecessaryComparison check when applied
# to match statements.

from typing import Literal, Mapping, Sequence

Letters = Literal["A", "B", "C"]


def func1(subj: Letters):
    match subj:
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case "A" | "B" | "D":
            pass
        case str():
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case "C":
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case x:
            print(x)


def func2(subj: int | dict[str, str]):
    match subj:
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case str() if subj > 4:
            pass
        case int() if subj > 4:
            pass
        case int():
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case int():
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case (a, b):
            print(a, b)
        case {"": d}:
            print(d)
        case dict():
            pass
        # This should generate an error if reportUnnecessaryComparison is enabled.
        case x:
            print(x)


JsonValue = (
    None | bool | int | float | str | Sequence["JsonValue"] | Mapping[str, "JsonValue"]
)
JsonObject = Mapping[str, JsonValue]


def func3(json_object: JsonObject) -> None:
    match json_object:
        case {
            "a": {
                "b": [
                    {
                        "c": "d",
                    }
                ],
            }
        }:
            pass


TA1 = tuple[Literal["a", "b", "c"], int]


def func4(vals: list[str]) -> TA1:
    x: TA1 = ("c", 0)

    for val in vals:
        match x[0]:
            case "b":
                if val.startswith("x"):
                    x = ("a", 1)
                continue
            case "c":
                if val.startswith("y"):
                    x = ("b", 2)
                continue
            case _:
                pass
    return x


def func5(subj: int | str):
    match subj:
        case int() | str():
            pass

        # This should not generate a diagnostic becuase _ is exempted
        # from the reportUnnecessaryComparison check.
        case _:
            pass
