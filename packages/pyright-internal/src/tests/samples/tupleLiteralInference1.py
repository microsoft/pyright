# Bounded nested tuple literals use ordinary inference and code flow.
from typing import Literal, TypeVar, assert_type


value = ((1, "a"),)
assert_type(value, tuple[tuple[Literal[1], Literal["a"]]])
alias = value
assert_type(alias, tuple[tuple[Literal[1], Literal["a"]]])
assert_type(value[0], tuple[Literal[1], Literal["a"]])
assert_type(value[:][0], tuple[Literal[1], Literal["a"]])
assert_type((alias,)[0][0], tuple[Literal[1], Literal["a"]])
assert_type((value + value)[0], tuple[Literal[1], Literal["a"]])

rows = [value[0]]
assert_type(rows, list[tuple[int, str]])
rows.append((2, "b"))
assert_type([alias], list[tuple[tuple[int, str]]])
assert_type([value[:]], list[tuple[tuple[int, str]]])
assert_type({value[0]}, set[tuple[int, str]])
assert_type({0: value[0]}, dict[int, tuple[int, str]])
assert_type([value[0] for _ in range(1)], list[tuple[int, str]])
assert_type(list(value), list[tuple[int, str]])

declared: tuple[tuple[int, str]] = value
declared_rows = [declared[0]]
assert_type(declared_rows, list[tuple[int, str]])
declared_rows.append((2, "b"))

# Previously supported literal precision must not be widened.
explicit: tuple[tuple[int, str]] = ((1, "a"),)
assert_type([explicit[0]], list[tuple[Literal[1], Literal["a"]]])
flat = (1, "a")
assert_type([flat], list[tuple[Literal[1], Literal["a"]]])

exact: tuple[tuple[Literal[1], Literal["a"]]] = value
assert_type([exact[0]], list[tuple[Literal[1], Literal["a"]]])
exact = ((2, "b"),)  # This should generate an assignment error.

exact_options: tuple[tuple[Literal[1, 2], Literal["a", "b"]]] = value
assert_type([exact_options[0]], list[tuple[Literal[1], Literal["a"]]])
exact_options = ((2, "b"),)
assert_type([exact_options[0]], list[tuple[Literal[2], Literal["b"]]])

T = TypeVar("T")


def identity(item: T) -> T:
    return item


assert_type(identity(value), tuple[tuple[Literal[1], Literal["a"]]])


def flow(flag: bool) -> None:
    if flag:
        item = ((1, "a"),)
    else:
        item = ((2, "b"),)
    saved = item
    assert_type(
        saved,
        tuple[tuple[Literal[1], Literal["a"]]] | tuple[tuple[Literal[2], Literal["b"]]],
    )
    assert_type([saved[0]], list[tuple[int, str]])
    item = ((3, "c"),)
    assert_type(item, tuple[tuple[Literal[3], Literal["c"]]])
    assert_type(
        saved,
        tuple[tuple[Literal[1], Literal["a"]]] | tuple[tuple[Literal[2], Literal["b"]]],
    )


def duplicate_flow(flag: bool) -> None:
    # Equal types from explicit and newly inferred sources must merge their
    # inference fallback regardless of which source is visited first.
    explicit: tuple[tuple[int, str]] = ((1, "a"),)
    if flag:
        first = explicit
        second = value
    else:
        first = value
        second = explicit
    assert_type([first[0]], list[tuple[Literal[1], Literal["a"]] | tuple[int, str]])
    assert_type([second[0]], list[tuple[Literal[1], Literal["a"]] | tuple[int, str]])


def factory():
    return ((1, "a"),)


assert_type(factory(), tuple[tuple[Literal[1], Literal["a"]]])
assert_type([factory()[0]], list[tuple[int, str]])


def products(
    a: Literal[0, 1],
    b: Literal[0, 1],
    c: Literal[0, 1],
    d: Literal[0, 1],
    e: Literal[0, 1],
    f: Literal[0, 1],
    g: Literal[0, 1],
) -> None:
    # Six binary choices fit the 64 cap; seven fall back to int, not Unknown.
    within = ((a, b, c, d, e, f),)
    assert_type(within[0][0], Literal[0, 1])
    beyond = ((a, b, c, d, e, f, g),)
    assert_type(beyond[0][0], int)
    assert_type(beyond[0][6], int)

    left = ((0, a, b, c, 0), "text")
    right = ((1, d, e, f, 0), 3)
    assert_type(left < right, bool)
    right_larger = ((1, d, e, f, g), 3)
    _ = left < right_larger  # This should generate an error after the 8 * 16 fallback.
    assert_type(left[0][0], Literal[0])
    assert_type(right_larger[0][0], Literal[1])


def joins(flag: int) -> None:
    if flag == 0:
        item = ((0, "a"),)
    elif flag == 1:
        item = ((1, "a"),)
    elif flag == 2:
        item = ((2, "a"),)
    elif flag == 3:
        item = ((3, "a"),)
    elif flag == 4:
        item = ((4, "a"),)
    elif flag == 5:
        item = ((5, "a"),)
    elif flag == 6:
        item = ((6, "a"),)
    elif flag == 7:
        item = ((7, "a"),)
    elif flag == 8:
        item = ((8, "a"),)
    elif flag == 9:
        item = ((9, "a"),)
    elif flag == 10:
        item = ((10, "a"),)
    else:
        item = ((11, "a"),)
    assert_type(item, tuple[tuple[int, str]])


# The outer tuple, inner tuple and 62 scalar positions consume 64 nodes.
at_size_cap = ((
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1,
),)
assert_type(at_size_cap[0][0], Literal[1])
beyond_size_cap = ((
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1,
),)
assert_type(beyond_size_cap[0][0], int)
assert_type(beyond_size_cap[0][62], int)

explicit_large: tuple[tuple[int, ...]] = ((
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
    1, 1, 1,
),)
assert_type(explicit_large[0][0], Literal[1])
