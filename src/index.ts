/**
 * Interface for a simple logger.
 */
export interface Logger {
  log: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string, error?: unknown) => void;
}

let logger: Logger = {
  log: (_message: string) => undefined,
  warn: (_message: string) => undefined,
  error: (message: string, error?: unknown) => {
    console.error(`[xhr-hook] ${message}`, error);
  },
};

/**
 * Set a custom logger for the library.
 */
export function setLogger(newLogger: Logger) {
  logger = newLogger;
}

/**
 * A hook function that can intercept XMLHttpRequests.
 * It receives a Request object and either:
 * - Returns a function that takes an AbortSignal and returns a Promise<Response> to handle the request.
 * - Returns undefined to ignore the request and delegate to the next hook or the original XMLHttpRequest.
 */
export type XhrHook = (
  xhr: Request,
) => ((abort: AbortSignal) => Promise<Response>) | undefined;

const hooks = new Map<string, XhrHook>();
const patchXhrKey = Symbol("xhrHookPatch");

type PatchedXMLHttpRequest = {
  [patchXhrKey]?: boolean;
} & typeof XMLHttpRequest;
class PatchedXMLHttpRequestInstance {
  abortController = new AbortController();
  method: string | undefined;
  url: string | undefined;
  headers: Record<string, string>;
  readyState: number | undefined;
  status: number | undefined;
  statusText: string | undefined;
  response: Response | undefined;
  responseBufferInternal?: Uint8Array | undefined;
  responseBuffer?: Uint8Array | undefined;
  responseUrl?: string | undefined;
}

const getPatchedXMLHttpRequest = (xhr: XMLHttpRequest) => {
  const xhrInstance = xhr as unknown as {
    [patchXhrKey]: PatchedXMLHttpRequestInstance;
  };
  if (!xhrInstance[patchXhrKey]) {
    xhrInstance[patchXhrKey] = new PatchedXMLHttpRequestInstance();
  }
  return xhrInstance[patchXhrKey];
};

