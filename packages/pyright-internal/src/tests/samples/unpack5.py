# This sample tests unpacking of tuples that contain PEP 646-style
# tuples with unknown length within them.


def suffix() -> tuple[int, str, *tuple[bool, ...]]:
    return 1, "a", True


def test_suffix():
    a1, a2, a3 = suffix()
    reveal_type(a1, expected_text="int")
    reveal_type(a2, expected_text="str")
    reveal_type(a3, expected_text="bool")

    *b1, b2, b3 = suffix()
    # This case is ambiguous.
    reveal_type(b1, expected_text="list[int]")
    reveal_type(b2, expected_text="str")
    reveal_type(b3, expected_text="bool")

    c1, *c2, c3 = suffix()
    # This case is ambiguous.
    reveal_type(c1, expected_text="int")
    reveal_type(c2, expected_text="list[str]")
    reveal_type(c3, expected_text="bool")

    d1, d2, *d3 = suffix()
    reveal_type(d1, expected_text="int")
    reveal_type(d2, expected_text="str")
    reveal_type(d3, expected_text="list[bool]")


def prefix() -> tuple[*tuple[int, ...], str, bool]:
    return 1, "a", True


def test_prefix():
    a1, a2, a3 = prefix()
    reveal_type(a1, expected_text="int")
    reveal_type(a2, expected_text="str")
    reveal_type(a3, expected_text="bool")

    *b1, b2, b3 = prefix()
    reveal_type(b1, expected_text="list[int]")
    reveal_type(b2, expected_text="str")
    reveal_type(b3, expected_text="bool")

    c1, *c2, c3 = prefix()
    # This case is ambiguous.
    reveal_type(c1, expected_text="int")
    reveal_type(c2, expected_text="list[str]")
    reveal_type(c3, expected_text="bool")

    d1, d2, *d3 = prefix()
    # This case is ambiguous.
    reveal_type(d1, expected_text="int")
    reveal_type(d2, expected_text="str")
    reveal_type(d3, expected_text="list[bool]")


def middle() -> tuple[int, *tuple[str, ...], bool]:
    return 1, "a", True


def test_middle():
    a1, a2, a3 = middle()
    reveal_type(a1, expected_text="int")
    reveal_type(a2, expected_text="str")
    reveal_type(a3, expected_text="bool")

    *b1, b2, b3 = middle()
    # This case is ambiguous.
    reveal_type(b1, expected_text="list[int]")
    reveal_type(b2, expected_text="str")
    reveal_type(b3, expected_text="bool")

    c1, *c2, c3 = middle()
    reveal_type(c1, expected_text="int")
    reveal_type(c2, expected_text="list[str]")
    reveal_type(c3, expected_text="bool")

    d1, d2, *d3 = middle()
    # This case is ambiguous.
    reveal_type(d1, expected_text="int")
    reveal_type(d2, expected_text="str")
    reveal_type(d3, expected_text="list[bool]")
