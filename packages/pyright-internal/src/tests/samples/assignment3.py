# This sample tests various assignment scenarios where
# there is an expected type, so bidirectional type
# inference is used.

from typing import Callable, Dict, Tuple

f1: Callable[[int, int], int] = lambda a, b: a + b

# This should generate an error because x should be
# determined to be an "int", so "len(x)" is invalid.
map(lambda x: len(x), [1, 2, 3])

def must_be_int(val: int):
    return val

d1: Dict[str, Tuple[int, Callable[[int], int]]] = {
    'hello': (3, lambda x: must_be_int(x))
}

d2: Dict[str, Tuple[int, Callable[[int], int]]] = {
    # This should generate an error because the key is not a str.
    3: (3, lambda x: must_be_int(x))
}

d3: Dict[str, Tuple[int, Callable[[int], int]]] = {
    # This should generate an error because the first element
    # of the tuple is not the correct type.
    '3': (3.0, lambda x: must_be_int(x))
}

d4: Dict[str, Tuple[int, Callable[[int], int]]] = {
    # This should generate an error because the lambda
    # type doesn't match.
    '3': (3, lambda _: 3.4)
}