function hookXhrIfNeeded() {
  const xhr = XMLHttpRequest as PatchedXMLHttpRequest;
  if (xhr[patchXhrKey]) {
    logger.warn("XMLHttpRequest is already hooked, skipping.");
    return;
  }

  logger.log("Hooking XMLHttpRequest");
  xhr[patchXhrKey] = true;
  patchGetter(xhr.prototype, "readyState", (thisArg, getOriginal) => {
    return getPatchedXMLHttpRequest(thisArg).readyState ?? getOriginal();
  });
  patchGetter(xhr.prototype, "status", (thisArg, getOriginal) => {
    return getPatchedXMLHttpRequest(thisArg).status ?? getOriginal();
  });
  patchGetter(xhr.prototype, "statusText", (thisArg, getOriginal) => {
    return getPatchedXMLHttpRequest(thisArg).statusText ?? getOriginal();
  });
  patchGetter(xhr.prototype, "response", (thisArg, getOriginal) => {
    const buffer = getPatchedXMLHttpRequest(thisArg).responseBuffer;
    if (!buffer) {
      return getOriginal();
    }
    try {
      switch (thisArg.responseType) {
        case "":
        case "text":
          return new TextDecoder().decode(buffer);
        case "arraybuffer":
          return buffer.buffer.slice(
            buffer.byteOffset,
            buffer.byteOffset + buffer.byteLength,
          );
        case "blob":
          return new Blob([buffer]);
        case "document": {
          const text = new TextDecoder().decode(buffer);
          return new DOMParser().parseFromString(text, "application/xml");
        }
        case "json": {
          const text = new TextDecoder().decode(buffer);
          return JSON.parse(text);
        }
        default:
          return null;
      }
    } catch {
      return null;
    }
  });
  patchGetter(xhr.prototype, "responseURL", (thisArg, getOriginal) => {
    return getPatchedXMLHttpRequest(thisArg).responseUrl ?? getOriginal();
  });
  patchGetter(xhr.prototype, "responseText", (thisArg, getOriginal) => {
    if (getPatchedXMLHttpRequest(thisArg).responseBufferInternal) {
      return new TextDecoder().decode(
        getPatchedXMLHttpRequest(thisArg).responseBufferInternal,
      );
    } else {
      return getOriginal();
    }
  });

  patchMethod(xhr.prototype, "open", (thisArg, target, ...args) => {
    const [method, url] = args;
    logger.log(
      `XMLHttpRequest open called with method: ${method}, url: ${url}`,
    );
    const patch = getPatchedXMLHttpRequest(thisArg);
    patch.abortController.abort(); // Abort any previous request
    patch.abortController = new AbortController();
    patch.method = method;
    patch.url = url.toString();
    patch.headers = {};

    return Reflect.apply(target, thisArg, args);
  });
  patchMethod(
    xhr.prototype,
    "setRequestHeader",
    (thisArg, target, name, value) => {
      const header = name as string;
      const val = value as string;
      const patch = getPatchedXMLHttpRequest(thisArg);
      patch.headers[header] = val;
      return Reflect.apply(target, thisArg, [name, value]);
    },
  );
  patchMethod(
    xhr.prototype,
    "send",
    (thisArg, target, body?: Document | BodyInit | null) => {
      const patch = getPatchedXMLHttpRequest(thisArg);
      const request = xhrToRequest(patch);
      for (const [name, hook] of hooks) {
        logger.log(`Calling hook "${name}"`);
        const responseCallback = hook(request);
        if (responseCallback) {
          logger.log(`Hook "${name}" is overriding the request.`);
          startXhrWithResponseCallback(thisArg, responseCallback);
          return;
        } else {
          logger.log(`Hook "${name}" did not return a response.`);
        }
      }

      logger.log(
        "No hooks returned a response, proceeding with original send.",
      );
      return Reflect.apply(target, thisArg, [body]);
    },
  );
  patchMethod(xhr.prototype, "abort", (thisArg, target) => {
    const patch = getPatchedXMLHttpRequest(thisArg);
    patch.abortController.abort();
    return Reflect.apply(target, thisArg, []);
  });
  patchMethod(xhr.prototype, "getAllResponseHeaders", (thisArg, target) => {
    const patch = getPatchedXMLHttpRequest(thisArg);
    if (patch.response) {
      return [...patch.response.headers.entries()]
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n");
    }
    return Reflect.apply(target, thisArg, []);
  });
}

function patchGetter<T, P extends keyof T>(
  obj: T,
  prop: P,
  getter: (thisArg: T, target: () => T[P]) => T[P] | undefined,
): void {
  const originalDescriptor = Object.getOwnPropertyDescriptor(obj, prop);
  if (!originalDescriptor?.get) {
    throw new Error(`Property "${String(prop)}" does not have a getter.`);
  }
  Object.defineProperty(obj, prop, {
    get() {
      const target = originalDescriptor.get;
      if (target) {
        return getter(this, target.bind(this));
      } else {
        logger.warn(`Property "${String(prop)}" does not have a getter.`);
        return undefined;
      }
    },
  });
}
type ParametersOrNever<T> = T extends (...args: infer P) => unknown ? P : never;
type ReturnTypeOrNever<T> = T extends (...args: never[]) => infer R ? R : never;

function patchMethod<T, P extends keyof T>(
  obj: T,
  prop: P,
  method: (
    thisArg: T,
    target: T[P],
    ...args: ParametersOrNever<T[P]>
  ) => ReturnTypeOrNever<T[P]>,
): void {
  const originalMethod = obj[prop];
  if (typeof originalMethod !== "function") {
    throw new Error(`Property "${String(prop)}" is not a method.`);
  }
  Object.defineProperty(obj, prop, {
    value: function (...args: ParametersOrNever<T[P]>) {
      return method(this, originalMethod, ...args);
    },
  });
}

function xhrToRequest(
  patch: PatchedXMLHttpRequestInstance,
  body?: BodyInit | null,
): Request {
  const url = new URL(patch.url || "", location.origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(patch.headers)) {
    headers.append(key, value);
  }
  return new Request(url.toString(), {
    method: patch.method,
    headers,
    body: body ?? null,
  });
}

