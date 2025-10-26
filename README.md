# xhr-hook

[![npm version](https://img.shields.io/npm/v/%40sevenc-nanashi%2Fxhr-hook.svg)](https://www.npmjs.com/package/@sevenc-nanashi/xhr-hook)
[![jsDocs.io](https://img.shields.io/badge/jsDocs.io-reference-blue)](https://www.jsdocs.io/package/@sevenc-nanashi/xhr-hook)

A library to intercept and modify `XMLHttpRequest`s.

## Installation

```bash
pnpm install xhr-hook
```

## Usage

```typescript
import { insertXhrHook, removeXhrHook } from "xhr-hook";

// Insert a hook
insertXhrHook("my-hook", (request) => {
  console.log("Intercepted request:", request);
  // To override the request, return a function that returns a Promise<Response>
  if (request.url.includes("example.com")) {
    return async (abortSignal) => {
      const response = new Response("Hello from the hook!", { status: 200 });
      return response;
    };
  }
  // To ignore the request, return undefined
  return undefined;
});

// Remove the hook
removeXhrHook("my-hook");
```

## API

### `insertXhrHook(name: string, hook: XhrHook, options?: InsertXhrHookOptions)`

Inserts a new XHR hook.

- `name`: A unique name for the hook.
- `hook`: The hook function.
- `options`: Options for inserting the hook.

#### `XhrHook`

A function that takes a `Request` object and returns either a function that returns a `Promise<Response>` to handle the request, or `undefined` to ignore the request.

#### `InsertXhrHookOptions`

- `onExists`: What to do if a hook with the same name already exists. Default is to `ignore`.
  - `'replace'`: Replace the existing hook.
  - `'ignore'`: Ignore the new hook.
  - `'error'`: Throw an error.

### `removeXhrHook(name: string): boolean`

Removes an XHR hook.

- `name`: The name of the hook to remove.

Returns `true` if the hook was removed, `false` otherwise.

### `setLogger(logger: Logger)`

Sets a custom logger for the library.

#### `Logger`

An interface for a simple logger.

```typescript
export interface Logger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}
```

## Development

- `pnpm install`: Install dependencies
- `pnpm test`: Run tests
- `pnpm lint`: Run linter

## License

ISC

