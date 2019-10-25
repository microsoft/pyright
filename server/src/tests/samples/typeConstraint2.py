# This sample exercises the type analyzer's isintance type constraint logic.

from collections import defaultdict
from typing import DefaultDict, Optional, Type, Union, Any

class UnrelatedClass:
    class_var1: int
    def __init__(self) -> None:
        self.property: None = None

class UnrelatedSubclass(UnrelatedClass):
    def __init__(self) -> None:
        self.property2: None = None

class SuperClass:
    class_var1: int
    def __init__(self) -> None:
        self.property: None = None

class MyClass1(SuperClass):
    class_var2: int
    def __init__(self) -> None:
        self.property2: None = None

class MyClass2(SuperClass):
    def __init__(self) -> None:
        self.property2: None = None

def f(instance: Union[SuperClass, UnrelatedClass]) -> None:
    if isinstance(instance, (MyClass1, UnrelatedSubclass, Any)):
        print(instance.property)
        
        # This should generate two errors:
        # 'property2' is not a known member of 'SuperClass'
        # 'property2' is not a known member of 'UnrelatedClass'
        print(instance.property2)
    else: 
        print(instance.property)

        # This should generate two errors:
        # 'property2' is not a known member of 'SuperClass'
        # 'property2' is not a known member of 'UnrelatedClass'
        print(instance.property2)

def g(cls: Union[Type[SuperClass], Type[UnrelatedClass]]) -> None:
    if issubclass(cls, (MyClass1, UnrelatedSubclass, Any)):
        print(cls.class_var1)
        
        # This should generate two errors:
        # 'property2' is not a known member of 'SuperClass'
        # 'property2' is not a known member of 'UnrelatedClass'
        print(cls.class_var2)
    else: 
        print(cls.class_var1)

        # This should generate two errors:
        # 'property2' is not a known member of 'SuperClass'
        # 'property2' is not a known member of 'UnrelatedClass'
        print(cls.class_var2)


# This code should analyze without any errors.
class TestClass1:
    def __init__(self) -> None:
        self.property = True

class TestClass2(TestClass1):
    pass

def function(instance: TestClass2) -> None:
    # Although it's redundant for code to check for either
    # TestClass1 or TestClass2, the analyzer should be fine with it.
    if isinstance(instance, TestClass2):
        print(instance.property)

    if isinstance(instance, TestClass1):
        print(instance.property)

