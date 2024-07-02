# This sample tests type narrowing of subject expressions for
# match statements.


def func1(subj: int | dict[str, str] | tuple[int] | str, cond: bool):
    match subj:
        case 3 | "hi":
            reveal_type(subj, expected_text="Literal[3, 'hi']")
            return

        case int(y) if cond:
            reveal_type(subj, expected_text="int")
            return

        case int(y):
            reveal_type(subj, expected_text="int")
            return

        case int():
            reveal_type(subj, expected_text="Never")
            return

        case str(z):
            reveal_type(subj, expected_text="str")
            return

    reveal_type(subj, expected_text="dict[str, str] | tuple[int]")
    return subj


# This should generate an error because there is the potential
# for fall-through if the subject expression is a str.
def func2(subj: int | str) -> str:
    match subj:
        case int():
            return "int"

    reveal_type(subj, expected_text="str")


# This should generate an error because there is the potential
# for fall-through if the guard expressions are false.
def func3(subj: int | str) -> str:
    match subj:
        case str() if len(subj) > 0:
            return "str"

        case int() if subj < 0:
            return "int"

    reveal_type(subj, expected_text="int | str")


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
