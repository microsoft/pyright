# This test validates that a circular base class reference
# will be reported and won't crash the analyzer.

# This should generate three errors
# 'Bar' is not bound
# Class cannot derive from itself
class Bar(Bar):
    pass


# This should generate three errors
# 'ClassB' is not bound
# Class cannot derive from itself
class ClassA(ClassB):
    pass

class ClassB(ClassA):
    pass


