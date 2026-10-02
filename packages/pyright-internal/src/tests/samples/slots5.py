# This sample tests that the runtime-managed __weakref__ slot does not need
# to be initialized, while ordinary slot and instance variables still do.

# pyright: reportUninitializedInstanceVariable=true

import weakref
from abc import ABC
from typing import final


class StringSlot:
    __slots__ = "__weakref__"


class TupleSlot:
    __slots__ = ("__weakref__",)


class ListSlot:
    __slots__ = ["__weakref__"]


class MappingSlot:
    __slots__ = {"__weakref__": "Weak reference support"}


class AnnotatedSlot:
    __slots__ = ("__weakref__",)
    __weakref__: weakref.ReferenceType[object] | None


class DictAndWeakrefSlots:
    __slots__ = ("__dict__", "__weakref__")


class MixedSlots:
    # This should generate one error for the uninitialized ordinary slot.
    __slots__ = ("__weakref__", "value")


class InitializedSlots:
    __slots__ = ("__weakref__", "value")

    def __init__(self) -> None:
        self.value = 1


class NonSlotVariable:
    __slots__ = ()

    # This should generate an error because this is not a slot declaration.
    __weakref__: int


class AbstractWeakrefSlot(ABC):
    __slots__ = ("__weakref__",)


@final
class ConcreteWeakrefSlot(AbstractWeakrefSlot):
    __slots__ = ()


class AbstractMixedSlots(ABC):
    __slots__ = ("__weakref__", "value")


@final
# This should generate one error for the uninitialized ordinary slot.
class IncompleteConcrete(AbstractMixedSlots):
    __slots__ = ()


@final
class CompleteConcrete(AbstractMixedSlots):
    __slots__ = ()

    def __init__(self) -> None:
        self.value = 1


weakref.ref(StringSlot())
weakref.ref(TupleSlot())
weakref.ref(ListSlot())
weakref.ref(MappingSlot())
weakref.ref(InitializedSlots())
weakref.ref(AnnotatedSlot())
weakref.ref(DictAndWeakrefSlots())
weakref.ref(ConcreteWeakrefSlot())
weakref.ref(CompleteConcrete())
reveal_type(InitializedSlots().value, expected_text="int")
reveal_type(CompleteConcrete().value, expected_text="int")
