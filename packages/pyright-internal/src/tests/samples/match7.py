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

    t_v6: Literal["dict[str, str] | tuple[int]"] = reveal_type(subj)
    return subj


# This should generate an error because there is the potential
# for fall-through if the subject expression is a str.
def func2(subj: int | str) -> str:
    match subj:
        case int():
            return "int"
    
    t_v1: Literal['str'] = reveal_type(subj)


# This should generate an error because there is the potential
# for fall-through if the guard expressions are false.
def func3(subj: int | str) -> str:
    match subj:
        case str() if len(subj) > 0:
            return "str"

        case int() if subj < 0:
            return "int"
    
    t_v1: Literal['int | str'] = reveal_type(subj)


def func4(subj: int | str) -> str:
    match subj:
        case int():
            return "int"

        case str():
            return "str"
        
        case _:
            # This should be ignored because the pattern has already
            # been exhaustively matched.
            pass
