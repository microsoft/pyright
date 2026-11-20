# This sample tests truth checks of short-circuit operands without duplicate
# diagnostics in enclosing conditional expressions.

from typing import Never


class Bad:
    def __bool__(self) -> int:
        return 1


def func(a: Bad, b: Bad, flag: bool):
    value = a or "fallback"
    reveal_type(value, expected_text="Bad | Literal['fallback']")

    unchecked = None or b
    reveal_type(unchecked, expected_text="Bad")

    if a or 1:
        pass
    if a or b or 1:
        pass
    if a and b:
        pass
    if False or b:
        pass
    if True or b:
        pass
    if False and b:
        pass
    if flag or b:
        pass
    if (a or b) and flag:
        pass
    if not (a or b):
        pass
    assert a or b
    while a or b:
        break
    choice = 1 if a or b else 2
    filtered = [n for n in range(2) if a or b]
    match 1:
        case _ if a or b:
            pass
    if (captured := a or b):
        print(captured)
    if (a or b) if flag else False:
        pass
    if a if False else (a and b):
        pass
    print(choice, filtered)


def value_chain(a: Bad, b: Bad):
    result = a or b or "fallback"
    reveal_type(result, expected_text="Bad | Literal['fallback']")

    unchecked = True or a or b
    reveal_type(unchecked, expected_text="Literal[True]")


def stop() -> Never:
    raise RuntimeError()


def unreachable_or(a: Bad):
    if stop() or a:
        pass


def unreachable_and(a: Bad):
    if stop() and a:
        pass


def walrus(a: Bad | None) -> None:
    if (captured := a) and captured:
        reveal_type(captured, expected_text="Bad")
    if (checked := a) is not None and checked:
        reveal_type(checked, expected_text="Bad")
