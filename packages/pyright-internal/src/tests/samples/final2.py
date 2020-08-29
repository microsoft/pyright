# This sample tests the handling of the @final method decorator.

from typing import final

class ClassA:
    def func1(self):
        pass
    
    @classmethod
    def func2(cls):
        pass

    @final
    def func3(self):
        pass
    
    @final
    @classmethod
    def func4(cls):
        pass

class ClassB(ClassA):
    def func1(self):
        pass
    
    @classmethod
    def func2(cls):
        pass

    # THis should generate an error because func3 is
    # defined as final.
    def func3(self):
        pass
    
    # THis should generate an error because func4 is
    # defined as final.
    @classmethod
    def func4(cls):
        pass
