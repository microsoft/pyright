from setuptools.dist import Distribution

from .._distutils.command import register as orig

class register(orig.register):
    distribution: Distribution  # override distutils.dist.Distribution with setuptools.dist.Distribution
    def run(self) -> None: ...
