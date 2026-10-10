from __future__ import annotations

# Invalid annotation yields must not turn enclosing functions into generators.
import sys
from typing import Annotated


def reachable():
    # scope error: yield
    def inner(value: Annotated[int, (yield 1)]):
        pass
    return 1


def after_return():
    return 1
    # scope error: yield
    value: Annotated[int, (yield 1)] = 0


def false_branch():
    if False:
        # scope error: yield from
        value: Annotated[int, (yield from (1,))] = 0
    return 1


def unreachable_walrus():
    return 1
    # scope error: :=
    value: Annotated[int, (metadata := 1)] = 0


async def metadata() -> int:
    return 1


async def unreachable_await():
    return 1
    # scope error: await
    value: Annotated[int, await metadata()] = 0


# Nested definitions must also have their unreachable annotations validated.
def unreachable_definition():
    return 1
    # scope error: :=
    def inner(value: Annotated[int, (metadata := 1)]):
        pass


# Genuine body yields still make generators, whether reachable or not.
def ordinary_generator():
    yield 1
    return 1


def unreachable_generator():
    return 1
    yield 1


def lambda_control():
    value: Annotated[int, lambda: (yield 1)] = 0
    return 1


reveal_type(reachable, expected_text="() -> Literal[1]")
reveal_type(after_return, expected_text="() -> Literal[1]")
reveal_type(false_branch, expected_text="() -> Literal[1]")

reveal_type(unreachable_walrus, expected_text="() -> Literal[1]")
reveal_type(unreachable_await, expected_text="() -> CoroutineType[Any, Any, Literal[1]]")
reveal_type(unreachable_definition, expected_text="() -> Literal[1]")
reveal_type(ordinary_generator, expected_text="() -> Generator[Literal[1], Any, Literal[1]]")
reveal_type(unreachable_generator, expected_text="() -> Generator[Never, Any, Literal[1]]")
reveal_type(lambda_control, expected_text="() -> Literal[1]")
