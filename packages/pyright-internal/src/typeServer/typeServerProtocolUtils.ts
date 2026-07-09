import { TypeServerProtocol } from './protocol/typeServerProtocol';

export function isTypeFlagSet(flags: TypeServerProtocol.TypeFlags, flag: TypeServerProtocol.TypeFlags): boolean {
    return (flags & flag) === flag;
}
