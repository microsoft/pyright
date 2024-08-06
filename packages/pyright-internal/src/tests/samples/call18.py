# This sample tests the handling of keyword argument shortcuts introduced
# in PEP 736.

def func1(val1: float, val2: int, val3: int):
    return 1

def func2(val1: int, val2: int):
    func1(val1=, val2=, val3=1)


 