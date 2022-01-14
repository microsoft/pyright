# This sample tests the reportMissingSuperCall diagnostic check.


class ParentA:
    def __init__(self):
        pass

    def __init_subclass__(cls) -> None:
        pass


class ParentB:
    def __init__(self):
        pass


class ParentBPrime(ParentB):
    pass


class ParentC:
    pass


class ChildA(ParentA, ParentB):
    # This should generate two errors.
    def __init__(self):
        pass

    # This should generate one error.
    def __init_subclass__(cls) -> None:
        pass


class ChildB(ParentA, ParentB):
    # This should generate one error.
    def __init__(self):
        super().__init__()


class ChildC1(ParentA, ParentB):
    def __init__(self):
        super().__init__()
        ParentB.__init__(self)


class ChildC2(ParentA, ParentB):
    def __init__(self):
        ParentA.__init__(self)
        ParentB.__init__(self)


class ChildCPrime(ParentA, ParentBPrime, ParentC):
    def __init__(self):
        super().__init__()
        super(ParentBPrime).__init__()


class ChildD(ParentC):
    def __init__(self):
        pass
