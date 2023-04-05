from _typeshed import Unused

from pyasn1.codec.ber import decoder
from pyasn1.type import univ
from pyasn1.type.tag import TagSet

class BooleanDecoder(decoder.AbstractSimpleDecoder):
    protoComponent: univ.Boolean
    def valueDecoder(
        self,
        substrate,
        asn1Spec,
        tagSet: TagSet | None = None,
        length: int | None = None,
        state: Unused = None,
        decodeFun: Unused = None,
        substrateFun: Unused = None,
        **options,
    ): ...

BitStringDecoder = decoder.BitStringDecoder
OctetStringDecoder = decoder.OctetStringDecoder
RealDecoder = decoder.RealDecoder

class Decoder(decoder.Decoder): ...

decode: Decoder
