from typing import Literal, TypedDict, assert_type


class Options[T](TypedDict, total=False):
    a: T
    b: str
    c: int
    d: int
    e: int
    f: int
    g: int
    always: str


def build(flags: tuple[bool, bool, bool, bool, bool, bool, bool]) -> Options[int]:
    result: Options[int] = {}
    result["always"] = "present"
    if flags[0]:
        result["a"] = 1
    if flags[1]:
        result["b"] = "b"
    if flags[2]:
        result["c"] = 3
    if flags[3]:
        result["d"] = 4
    if flags[4]:
        result["e"] = 5
    if flags[5]:
        result["f"] = 6
    if flags[6]:
        result["g"] = 7

    assert_type(result["always"], Literal["present"])
    if "a" in result:
        assert_type(result["a"], int)

    assert_type(result["b"], str)  # This should generate an error.
    return result
