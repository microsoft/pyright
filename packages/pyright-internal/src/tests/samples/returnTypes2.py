# This sample tests the case where return type inference encounters
# recursion.


class Grammar:
    @staticmethod
    def A():
        return Grammar.B

    @staticmethod
    def B():
        return Grammar.C

    @staticmethod
    def C():
        return Grammar.D

    @staticmethod
    def D():
        return Grammar.E

    @staticmethod
    def E():
        return Grammar.F

    @staticmethod
    def F():
        return Grammar.G

    @staticmethod
    def G():
        return Grammar.H

    @staticmethod
    def H():
        return Grammar.I

    @staticmethod
    def I():
        return Grammar.J

    @staticmethod
    def J():
        return Grammar.K

    @staticmethod
    def K():
        return Grammar.L

    @staticmethod
    def L():
        return Grammar.B


async def func1(a):
    if a == 0:
        return
    r = await func1(a - 1)
    return r
