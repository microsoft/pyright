# This sample tests a difficult set of circular dependencies
# between untyped variables.


class ClassA:
    def method1(self, param1):
        return ClassA()

    def method2(self):
        return {}, {}

    def method3(self, param3):
        while True:
            for key in param3.keys():
                foo1 = self.method1({key: None})
                var1, var2 = foo1.method2()

                if len(var1) < 2:
                    param3 = var2
                    break

                foo2 = foo1.method1({})
                var1, var2 = foo2.method2()
            else:
                break
