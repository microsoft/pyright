# This sample tests caller argument types passed to contextual helper inference.

from typing import Callable, Mapping


class Basic:
    def __init__(self, *args: "Basic") -> None:
        self.args = args

    def direct(self, rule):
        if self in rule:
            return rule[self]
        return self

    def wrapped(self, rule):
        value, _ = self._flat(rule)
        return value

    def _flat(self, rule):
        if self in rule:
            return rule[self], True
        return self, False

    def annotated(self, rule: Mapping["Basic", "Basic"]):
        value, _ = self._annotated_flat(rule)
        return value

    def _annotated_flat(self, rule: Mapping["Basic", "Basic"]):
        if self in rule:
            return rule[self], True
        return self, False

    def recursive(self, rule):
        value, _ = self._recursive(rule)
        return value

    def _recursive(self, rule):
        if self in rule:
            return rule[self], True
        elif rule:
            args = []
            changed = False
            for arg in self.args:
                replaced, did_replace = arg._recursive(rule)
                args.append(replaced)
                changed |= did_replace
            if changed:
                return type(self)(*args), True
        return self, False


class Expr(Basic):
    def expr_only(self) -> int:
        return 42


class Other(Basic):
    def other_only(self) -> str:
        return ""


def replacement(value: Expr, other: Basic, distinct: Other) -> None:
    direct = value.direct({value: other})
    reveal_type(direct, expected_text="Basic* | Expr")
    # This should generate an error because the replacement can be Basic.
    direct.expr_only()

    wrapped = value.wrapped({value: other})
    reveal_type(wrapped, expected_text="Basic* | Expr")
    # This should generate an error because the replacement can be Basic.
    wrapped.expr_only()

    annotated = value.annotated({value: other})
    reveal_type(annotated, expected_text="Basic | Expr")
    # This should generate an error because the replacement can be Basic.
    annotated.expr_only()

    reveal_type(value.wrapped({value: distinct}), expected_text="Other* | Expr")
    reveal_type(value.wrapped({value: value}), expected_text="Expr* | Expr")
    reveal_type(value.wrapped({value: other}), expected_text="Basic* | Expr")
    reveal_type(distinct.wrapped({distinct: value}), expected_text="Expr* | Other")
    reveal_type(value.wrapped({value: distinct}), expected_text="Other* | Expr")
    value.wrapped({value: value}).expr_only()

    recursive = value.recursive({value: other})
    reveal_type(recursive, expected_text="Basic* | Expr")
    # This should generate an error because recursion does not exclude Basic.
    recursive.expr_only()


def identity(value):
    return value


def forward(value):
    return identity(value)


def pair(first, second):
    return first, second


def forward_pair(first, second):
    return pair(second=second, first=first)


def defaulted(value, fallback=1):
    if value:
        return value
    return fallback


def forward_default(value):
    return defaulted(value)


def callers(first: int, second: str, receiver: Expr) -> None:
    reveal_type(forward(first), expected_text="int")
    reveal_type(forward(second), expected_text="str")
    reveal_type(forward(first), expected_text="int")
    reveal_type(forward(receiver), expected_text="Expr")
    reveal_type(forward_pair(first, second), expected_text="tuple[int, str]")
    reveal_type(forward_pair(second, first), expected_text="tuple[str, int]")
    reveal_type(forward_pair(first, second), expected_text="tuple[int, str]")
    reveal_type(forward_default(second), expected_text="str | Literal[1]")
    reveal_type(forward_default(first), expected_text="int")
    reveal_type(forward_default(second), expected_text="str | Literal[1]")


def apply_function(f: Callable[[Expr], Expr]) -> None:
    pass


def callback(rule: Mapping[Basic | complex, Basic | complex]) -> None:
    # This should generate an error because the callback can return Basic or complex.
    apply_function(lambda value: value.wrapped(rule))
