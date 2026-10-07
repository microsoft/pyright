# This sample tests that impossible arguments do not trigger protocol intersections.

from typing import Protocol, runtime_checkable
from typing_extensions import assert_type


@runtime_checkable
class RecursiveProtocol(Protocol):
    next: "RecursiveProtocol"
    value: int


def test_nested_arguments(value: RecursiveProtocol) -> None:
    match value:
        # This should generate an error because the innermost argument is impossible.
        case RecursiveProtocol(
            next=RecursiveProtocol(
                next=RecursiveProtocol(
                    next=RecursiveProtocol(
                        next=RecursiveProtocol(
                            next=RecursiveProtocol(
                                next=RecursiveProtocol(
                                    next=RecursiveProtocol(value=str())
                                )
                            )
                        )
                    )
                )
            )
        ):
            pass
        case _:
            assert_type(value, RecursiveProtocol)
