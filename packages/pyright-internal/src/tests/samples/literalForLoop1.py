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


def test_break_in_guaranteed_loop():
    """break exits the loop, but the body still executes at least once."""
    for x in [1, 2, 3]:
        y = 1
        break
    # y is definitely assigned because the loop body runs at least once before break
    del y  # This should not generate an error


def test_conditional_break_in_guaranteed_loop():
    """Conditional break — variable assigned before the condition is always assigned."""
    cond = True
    for x in [1, 2, 3]:
        y = 1
        if cond:
            break
    # y is always assigned before the conditional break check
    del y  # This should not generate an error


def test_for_else_guaranteed_no_break():
    """for...else where the guaranteed loop has no break — else always executes."""
    for x in [1, 2]:
        y = 1
    else:
        z = 2
    del y  # This should not generate an error
    del z  # This should not generate an error — else runs because no break


def test_for_else_guaranteed_with_break():
    """for...else where guaranteed loop always breaks — else never executes."""
    for x in [1, 2]:
        y = 1
        break
    else:
        z = 2
    del y  # This should not generate an error — y assigned before break
    del z  # This should generate an error — else skipped due to unconditional break


def test_return_in_guaranteed_loop() -> int:
    """return in guaranteed loop body — post-loop code is unreachable."""
    for x in [1]:
        return 42
    # Post-loop code is unreachable because every iteration returns
    y = 1  # unreachable, no possibly-unbound error expected
    return y


def test_raise_in_guaranteed_loop():
    """raise in guaranteed loop body — post-loop code is unreachable."""
    for x in [1]:
        raise ValueError()
    # Post-loop code is unreachable because every iteration raises
    y = 1  # unreachable, no possibly-unbound error expected


def test_nested_guaranteed_loops():
    """Nested for loops over non-empty literals — both execute at least once."""
    for x in [1]:
        for y in [2]:
            z = 1
    # z is definitely assigned because both loops execute at least once
    del z  # This should not generate an error



