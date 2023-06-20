# This sample tests the type analyzer's type narrowing logic
# relating to break and continue statements and while test expressions.


def only_int(a: int):
    return a < 3


def test_break():
    val1 = None
    while True:
        if val1 is None:
            val1 = 5
            break
        else:
            val1 = "hello"

    reveal_type(val1, expected_text="Literal[5]")


def test_continue():
    bar1 = 1
    my_list: list[int | None] = [None, 3, 5]
    for n in my_list:
        if n is None:
            continue
        bar1 = n

    only_int(bar1)


def test_while_condition():
    param = 3

    # This should generate an error because param
    # can be a str type at this point.
    while only_int(param):
        if param:
            break
        else:
            param = "hello"
