# This sample tests the type analyzer's type narrowing logic
# relating to break and continue statements and while test expressions.

from typing import List, Optional

def only_int(a: int):
    return a < 3

def test_break():
    foo1 = None
    while True:
        if foo1 is None:
            foo1 = 5
            break
        else:
            foo1 = 'hello'

    # This should not generate an error because foo1
    # can only be an int type at this point.
    only_int(foo1)


def test_continue():
    bar1 = 1
    my_list: List[Optional[int]] = [None, 3, 5]
    for n in my_list:
        if n is None:
            continue
        bar1 = n

    # This should not generate an error because bar1
    # can only be an int type at this point.
    only_int(bar1)


def test_while_condition():
    param = 3

    # This should generate an error because param
    # can be a str type at this point.
    while only_int(param):
        if param:
            break
        else:
            param = 'hello'


 
 