# This sample tests that the position-based heuristic for skipping
# declarations in the same execution scope (typeEvaluator.ts) correctly
# defers to the flow engine for non-loop branching (if/else, try/except).
# Declarations that textually precede usage but are flow-unreachable
# should not contribute a bound type at the usage site.


def if_return_branch(flag: bool, s: str):
    if flag:
        x = s
        return
    # The assignment to x textually precedes this point, but the only
    # path reaching here did not execute it. The flow engine should
    # report x as fully Unbound.
    reveal_type(x, expected_text="Unbound")  # Error: x is unbound


def if_no_else(flag: bool, s: str):
    if flag:
        x = s
    # x may or may not be bound depending on which branch was taken.
    reveal_type(x, expected_text="str | Unbound")  # Error: x is possibly unbound


def try_except_branch(flag: bool, s: str):
    try:
        x = s
        if flag:
            raise ValueError()
    except ValueError:
        # x was assigned before the raise, but the flow engine must
        # account for the possibility that the assignment itself could
        # have raised, leaving x unbound.
        reveal_type(x, expected_text="Unbound | str")  # Error: x is possibly unbound


def if_else_untyped_in_one_branch(flag: bool, s: str):
    if flag:
        x = s
    else:
        y = 1
    # x is assigned only in the True-branch; in the False-branch it is
    # unbound.  The declaration textually precedes usage so the position
    # heuristic retains it, but the flow engine must still narrow to
    # include Unbound.
    reveal_type(x, expected_text="str | Unbound")  # Error: x is possibly unbound
