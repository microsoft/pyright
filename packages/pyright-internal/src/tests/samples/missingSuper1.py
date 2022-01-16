# This sample tests the reportMissingSuperCall diagnostic check.

from typing import final


class ParentA:
    pass


class ParentB:
    # This should generate an error because it's missing a super().__init__ call.
    def __init__(self):
        pass


class ParentBPrime(ParentB):
    pass


class ParentC:
    pass


@final
class ParentD:
    def __init__(self):
        pass

    def __init_subclass__(cls) -> None:
        pass


class ChildA(ParentA, ParentB):
    # This should generate an error.
    def __init__(self):
        pass

    # This should generate an error.
    def __init_subclass__(cls) -> None:
        pass


class ChildB(ParentA, ParentB):
    def __init__(self):
        super().__init__()


class ChildC1(ParentA, ParentB):
    def __init__(self):
        ParentB.__init__(self)


class ChildC2(ParentA, ParentB):
    def __init__(self):
        ParentA.__init__(self)
        ParentB.__init__(self)


class ChildCPrime(ParentA, ParentBPrime, ParentC):
    def __init__(self):
        super(ParentBPrime).__init__()


class ChildD(ParentC):
    # This should generate an error.
    def __init__(self):
        pass


@final
class ChildE(ParentC):
    def __init__(self):
        pass
