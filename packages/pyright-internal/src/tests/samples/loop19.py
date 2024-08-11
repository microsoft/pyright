# This sample tests a loop that references instance variables.


class Results:
    zzz: int


class Foo:
    yyy: int

    def method1(self, results: list[Results]):
        abc = None
        for result in results:
            if abc is not None and abc.zzz < result.zzz:
                abc = result
