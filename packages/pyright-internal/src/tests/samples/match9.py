# This sample tests class-based pattern matching when the class is
# marked final and can be discriminated based on the argument patterns.

from typing import Literal, Union, final


class A:
    title: str

class B:
    name: str

class C:
    name: str

def func1(r: Union[A, B, C]):
    match r:
        case object(title=_):
            t1: Literal['A | B | C'] = reveal_type(r)

        case object(name=_):
            t2: Literal['A | B | C'] = reveal_type(r)

        case _:
            t3: Literal['A | B | C'] = reveal_type(r)

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
            t1: Literal['AFinal'] = reveal_type(r)

        case object(name=_):
            t2: Literal['BFinal | CFinal'] = reveal_type(r)

        case _:
            t3: Literal['AFinal | BFinal | CFinal'] = reveal_type(r)
