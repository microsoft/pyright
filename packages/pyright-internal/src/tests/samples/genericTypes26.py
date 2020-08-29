# This sample is similar to genericTypes20.py in that it tests
# the case where the class's constructor is unannotated. This
# particular case was causing an internal crash.

import abc


class MyClass(metaclass=abc.ABCMeta):
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


my_class = MyClass("test")
print(my_class.value)
del my_class.cache
print(my_class.value)

