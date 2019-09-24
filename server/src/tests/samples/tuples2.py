# This sample file tests various aspects of type analysis for tuples.

from typing import Tuple


no_args: Tuple = ()
zero_length: Tuple[()] = ()
all_ints1: Tuple[int, ...] = ()
all_ints2: Tuple[int, ...] = (1,)
all_ints3: Tuple[int, ...] = (1, 3, 4)

all_ints1 = all_ints2
all_ints2 = all_ints3
all_ints3 = all_ints2

# This should generate an error.
bad_ellipsis1: Tuple[...]

# This should generate an error
bad_ellipsis2: Tuple[int, int, ...]

# This should generate an error
bad_ellipsis3: Tuple[int, ..., int]

