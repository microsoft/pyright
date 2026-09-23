# pyright: strict

type JsonPrimitive = bool | int | float | str
type JsonElement = None | JsonPrimitive | JsonList | JsonObject
type JsonList = list[JsonElement]
type JsonObject = dict[str, JsonElement]


class JsonRpcRequest:
    method: str
    id: JsonElement | None


class JsonRpcResponse:
    @classmethod
    def failure(
        cls, id: JsonElement | None, code: int, message: str, data: JsonElement | None = None
    ) -> "JsonRpcResponse":
        return cls()


class InsufficientPrivilegesException(Exception):
    CODE: int = -32001


def dispatch(request: JsonRpcRequest) -> object | None:
    if request.method == 'm0':
        try:
            do_something_0()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm1':
        try:
            do_something_1()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm2':
        try:
            do_something_2()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm3':
        try:
            do_something_3()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm4':
        try:
            do_something_4()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm5':
        try:
            do_something_5()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm6':
        try:
            do_something_6()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm7':
        try:
            do_something_7()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm8':
        try:
            do_something_8()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm9':
        try:
            do_something_9()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm10':
        try:
            do_something_10()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm11':
        try:
            do_something_11()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm12':
        try:
            do_something_12()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm13':
        try:
            do_something_13()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm14':
        try:
            do_something_14()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm15':
        try:
            do_something_15()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm16':
        try:
            do_something_16()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm17':
        try:
            do_something_17()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm18':
        try:
            do_something_18()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm19':
        try:
            do_something_19()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm20':
        try:
            do_something_20()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm21':
        try:
            do_something_21()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm22':
        try:
            do_something_22()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm23':
        try:
            do_something_23()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm24':
        try:
            do_something_24()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm25':
        try:
            do_something_25()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm26':
        try:
            do_something_26()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm27':
        try:
            do_something_27()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm28':
        try:
            do_something_28()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm29':
        try:
            do_something_29()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm30':
        try:
            do_something_30()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm31':
        try:
            do_something_31()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    elif request.method == 'm32':
        try:
            do_something_32()
        except InsufficientPrivilegesException as _e:
            return JsonRpcResponse.failure(request.id, InsufficientPrivilegesException.CODE, str(_e))
        except Exception as _e:
            return JsonRpcResponse.failure(request.id, -32603, str(_e))
    return None


def do_something_0() -> None: ...
def do_something_1() -> None: ...
def do_something_2() -> None: ...
def do_something_3() -> None: ...
def do_something_4() -> None: ...
def do_something_5() -> None: ...
def do_something_6() -> None: ...
def do_something_7() -> None: ...
def do_something_8() -> None: ...
def do_something_9() -> None: ...
def do_something_10() -> None: ...
def do_something_11() -> None: ...
def do_something_12() -> None: ...
def do_something_13() -> None: ...
def do_something_14() -> None: ...
def do_something_15() -> None: ...
def do_something_16() -> None: ...
def do_something_17() -> None: ...
def do_something_18() -> None: ...
def do_something_19() -> None: ...
def do_something_20() -> None: ...
def do_something_21() -> None: ...
def do_something_22() -> None: ...
def do_something_23() -> None: ...
def do_something_24() -> None: ...
def do_something_25() -> None: ...
def do_something_26() -> None: ...
def do_something_27() -> None: ...
def do_something_28() -> None: ...
def do_something_29() -> None: ...
def do_something_30() -> None: ...
def do_something_31() -> None: ...
def do_something_32() -> None: ...
