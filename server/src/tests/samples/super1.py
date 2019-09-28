# This sample tests the type analyzer's handling of the super() call.

class FooBase():
    @staticmethod
    def ccc():
        pass

class Foo1(FooBase):
    def __init__(self):
        pass
    
    def hello1(self):
        pass

class Foo2(FooBase):
    def __init__(self):
        pass
    
    def hello2(self):
        return __class__()

    @staticmethod
    def aaa():
        pass

class Bar(Foo1, Foo2):
    def __init__(self):
        super().hello1()
        super().hello2()

        # This should generate an error
        super().goodbye()


super(Bar).aaa()

# This should generate an error
super(Bar).bbb()


super(Foo1, Bar).ccc()

# This should generate an error because Foo2
# is not a subclass of Foo1.
super(Foo1, Foo2).ccc()

bar = Bar()
super(Foo1, bar).ccc()

foo2 = Foo2()
# This should generate an error because Foo2
# is not a subclass of Foo1.
super(Foo1, foo2).ccc()





