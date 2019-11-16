# This test validates that a circular base class reference
# will be reported and won't crash the analyzer.

# This should generate an error
# 'Bar' is not bound
class Bar(Bar):
    pass


# This should generate an error
# 'ClassB' is not bound
class ClassA(ClassB):
    pass

class ClassB(ClassA):
    pass


 