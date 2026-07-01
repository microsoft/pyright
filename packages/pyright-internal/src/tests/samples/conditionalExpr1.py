# This sample tests type narrowing for conditional expressions (ternary operator)
# where the condition is narrowed such that one branch is known to be unreachable.

from typing import assert_type


class Node:
    pass


class Wrapper:
    def __init__(self, child: Node):
        self.child = child


class SpecialNode(Node):
    pass


def func1(plan: Wrapper | None):
    # After the guard, plan is known to be truthy (not None) and 
    # plan.child is known to be SpecialNode.
    if not (plan and isinstance(plan.child, SpecialNode)):
        return
    
    # This should be fine - direct assignment works.
    ts1: SpecialNode = plan.child
    
    # This should also be fine - the else branch (None) is unreachable
    # because plan is known to be truthy in this context.
    ts2: SpecialNode = plan.child if plan else None
    
    # Also verify the inferred type.
    assert_type(plan.child if plan else None, SpecialNode)


def func2(val: int | None):
    # After this guard, val is known to be truthy (not None and not 0).
    if not val:
        return
    
    # The else branch is unreachable since val is known to be truthy.
    # Using different types to make the test meaningful.
    ts1: int = val if val else "fallback"
    assert_type(val if val else "fallback", int)


def func3(val: str | None):
    # After this guard, val is known to be None (falsy).
    if val:
        return
    
    # The if branch is unreachable since val is known to be falsy (None).
    # Using different types to make the test meaningful - without pruning,
    # this would be str | None instead of just None.
    ts1: None = "unreachable" if val else None
    assert_type("unreachable" if val else None, None)


def func4(val: int | None):
    # After this guard, val is known to be not None (but could still be 0, which is falsy).
    if val is None:
        return
    
    # The else branch is still reachable since val could be 0 (falsy).
    # This test verifies that we don't over-narrow.
    ts1: int | str = val if val else "zero"
    assert_type(val if val else "zero", int | str)


def func5(val: int | None):
    # After this guard, val is known to be truthy (not None and not 0).
    if not val:
        return
    
    # The else branch is unreachable since val is known to be truthy.
    # Using different types to make the test meaningful.
    ts1: int = val if val else "fallback"
    assert_type(val if val else "fallback", int)


def func6(val: list[int] | None):
    # After this guard, val is known to be not None.
    if val is None:
        return
    
    # However, val could still be an empty list (falsy), so the else branch
    # is still reachable. Both branches should contribute to the type.
    ts1: list[int] | str = val if val else "empty"
    assert_type(val if val else "empty", list[int] | str)


def func_bool_literal():
    # Test that the bool literal guard prevents over-narrowing for mutable variables.
    maybe = True
    # Both branches should remain since maybe could be reassigned.
    ts: int | str = 1 if maybe else "no"
    assert_type(1 if maybe else "no", int | str)


def func_bool_literal_not():
    # Test that the bool literal guard also applies to `not` expressions.
    flag = True
    # Both branches should remain since flag could be reassigned.
    ts: int | str = 1 if not flag else "yes"
    assert_type(1 if not flag else "yes", int | str)
