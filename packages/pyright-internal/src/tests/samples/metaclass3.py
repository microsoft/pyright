# This sample tests the detection of metaclass conflicts.


class Meta1(type):
    pass


class Meta2(type):
    pass


class Base1(metaclass=Meta1):
    pass


class Base2(metaclass=Meta2):
    pass


# This should generate an error because the two
# metaclasses conflict.
class Foobar1(Base1, Base2):
    pass


class Meta3(type):
    pass


class SubMeta3(Meta3):
    pass


class Base4(metaclass=Meta3):
    pass


class Base5(metaclass=SubMeta3):
    pass


class Foobar2(Base4, Base5):
    pass