async function startXhrWithResponseCallback(
  xhr: XMLHttpRequest,
  responseCallback: NonNullable<ReturnType<XhrHook>>,
) {
  const patch = getPatchedXMLHttpRequest(xhr);
  patch.readyState = 1; // OPENED
  logger.log(
    `Starting XMLHttpRequest with method: ${patch.method}, url: ${patch.url}`,
  );
  xhr.dispatchEvent(new Event("readystatechange"));
  try {
    const response = await responseCallback(patch.abortController.signal);
    patch.readyState = 2; // HEADERS_RECEIVED
    logger.log(
      `XMLHttpRequest received headers with status: ${response.status}`,
    );
    patch.status = response.status;
    patch.statusText = response.statusText;
    xhr.dispatchEvent(new Event("loadstart"));
    const buffer = new Uint8Array(
      response.headers.get("Content-Length")
        ? parseInt(ensureNotNullish(response.headers.get("Content-Length")), 10)
        : 1024 * 1024,
    );
    let offset = 0;
    const reader = response.body?.getReader();
    patch.response = response;
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          if (offset + value.length > buffer.length) {
            const newBuffer = new Uint8Array(
              (buffer.length + value.length) * 2,
            );
            newBuffer.set(buffer);
            patch.responseBufferInternal = newBuffer;
          } else {
            patch.responseBufferInternal = buffer;
          }
          patch.responseBufferInternal.set(value, offset);
          offset += value.length;
          patch.responseBuffer = patch.responseBufferInternal.subarray(
            0,
            offset,
          );
          patch.readyState = 3;
          logger.log(`XMLHttpRequest loading, received ${offset} bytes`);
          xhr.dispatchEvent(new Event("readystatechange"));
          xhr.dispatchEvent(new ProgressEvent("progress", { loaded: offset }));
        }
      }
    }
    patch.responseBufferInternal = patch.responseBufferInternal?.subarray(
      0,
      offset,
    );

    patch.readyState = 4; // DONE
    patch.responseUrl = response.url;
    logger.log(`Hook request completed with status: ${response.status}`);
    xhr.dispatchEvent(new Event("load"));
    xhr.dispatchEvent(new Event("readystatechange"));
    xhr.dispatchEvent(new Event("loadend"));
  } catch (error) {
    logger.error("XMLHttpRequest failed to start:", error);
    patch.readyState = 4; // DONE
    xhr.dispatchEvent(new Event("error"));
    xhr.dispatchEvent(new Event("readystatechange"));
    return;
  }
}

/**
 * Options for inserting an XHR hook.
 */
export type InsertXhrHookOptions = {
  /** What to do if a hook with the same name already exists. Default is to ignore. */
  onExists?: "replace" | "ignore" | "error";
};
/**
 * Insert a new XHR hook.
 * @param name A unique name for the hook.
 * @param hook The hook function.
 * @param options Options for inserting the hook.
 */
export function insertXhrHook(
  name: string,
  hook: XhrHook,
  options: InsertXhrHookOptions = {},
) {
  hookXhrIfNeeded();
  const computedOptions: InsertXhrHookOptions = {
    onExists: "ignore",
    ...options,
  };

  if (hooks.has(name)) {
    if (computedOptions.onExists === "error") {
      throw new Error(`Hook with name "${name}" already exists.`);
    } else if (computedOptions.onExists === "ignore") {
      logger.log(`Hook with name "${name}" already exists, ignoring insert.`);
      return;
    } else if (computedOptions.onExists === "replace") {
      logger.log(`Replacing existing hook "${name}"`);
    }
  } else {
    logger.log(`Inserting hook "${name}"`);
  }
  hooks.set(name, hook);
}

export function removeXhrHook(name: string): boolean {
  if (hooks.has(name)) {
    logger.log(`Removing hook "${name}"`);
    hooks.delete(name);
    return true;
  } else {
    logger.warn(`Hook with name "${name}" does not exist, ignoring remove.`);
    return false;
  }
}

function ensureNotNullish<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? "Value is null or undefined");
  }
  return value;
}
