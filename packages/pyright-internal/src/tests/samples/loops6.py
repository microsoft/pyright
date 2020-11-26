# This sample tests a difficult set of circular dependencies
# between untyped variables.


class Foo:
    def new_from_dict(self, param1):
        return Foo()

    def method1(self):
        return {}, {}

    def method3(self, param3):
        while True:
            for key in param3.keys():
                foo1 = self.new_from_dict({key: None})
                var1, var2 = foo1.method1()

                if len(var1) < 2:
                    param3 = var2
                    break

                foo2 = foo1.new_from_dict({})
                var1, var2 = foo2.method1()
            else:
                break

