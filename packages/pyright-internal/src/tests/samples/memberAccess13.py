# This sample tests a member access when the member is a class
# that inherits from Any.

from typing import Literal, Type
from unittest.mock import Mock


class MockProducer:
    produce: Type[Mock] = Mock


t1: Literal["Type[Mock]"] = reveal_type(MockProducer.produce)
t2: Literal["Type[Mock]"] = reveal_type(MockProducer().produce)


t3: Literal["Mock"] = reveal_type(MockProducer.produce())
t3: Literal["Mock"] = reveal_type(MockProducer().produce())
