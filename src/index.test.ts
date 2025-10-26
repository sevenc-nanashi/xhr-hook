import { describe, it, expect, beforeEach } from "vitest";
import { insertXhrHook, removeXhrHook, setLogger } from "./index";

describe("xhr-hook", () => {
  let hooked = false;

  beforeEach(() => {
    hooked = false;
    // This is not ideal, but for now we remove the hook after each test.
    // A better approach would be to have a way to clear all hooks.
    try {
      removeXhrHook("test");
    } catch (e) {
      // ignore
    }
  });

  it("should intercept an XHR request", async () => {
    const hook = (_xhr: Request) => {
      hooked = true;
      return undefined; // Don't override the request
    };

    insertXhrHook("test", hook);

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com");
    xhr.send();

    // Give the hook a moment to be called
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(hooked).toBe(true);
  });

  it("should remove a hook", async () => {
    const hook = (_xhr: Request) => {
      hooked = true;
      return undefined; // Don't override the request
    };

    insertXhrHook("test", hook);
    removeXhrHook("test");

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com");
    xhr.send();

    // Give the hook a moment to be called
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(hooked).toBe(false);
  });

  it("should call multiple hooks", async () => {
    let hook1Called = false;
    let hook2Called = false;

    const hook1 = (_xhr: Request) => {
      hook1Called = true;
      return undefined;
    };

    const hook2 = (_xhr: Request) => {
      hook2Called = true;
      return undefined;
    };

    insertXhrHook("test1", hook1);
    insertXhrHook("test2", hook2);

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com");
    xhr.send();

    // Give the hooks a moment to be called
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(hook1Called).toBe(true);
    expect(hook2Called).toBe(true);

    removeXhrHook("test1");
    removeXhrHook("test2");
  });

  it("should replace a hook", async () => {
    let hook1Called = false;
    let hook2Called = false;

    const hook1 = (_xhr: Request) => {
      hook1Called = true;
      return undefined;
    };

    const hook2 = (_xhr: Request) => {
      hook2Called = true;
      return undefined;
    };

    insertXhrHook("test", hook1);
    insertXhrHook("test", hook2, { onExists: "replace" });

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com");
    xhr.send();

    // Give the hooks a moment to be called
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(hook1Called).toBe(false);
    expect(hook2Called).toBe(true);
  });

  it("should throw an error when a hook already exists", () => {
    const hook = (_xhr: Request) => undefined;

    insertXhrHook("test", hook);

    expect(() => {
      insertXhrHook("test", hook, { onExists: "error" });
    }).toThrowError('Hook with name "test" already exists.');
  });

  it("should ignore inserting a hook when it already exists", async () => {
    let hook1Called = false;
    let hook2Called = false;

    const hook1 = (_xhr: Request) => {
      hook1Called = true;
      return undefined;
    };

    const hook2 = (_xhr: Request) => {
      hook2Called = true;
      return undefined;
    };

    insertXhrHook("test", hook1);
    insertXhrHook("test", hook2, { onExists: "ignore" });

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com");
    xhr.send();

    // Give the hooks a moment to be called
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(hook1Called).toBe(true);
    expect(hook2Called).toBe(false);
  });

  it("should override the response", async () => {
    const hook = (_xhr: Request) => {
      return (_abort: AbortSignal) => {
        return new Promise<Response>((resolve) => {
          resolve(
            new Response("Hello from the hook!", {
              status: 201,
              statusText: "Created",
            }),
          );
        });
      };
    };

    insertXhrHook("test", hook);

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com");

    await new Promise<void>((resolve) => {
      xhr.onload = () => {
        expect(xhr.responseText).toBe("Hello from the hook!");
        expect(xhr.status).toBe(201);
        resolve();
      };
      xhr.send();
    });
  });

  it("should set a custom logger", () => {
    let logMessage = "";
    const customLogger = {
      log: (message: string) => {
        logMessage = message;
      },
      warn: (_message: string) => {},
      error: (_message: string, _error?: unknown) => {},
    };

    setLogger(customLogger);

    const hook = (_xhr: Request) => undefined;
    insertXhrHook("test-logger", hook);

    expect(logMessage).toBe('Inserting hook "test-logger"');

    // Reset logger for other tests
    setLogger({
      log: (_message: string) => undefined,
      warn: (_message: string) => undefined,
      error: (message: string, error?: unknown) => {
        console.error(`[xhr-hook] ${message}`, error);
      },
    });
  });

  it("should handle json responseType", async () => {
    const hook = (_xhr: Request) => {
      return (_abort: AbortSignal) => {
        return new Promise<Response>((resolve) => {
          resolve(
            new Response(JSON.stringify({ message: "Hello" }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        });
      };
    };

    insertXhrHook("test", hook);

    const xhr = new XMLHttpRequest();
    xhr.responseType = "json";
    xhr.open("GET", "https://example.com");

    await new Promise<void>((resolve) => {
      xhr.onload = () => {
        expect(xhr.response).toEqual({ message: "Hello" });
        expect(xhr.status).toBe(200);
        resolve();
      };
      xhr.send();
    });
  });

  it("should handle blob responseType", async () => {
    const hook = (_xhr: Request) => {
      return (_abort: AbortSignal) => {
        return new Promise<Response>((resolve) => {
          resolve(new Response("Hello"));
        });
      };
    };

    insertXhrHook("test", hook);

    const xhr = new XMLHttpRequest();
    xhr.responseType = "blob";
    xhr.open("GET", "https://example.com");

    await new Promise<void>((resolve) => {
      xhr.onload = async () => {
        expect(xhr.response).toBeInstanceOf(Blob);
        expect(await xhr.response.text()).toBe("Hello");
        resolve();
      };
      xhr.send();
    });
  });

  it("should handle document responseType", async () => {
    const hook = (_xhr: Request) => {
      return (_abort: AbortSignal) => {
        return new Promise<Response>((resolve) => {
          resolve(
            new Response("<doc><title>Hello</title></doc>", {
              headers: { "Content-Type": "application/xml" },
            }),
          );
        });
      };
    };

    insertXhrHook("test", hook);

    const xhr = new XMLHttpRequest();
    xhr.responseType = "document";
    xhr.open("GET", "https://example.com");

    await new Promise<void>((resolve) => {
      xhr.onload = () => {
        expect(xhr.response).toBeInstanceOf(XMLDocument);
        expect(xhr.response.querySelector("title").textContent).toBe("Hello");
        resolve();
      };
      xhr.send();
    });
  });

  it("should get all response headers", async () => {
    const hook = (_xhr: Request) => {
      return (_abort: AbortSignal) => {
        return new Promise<Response>((resolve) => {
          resolve(
            new Response("Hello", {
              headers: { "X-Test": "true" },
            }),
          );
        });
      };
    };

    insertXhrHook("test", hook);

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com");

    await new Promise<void>((resolve) => {
      xhr.onload = () => {
        expect(xhr.getAllResponseHeaders()).toContain("x-test: true");
        resolve();
      };
      xhr.send();
    });
  });

  it("should abort the request", async () => {
    let aborted = false;
    const hook = (_xhr: Request) => {
      return (abort: AbortSignal) => {
        return new Promise<Response>((_resolve, reject) => {
          abort.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      };
    };

    insertXhrHook("test", hook);

    const xhr = new XMLHttpRequest();
    xhr.open("GET", "https://example.com");

    let error: any;
    xhr.onerror = (e) => {
      error = e;
    };

    xhr.send();
    xhr.abort();

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(aborted).toBe(true);
  });
});
