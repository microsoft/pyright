# This sample tests the handling of the zero-argument form of super()
# within a comprehension when the target Python version is older than 3.12.
# Prior to PEP 709, list, set, and dict comprehensions each executed in
# their own frame whose first argument was the implicit iterator.


class ClassA:
    def method1(self):
        pass


class ClassB(ClassA):
    def method2(self):
        # This should generate an error because a list comprehension
        # executes in its own frame prior to Python 3.12.
        [super().method1() for _ in [1]]

        # This should generate an error because a set comprehension
        # executes in its own frame prior to Python 3.12.
        {super().method1() for _ in [1]}

        # This should generate an error because a dict comprehension
        # executes in its own frame prior to Python 3.12.
        {0: super().method1() for _ in [1]}

        # This should generate an error because a generator expression
        # executes in its own frame.
        list(super().method1() for _ in [1])
