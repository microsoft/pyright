export {};

declare global {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    interface Promise<T> {
        ignoreErrors(): void;
    }
}
