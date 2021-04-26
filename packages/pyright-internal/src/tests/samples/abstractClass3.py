# This sample tests the checks for abstract method
# overrides. They depend on the order of the subclasses.

import abc


class MixinA(abc.ABC):
    pass


class MixinB(abc.ABC):
    def get_model(self):
        print("MixinB.get_model")


class MixinC(abc.ABC):
    @abc.abstractmethod
    def get_model(self):
        pass

    def use_model(self):
        print("MixinC.get_model")


class Trainer_1a(MixinA, MixinB, MixinC):
    pass


# This should not generate an error
trainer = Trainer_1a()
