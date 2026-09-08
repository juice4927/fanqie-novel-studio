import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { assertLocalEndpointUrl, fetchLocalEndpointResponse } from "../electron/netguard";

describe("本地端点豁免", () => {
  it("只接受字面量回环/私网 IP", () => {
    expect(() => assertLocalEndpointUrl(new URL("http://127.0.0.1:11434/v1"))).not.toThrow();
    expect(() => assertLocalEndpointUrl(new URL("http://[::1]:11434/v1"))).not.toThrow();
    expect(() => assertLocalEndpointUrl(new URL("https://192.168.1.10:11434/v1"))).not.toThrow();
  });

  it("拒绝域名、公网 IP、非 HTTP 协议与内嵌凭据", () => {
    expect(() => assertLocalEndpointUrl(new URL("http://localhost:11434/v1"))).toThrow(/字面量/);
    expect(() => assertLocalEndpointUrl(new URL("http://example.com/v1"))).toThrow(/字面量/);
    expect(() => assertLocalEndpointUrl(new URL("http://8.8.8.8/v1"))).toThrow(/回环或私有/);
    expect(() => assertLocalEndpointUrl(new URL("ftp://127.0.0.1/v1"))).toThrow(/HTTP/);
    expect(() => assertLocalEndpointUrl(new URL("http://user:pass@127.0.0.1/v1"))).toThrow(/凭据/);
  });

  it("直连本地服务可用，且不跟随重定向", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/redirect") {
        response.writeHead(302, { Location: "/target" });
        response.end();
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end("local-ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    try {
      const response = await fetchLocalEndpointResponse(`http://127.0.0.1:${port}/models`, { method: "GET" });
      expect(await response.text()).toBe("local-ok");
      await expect(
        fetchLocalEndpointResponse(`http://127.0.0.1:${port}/redirect`, { method: "GET" }),
      ).rejects.toThrow();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
