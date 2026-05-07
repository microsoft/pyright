export function generateRecursiveAliasCase(depth: number): string {
    const lines = ['from typing import TypeAlias', '', 'Alias0: TypeAlias = int', 'value0: Alias0 = 1'];

    for (let i = 1; i <= depth; i++) {
        lines.push(`Alias${i}: TypeAlias = list[Alias${i - 1}]`);
        lines.push(`value${i}: Alias${i} = [value${i - 1}]`);
    }

    lines.push('');
    lines.push(`def use_alias(value: Alias${depth}) -> Alias${depth}:`);
    lines.push('    return value');
    lines.push('');
    lines.push(`result = use_alias(value${depth})`);

    return `${lines.join('\n')}\n`;
}

export function generateOverloadUnionCrossProductCase(width: number): string {
    const lines = ['from typing import Literal, overload', '', ''];

    for (let left = 0; left < width; left++) {
        for (let right = 0; right < width; right++) {
            lines.push('@overload');
            lines.push(
                `def combine(left: Literal[${left}], right: Literal[${right}]) -> Literal[${left + right}]: ...`
            );
        }
    }

    lines.push('def combine(left: int, right: int) -> int:');
    lines.push('    return left + right');
    lines.push('');

    const union = Array.from({ length: width }, (_, index) => `Literal[${index}]`).join(' | ');
    lines.push(`def use(left: ${union}, right: ${union}) -> int:`);
    lines.push('    return combine(left, right)');
    lines.push('');
    lines.push('result = use(0, 1)');

    return `${lines.join('\n')}\n`;
}

export function generateProtocolMismatchCase(memberCount: number): string {
    const lines = ['from typing import Protocol', '', 'class Expected(Protocol):'];

    for (let i = 0; i < memberCount; i++) {
        lines.push(`    def member_${i}(self) -> int: ...`);
    }

    lines.push('');
    lines.push('class Candidate:');

    for (let i = 0; i < memberCount - 1; i++) {
        lines.push(`    def member_${i}(self) -> int:`);
        lines.push(`        return ${i}`);
    }

    lines.push('');
    lines.push('def consume(value: Expected) -> None:');
    lines.push('    pass');
    lines.push('');
    lines.push('consume(Candidate())');

    return `${lines.join('\n')}\n`;
}

export function generateGenericAliasChainCase(depth: number): string {
    const lines = [
        'from typing import Generic, TypeAlias, TypeVar',
        '',
        'T = TypeVar("T")',
        '',
        'class Box(Generic[T]):',
        '    def __init__(self, value: T) -> None:',
        '        self.value = value',
        '',
        'Alias0: TypeAlias = int',
        'value0: Alias0 = 1',
    ];

    for (let i = 1; i <= depth; i++) {
        lines.push(`Alias${i}: TypeAlias = Box[Alias${i - 1}]`);
        lines.push(`value${i}: Alias${i} = Box(value${i - 1})`);
    }

    lines.push('');
    lines.push(`def unwrap(value${depth}: Alias${depth}) -> Alias0:`);

    for (let i = depth; i > 0; i--) {
        lines.push(`    value${i - 1} = value${i}.value`);
    }

    lines.push('    return value0');
    lines.push('');
    lines.push(`result = unwrap(value${depth})`);

    return `${lines.join('\n')}\n`;
}

export function generateConstrainedTypeVarMatrixCase(width: number): string {
    const classNames = Array.from({ length: width }, (_, index) => `Item${index}`);
    const lines = ['from typing import TypeVar', ''];

    for (const className of classNames) {
        lines.push(`class ${className}:`);
        lines.push('    pass');
        lines.push('');
    }

    lines.push(`TItem = TypeVar("TItem", ${classNames.join(', ')})`);
    lines.push('');
    lines.push('def choose(left: TItem, right: TItem) -> TItem:');
    lines.push('    return left');
    lines.push('');

    for (let left = 0; left < width; left++) {
        for (let right = 0; right < width; right++) {
            lines.push(`value_${left}_${right} = choose(Item${left}(), Item${right}())`);
        }
    }

    return `${lines.join('\n')}\n`;
}

export function generateLiteralUnionMathCase(width: number): string {
    const literals = Array.from({ length: width }, (_, index) => `Literal[${index}]`);
    const lines = ['from typing import Literal', '', `Value = ${literals.join(' | ')}`, ''];

    lines.push('def bump(value: Value) -> int:');

    for (let i = 0; i < width - 1; i++) {
        const prefix = i === 0 ? 'if' : 'elif';
        lines.push(`    ${prefix} value == ${i}:`);
        lines.push(`        return value + ${i}`);
    }

    lines.push('    return value');
    lines.push('');
    lines.push('def combine(left: Value, right: Value) -> int:');
    lines.push('    return bump(left) + bump(right)');
    lines.push('');
    lines.push('result = combine(0, 1)');

    return `${lines.join('\n')}\n`;
}

export function generateTypedDictCase(keyCount: number): string {
    const lines = ['from typing import TypedDict', '', 'class Payload(TypedDict):'];

    for (let i = 0; i < keyCount; i++) {
        lines.push(`    key_${i}: int`);
    }

    lines.push('');
    lines.push('payload: Payload = {');

    for (let i = 0; i < keyCount; i++) {
        lines.push(`    "key_${i}": ${i},`);
    }

    lines.push('}');
    lines.push('');
    lines.push('def total(value: Payload) -> int:');
    lines.push('    return ' + Array.from({ length: keyCount }, (_, index) => `value["key_${index}"]`).join(' + '));
    lines.push('');
    lines.push('result = total(payload)');

    return `${lines.join('\n')}\n`;
}
