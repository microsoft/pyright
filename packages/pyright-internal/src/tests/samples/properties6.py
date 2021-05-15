# This sample tests the reportPropertyTypeMismatch diagnostic rule.

from typing import Generic, List, Optional, TypeVar

_T = TypeVar("_T")


class ClassA(Generic[_T]):
    @property
    def prop_1(self) -> Optional[float]:
        return 2

    @prop_1.setter
    def prop_1(self, value: int) -> None:
        pass

    @property
    def prop_2(self) -> Optional[int]:
        return 2

    # This should generate an error because a float
    # is not assignable to an Optional[int].
    @prop_2.setter
    def prop_2(self, value: float) -> None:
        pass

    @property
    def prop_3(self) -> List[_T]:
        return []

    # This should generate an error because _T is
    # not assignable to List[_T].
    @prop_3.setter
    def prop_3(self, value: _T) -> None:
        pass
