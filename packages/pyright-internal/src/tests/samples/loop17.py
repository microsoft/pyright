# This sample tests the case where a loop involves an unannotated parameter
# and therefore an "unknown" that propagates through the loop.


def f(x):
    e = 0
    for _ in [0]:
        e += x
    # After the loop, e is Unknown because the loop is guaranteed to execute
    # and e += x makes e Unknown (since x is unknown).
    reveal_type(e, expected_text="Unknown")
    return e
