# This sample file tests various aspects of type analysis for tuples.

no_args: tuple = ()
zero_length: tuple[()] = ()
all_ints1: tuple[int, ...] = ()
all_ints2: tuple[int, ...] = (1,)
all_ints3: tuple[int, ...] = (1, 3, 4)

all_ints1 = all_ints2
all_ints2 = all_ints3
all_ints3 = all_ints2

# This should generate an error.
bad_ellipsis1: tuple[...]

# This should generate an error.
bad_ellipsis2: tuple[int, int, ...]

# This should generate an error.
bad_ellipsis3: tuple[int, ..., int]

# This should generate an error.
bad_ellipsis4: tuple[*tuple[int], ...]

# This should generate an error.
bad_ellipsis5: tuple[*tuple[int, ...], ...]
