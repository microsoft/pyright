# This sample tests the "reportPrivateUsage" feature.


class _TestClass(object):
    pass


class TestClass(object):
    def __init__(self):
        self.__priv1 = 1
        self._prot1 = 1
