# This sample tests the special-case handling of the __add__ operator
# when two tuples of known types are added together.

from typing import Tuple


v1 = () + ()
reveal_type(v1, expected_text="tuple[()]")


def func1(a: Tuple[int, int, int], b: Tuple[str, str]):
    reveal_type(a + b, expected_text="tuple[int, int, int, str, str]")


def func2(a: Tuple[int, int, int], b: Tuple[str, ...]):
    reveal_type(a + b, expected_text="tuple[int | str, ...]")


def func3(input_list):
    output_tuple = ()

    for _, value in enumerate([]):
        if value is None:
            output_tuple += (None,)
            continue
        output_tuple += (input_list[value],)

    return output_tuple
