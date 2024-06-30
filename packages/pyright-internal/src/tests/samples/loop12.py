# This sample tests the evaluation of a variable whose type is narrowed
# within a loop body.


class ClassA:
    def non_property(self) -> int: ...

    def do_stuff(self, x: int | None):
        while True:
            if x is not None:
                a = x
            else:
                a = self.non_property

            # This should generate an error because the type of "a"
            # is not compatible with a "-" operator.
            _ = a - 0
