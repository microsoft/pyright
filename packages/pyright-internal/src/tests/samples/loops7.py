# This sample tests a difficult set of circular dependencies
# between untyped variables.


from typing import Optional


class Foo:
    name: Optional[str]

    def correct(self):
        if self.name is not None:
            for _ in []:
                self.name = self.name.replace("", "")
