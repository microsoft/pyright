# This sample tests the case where a loop involves an unannotated parameter
# and therefore an "unknown" that propagates through the loop.


def f(x):
    e = 0
    for _ in [0]:
        e += x
    reveal_type(e, expected_text="Unknown | Literal[0]")
    return e
