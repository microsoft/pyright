from setuptools.dist import Distribution

from .._distutils.command import upload as orig

class upload(orig.upload):
    distribution: Distribution  # override distutils.dist.Distribution with setuptools.dist.Distribution
    def run(self) -> None: ...
