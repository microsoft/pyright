# This sample tests the analyzer's ability to handle inherited
# data classes.

from dataclasses import dataclass


class C1:
    ...


class C2:
    ...


class C3:
    ...


@dataclass
class DC1:
    aa: C1
    bb: C2
    cc: C3


class NonDC2:
    ff: int


@dataclass
class DC2(NonDC2, DC1):
    ee: C2
    aa: C2
    dd: C2


dc2_1 = DC2(C2(), C2(), C3(), C2(), C2())

# This should generate an error because the type
# of parameter aa has been replaced with type C1.
dc2_2 = DC2(C1(), C2(), C3(), C2(), C2())

dc2_3 = DC2(ee=C2(), dd=C2(), aa=C2(), bb=C2(), cc=C3())


@dataclass
class DC3:
    aa: C1
    bb: C2 = C2()
    cc: C3 = C3()


@dataclass
class DC4(DC3):
    # This should generate an error because
    # previous parameters have default values.
    dd: C1


@dataclass
class DC5(DC3):
    # This should not generate an error because
    # aa replaces aa in DC3, and it's ordered
    # before the params with default values.
    aa: C2
