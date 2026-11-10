# This sample tests type inference through a raw staticmethod initializer map.

from typing import assert_type


class Info:
    bits: int = 8


class Finfo(Info):
    @staticmethod
    def make():
        return Info()

    _map = {"small": make}
    _cache = {key: init.__func__() for key, init in _map.items()}

    def __new__(cls, key: str):
        value = cls._cache.get(key)
        if value is not None:
            return value
        return super().__new__(cls)


assert_type(Finfo("small").bits, int)


def vector_size(is_integer: bool, vec_size: int | None = None):
    if is_integer:
        if vec_size is None:
            vec_size = 1
        elif vec_size != 1:
            raise ValueError
    elif vec_size is None:
        dtype_bits = Finfo("small").bits
        assert_type(dtype_bits, int)
        max_vec_size = 128 // dtype_bits
        vec_size = 32 // dtype_bits
        while vec_size * 2 <= max_vec_size:
            vec_size *= 2
    assert_type(vec_size, int)
    if 128 % vec_size:
        raise ValueError
    return 128 * vec_size


assert_type(vector_size(False), int)


def negative(is_integer: bool, vec_size: int | None = None):
    if is_integer:
        vec_size = 1
    return 128 * vec_size  # The unassigned None path must still be rejected.
