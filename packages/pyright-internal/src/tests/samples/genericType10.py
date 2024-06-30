# This sample tests the case where a bound TypeVar is bound to a
# class method.

from typing import Any, Mapping, Type, TypeVar

_Configuration = TypeVar("_Configuration", bound="Configuration")


class Configuration:
    @classmethod
    def _create(
        cls: Type[_Configuration], data: Mapping[str, Any]
    ) -> _Configuration: ...

    @classmethod
    def _from_dict(
        cls: Type[_Configuration], data: Mapping[str, Any]
    ) -> _Configuration:
        return cls._create({})
