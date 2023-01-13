from typing_extensions import TypeAlias

from pyasn1.codec.ber import decoder
from pyasn1.type import univ
from pyasn1.type.tag import TagSet

_Unused: TypeAlias = object

class BooleanDecoder(decoder.AbstractSimpleDecoder):
    protoComponent: univ.Boolean
    def valueDecoder(
        self,
        substrate,
        asn1Spec,
        tagSet: TagSet | None = ...,
        length: int | None = ...,
        state: _Unused = ...,
        decodeFun: _Unused = ...,
        substrateFun: _Unused = ...,
        **options,
    ): ...

BitStringDecoder = decoder.BitStringDecoder
OctetStringDecoder = decoder.OctetStringDecoder
RealDecoder = decoder.RealDecoder

class Decoder(decoder.Decoder): ...

decode: Decoder
