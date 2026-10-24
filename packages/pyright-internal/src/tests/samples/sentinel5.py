# This sample tests that repeated sentinel allocations are not treated as one singleton.

import sys
from typing import assert_never

if sys.version_info >= (3, 15):
    from builtins import sentinel
else:
    from typing_extensions import Sentinel as sentinel  # pyright: ignore[reportMissingModuleSource]


Shared = sentinel("Shared")


class Holder:
    class_missing = sentinel("class_missing")

    def __init__(self) -> None:
        self.missing = sentinel("missing")
        self.shared = Shared


def compare_members(a: Holder, b: Holder) -> str:
    if a.missing is not b.missing:
        reveal_type(a.missing, expected_text="missing")
        # This should generate an error because different holders can have different sentinels.
        return a.missing
    return ""


def compare_aliases(a: Holder, b: Holder) -> None:
    first, second = a.missing, b.missing
    if first is second:
        reveal_type(first, expected_text="missing")
    else:
        reveal_type(first, expected_text="missing")
        # This should generate an error because this branch is reachable.
        assert_never(first)


def choose(holder: Holder, flag: bool):
    return holder.missing if flag else "ok"


def consume(a: Holder, b: Holder, flag: bool) -> str:
    value = choose(a, flag)
    if value is not b.missing:
        reveal_type(value, expected_text="missing | Literal['ok']")
        # This should generate an error because value can still be a sentinel.
        return value.upper()
    return "missing"


items = [sentinel("item") for _ in range(2)]
values = (sentinel("generated") for _ in range(2))


def compare_items() -> None:
    if items[0] is not items[1]:
        reveal_type(items[0], expected_text="item")
        # This should generate an error because each iteration creates a new sentinel.
        assert_never(items[0])


def compare_generated() -> None:
    first, second = next(values), next(values)
    if first is not second:
        reveal_type(first, expected_text="generated")
        # This should generate an error because each iteration creates a new sentinel.
        assert_never(first)


def make_holder():
    class LocalHolder:
        missing = sentinel("missing")

    return LocalHolder()


def compare_local_classes() -> None:
    first, second = make_holder().missing, make_holder().missing
    if first is not second:
        reveal_type(first, expected_text="missing")
        # This should generate an error because each class body execution creates a new sentinel.
        assert_never(first)


loop_count = 0
while True:
    class LoopHolder:
        missing = sentinel("missing")

    loop_count += 1
    if loop_count == 2:
        break


def compare_loop_classes(a: LoopHolder, b: LoopHolder) -> None:
    if a.missing is not b.missing:
        reveal_type(a.missing, expected_text="missing")
        # This should generate an error because the class body can execute more than once.
        assert_never(a.missing)


def compare_shared(a: Holder, b: Holder) -> None:
    if a.shared is not b.shared:
        reveal_type(a.shared, expected_text="Never")
        assert_never(a.shared)

    if a.class_missing is not b.class_missing:
        reveal_type(a.class_missing, expected_text="Never")
        assert_never(a.class_missing)

    a.shared = [a.shared][0]
    a.class_missing = [a.class_missing][0]
    a.missing = [a.missing][0]


def use_shared(value: int | Shared) -> int:
    if value is Shared:
        reveal_type(value, expected_text="Shared")
        return 0
    reveal_type(value, expected_text="int")
    return value


factory = lambda: sentinel("factory_value")


def compare_factory() -> None:
    first, second = factory(), factory()
    if first is not second:
        reveal_type(first, expected_text="factory_value")
        # This should generate an error because the lambda creates a new sentinel on each call.
        assert_never(first)
