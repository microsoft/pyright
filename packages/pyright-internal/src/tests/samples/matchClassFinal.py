# pyright: reportMatchNotExhaustive=true

from typing import final

class Base:
    pass

@final
class A1(Base):
    pass

@final
class B1(Base):
    pass

class NS1:
    A1 = A1
    B1 = B1

def exhaustive_final(inst: A1 | B1):
    match type(inst):
        case NS1.A1:
            pass
        case NS1.B1:
            pass

class A2(Base):
    pass

class B2(Base):
    pass

class NS2:
    A2 = A2
    B2 = B2

def non_exhaustive_non_final(inst: A2 | B2):
    match type(inst):
        case NS2.A2:
            pass
        case NS2.B2:
            pass
