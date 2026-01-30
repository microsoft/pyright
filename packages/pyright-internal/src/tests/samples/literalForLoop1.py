# This sample tests that for loops over non-empty literal list or tuple
# expressions are treated as executing at least once for definite assignment
# analysis.

# pyright: reportPossiblyUnboundVariable=true


def test_non_empty_list_literal():
    """Variable assigned in for loop over non-empty list literal should not be reported as possibly unbound."""
    for x in [1]:
        y = 123
    # This should not generate an error because the loop executes at least once
    del y


def test_non_empty_tuple_literal():
    """Variable assigned in for loop over non-empty tuple literal should not be reported as possibly unbound."""
    for x in (1,):
        z = 456
    # This should not generate an error because the loop executes at least once
    del z


def test_non_empty_list_multiple_elements():
    """Variable assigned in for loop over non-empty list with multiple elements."""
    for x in [1, 2, 3]:
        a = "hello"
    # This should not generate an error
    del a


def test_non_empty_tuple_multiple_elements():
    """Variable assigned in for loop over non-empty tuple with multiple elements."""
    for x in (1, 2, 3):
        b = "world"
    # This should not generate an error
    del b


def test_empty_list_literal():
    """Variable assigned in for loop over empty list literal should be reported as possibly unbound."""
    for x in []:
        # This should generate an error because c is possibly unbound
        c = 789
    del c


def test_empty_tuple_literal():
    """Variable assigned in for loop over empty tuple literal should be reported as possibly unbound."""
    for x in ():
        # This should generate an error because d is possibly unbound
        d = 999
    del d


def test_non_literal_iterable():
    """Variable assigned in for loop over non-literal iterable should still be reported as possibly unbound."""
    items = [1, 2, 3]
    for x in items:
        e = "test"
    # This should generate an error because e is possibly unbound
    del e


def test_string_literal():
    """Variable assigned in for loop over string literal should still be reported as possibly unbound (not implemented)."""
    for x in "abc":
        f = "string"
    # This should generate an error because string literals are not yet supported
    del f


def test_starred_expression():
    """Variable assigned in for loop over starred expression should be reported as possibly unbound."""
    empty: list[int] = []
    for x in [*empty]:
        g = 1
    # This should generate an error because g is possibly unbound
    del g


def test_list_comprehension():
    """Variable assigned in for loop over list comprehension should be reported as possibly unbound."""
    for x in [v for v in []]:
        h = 1
    # This should generate an error because h is possibly unbound
    del h


def test_all_continue_loop():
    """Test that post-loop code is reachable even when all paths in loop body end with continue."""
    for x in [1, 2, 3]:
        continue
    # Post-loop code should be reachable.
    # x appears possibly unbound because the save/restore fallback uses the loop-header state
    # which includes the pre-assignment entry path.
    i = x  # This should generate an error



