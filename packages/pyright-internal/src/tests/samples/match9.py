# This sample tests class-based pattern matching when the class is
# marked final and can be discriminated based on the argument patterns.

from typing import Union, final


class A:
    title: str

class B:
    name: str

class C:
    name: str

def func1(r: Union[A, B, C]):
    match r:
        case object(title=_):
            reveal_type(r, expected_text='A | B | C')

        case object(name=_):
            reveal_type(r, expected_text='A | B | C')

        case _:
            reveal_type(r, expected_text='A | B | C')

@final
class AFinal:
    title: str

@final
class BFinal:
    name: str

@final
class CFinal:
    name: str

def func2(r: Union[AFinal, BFinal, CFinal]):
    match r:
        case object(title=_):
            reveal_type(r, expected_text='AFinal')

        case object(name=_):
            reveal_type(r, expected_text='BFinal | CFinal')

        case _:
            reveal_type(r, expected_text='AFinal | BFinal | CFinal')
