import unittest.mock
from typing import Any, Callable, Optional, TypeVar, Union, overload

from ._version import version as version

_T = TypeVar("_T")
_MockModule = Any  # usually unittest.mock
_Config = Any  # pytest.Config

__version__ = version

def _get_mock_module(config: _Config) -> _MockModule: ...

class MockFixture:
    mock_module: _MockModule
    patch: MockFixture._Patcher  # google/pytype#611
    Mock = unittest.mock.Mock
    MagicMock = unittest.mock.MagicMock
    NonCallableMock = unittest.mock.NonCallableMock
    PropertyMock = unittest.mock.PropertyMock
    call = unittest.mock.call
    ANY = unittest.mock.ANY
    DEFAULT = unittest.mock.DEFAULT
    create_autospec = unittest.mock.create_autospec
    sentinel = unittest.mock.sentinel
    mock_open = unittest.mock.mock_open
    def __init__(self, config: _Config) -> None: ...
    def resetall(self) -> None: ...
    def stopall(self) -> None: ...
    def spy(self, obj: object, name: str) -> unittest.mock.MagicMock: ...
    def stub(self, name: Optional[str] = ...) -> unittest.mock.MagicMock: ...
    class _Patcher:
        mock_module: _MockModule
        def object(
            self,
            target: Any,
            attribute: str,
            new: Optional[Any] = ...,
            spec: Optional[Any] = ...,
            create: bool = ...,
            spec_set: Optional[Any] = ...,
            autospec: Optional[Any] = ...,
            new_callable: Optional[Any] = ...,
            **kwargs: Any,
        ) -> Any: ...
        def multiple(
            self,
            target: Any,
            spec: Optional[Any] = ...,
            create: bool = ...,
            spec_set: Optional[Any] = ...,
            autospec: Optional[Any] = ...,
            new_callable: Optional[Any] = ...,
            **kwargs: Any,
        ) -> Any: ...
        def dict(self, in_dict: Any, values: Any = ..., clear: bool = ..., **kwargs: Any) -> Any: ...
        @overload
        def __call__(
            self,
            target: Any,
            new: None = ...,
            spec: Optional[Any] = ...,
            create: bool = ...,
            spec_set: Optional[Any] = ...,
            autospec: Optional[Any] = ...,
            new_callable: Optional[Any] = ...,
            **kwargs: Any,
        ) -> unittest.mock.MagicMock: ...
        @overload
        def __call__(
            self,
            target: Any,
            new: _T,
            spec: Optional[Any] = ...,
            create: bool = ...,
            spec_set: Optional[Any] = ...,
            autospec: Optional[Any] = ...,
            new_callable: Optional[Any] = ...,
            **kwargs: Any,
        ) -> _T: ...

mocker: Any
class_mocker: Any
module_mocker: Any
package_mocker: Any
session_mocker: Any

def assert_wrapper(__wrapped_mock_method__: Callable[..., Any], *args: Any, **kwargs: Any) -> None: ...
def wrap_assert_not_called(*args: Any, **kwargs: Any) -> None: ...
def wrap_assert_called_with(*args: Any, **kwargs: Any) -> None: ...
def wrap_assert_called_once(*args: Any, **kwargs: Any) -> None: ...
def wrap_assert_called_once_with(*args: Any, **kwargs: Any) -> None: ...
def wrap_assert_has_calls(*args: Any, **kwargs: Any) -> None: ...
def wrap_assert_any_call(*args: Any, **kwargs: Any) -> None: ...
def wrap_assert_called(*args: Any, **kwargs: Any) -> None: ...
def wrap_assert_methods(config: _Config) -> None: ...
def unwrap_assert_methods() -> None: ...
def pytest_addoption(parser) -> None: ...
def parse_ini_boolean(value: Union[bool, str]) -> bool: ...
def pytest_configure(config: _Config) -> None: ...
