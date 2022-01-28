# This sample tests deeply-nested parentheses, which can cause problems
# in the parser for arrow callables.

from typing import Any


def func(*args: Any):
    ...


def func2(*args: Any) -> str:
    ...


def func3(a: str | None, b: str | None, x: str | None, y: str | None, z1: int, z2: int):
    func(
        (
            (
                (
                    (
                        (
                            (
                                (
                                    (
                                        (
                                            (
                                                (
                                                    (
                                                        (
                                                            (
                                                                (
                                                                    "text "
                                                                    + func2(
                                                                        (
                                                                            "null"
                                                                            if a is None
                                                                            else a
                                                                        )
                                                                        + (
                                                                            "null"
                                                                            if b is None
                                                                            else b
                                                                        )
                                                                    )
                                                                )
                                                                + " "
                                                            )
                                                            + (
                                                                "null"
                                                                if x is None
                                                                else x
                                                            )
                                                        )
                                                        + " "
                                                    )
                                                    + ("null" if y is None else y)
                                                )
                                                + " "
                                            )
                                            + func2(
                                                (("null" if ((y is None)) else str(y)))
                                            )
                                        )
                                        + " "
                                    )
                                    + ("null" if y is None else y)
                                )
                                + " => "
                            )
                            + str(z1)
                        )
                        + " "
                    )
                    + str(z2)
                )
                + " "
            )
            + str(type(z1))
        )
    )


x: (((((((((((((() -> None) -> None) -> None) -> None) -> None) -> None) -> None) -> None) -> None) -> None) -> None) -> None) -> None)
