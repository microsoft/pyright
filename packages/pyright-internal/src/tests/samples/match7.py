# This sample tests type narrowing of subject expressions for
# match statements.

from typing import Literal


def func1(subj: int | dict[str, str] | tuple[int] | str, cond: bool):
    match subj:
        case (3 | "hi"):
            t_v1: Literal["Literal[3, 'hi']"] = reveal_type(subj)
            return

        case int(y) if cond:
            t_v2: Literal["int"] = reveal_type(subj)
            return

        case int(y):
            t_v3: Literal["int"] = reveal_type(subj)
            return

        case int():
            t_v4: Literal["Never"] = reveal_type(subj)
            return

        case str(z):
            t_v5: Literal["str"] = reveal_type(subj)
            return

        case z:
            t_v6: Literal["dict[str, str] | tuple[int]"] = reveal_type(subj)
            return

    return subj

