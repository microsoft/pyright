# This sample is similar to pseudoGeneric2.py in that it tests
# the case where the class's constructor is unannotated. This
# particular case was causing an internal crash.

import abc


class ClassB(metaclass=abc.ABCMeta):
    def __init__(self, value=None):
        self._cache = {"value": value}

    @property
    def cache(self):
        return self._cache

    @cache.deleter
    def cache(self):
        self._cache = {key: None for key in self._cache}

    def __getattr__(self, attr):
        cache = self.cache
        if attr in cache:
            return cache[attr]
        else:
            return self.__getattribute__(attr)


b1 = ClassB("test")
reveal_type(b1.value, expected_text="Unknown | Any | None")
del b1.cache
