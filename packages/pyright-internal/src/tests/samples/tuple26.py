def invalid_fixed() -> None:
    _ = (1, "a") < ("b", 2)  # This should generate an error.
    _ = (1, "a") <= ("b", 2)  # This should generate an error.
    _ = (1, "a") > ("b", 2)  # This should generate an error.
    _ = (1, "a") >= ("b", 2)  # This should generate an error.

    _ = (0, 1, "a") < (0, "b", 2)  # This should generate an error.
    _ = (b"a", "a") < ("b", b"b")  # This should generate an error.
    _ = (None, 1) < (2, None)  # This should generate an error.
    _ = (True, "a") < ("b", False)  # This should generate an error.


def invalid_unbounded() -> bool:
    left: tuple[int | str, ...] = (1, "a")
    right: tuple[int | str, ...] = ("b", 2)
    _ = left <= right  # This should generate an error.
    _ = left > right  # This should generate an error.
    _ = left >= right  # This should generate an error.
    return left < right  # This should generate an error.


def invalid_union(flag: bool) -> bool:
    left = (1, "a") if flag else ("c", 3)
    _ = left <= ("b", 2)  # This should generate an error.
    _ = left > ("b", 2)  # This should generate an error.
    _ = left >= ("b", 2)  # This should generate an error.
    return left < ("b", 2)  # This should generate an error.


def valid_short_circuit() -> None:
    _ = (0, 1, "a") < (1, "b", 2)
    _ = (0, "a", 1) < (0, "b", "c")
    _ = (1, "a") < (1, "a", None)


def invalid_nested() -> None:
    _ = ((1j,), 0) < ((2j,), 1)  # This should generate an error.
    _ = ([1j], 0) < ([2j], 1)  # This should generate an error.
    _ = (([1j],), 0) <= (([2j],), 1)  # This should generate an error.
    _ = ([1j], 0) > ([2j], 1)  # This should generate an error.
    _ = ((1j,), 0) >= ((2j,), 1)  # This should generate an error.


def valid_nested() -> None:
    _ = ((1,), 0) < ((2,), 1)
    _ = ([1], 0) < ([2], 1)
    _ = (([1],), 0) < (([2],), 1)
    _ = (0, [1j]) < (1, [2j])
