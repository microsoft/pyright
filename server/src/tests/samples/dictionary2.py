# This sample tests dictionary inference logic.

from typing import Mapping, Union


def f(mapping: Mapping[Union[str, bytes], int]):
    return mapping


f({"x": 1})
f({b"x": 1})

# This should generate an error.
f({3: 1})
