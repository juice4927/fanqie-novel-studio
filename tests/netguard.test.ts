import { describe, expect, it, vi } from "vitest";
import {
  assertPublicHttpUrlSyntax,
  createPublicLookup,
  fetchPublicHttpResponse,
  isPublicIpAddress,
  resolvePublicAddresses,
} from "../electron/netguard";

describe("network guard", () => {
  it("classifies private, reserved, mapped, and public addresses", () => {
    expect(isPublicIpAddress("10.0.0.1")).toBe(false);
    expect(isPublicIpAddress("169.254.169.254")).toBe(false);
    expect(isPublicIpAddress("::ffff:a00:1")).toBe(false);
    expect(isPublicIpAddress("fc00::1")).toBe(false);
    expect(isPublicIpAddress("2001:db8::1")).toBe(false);
    expect(isPublicIpAddress("8.8.8.8")).toBe(true);
    expect(isPublicIpAddress("2001:4860:4860::8888")).toBe(true);
  });

  it("rejects credentials and literal private destinations before fetch", () => {
    expect(() => assertPublicHttpUrlSyntax(new URL("https://user:secret@example.com/v1")))
      .toThrow("不含凭据");
    expect(() => assertPublicHttpUrlSyntax(new URL("https://[::ffff:10.0.0.1]/v1")))
      .toThrow("本机");
    expect(() => assertPublicHttpUrlSyntax(new URL("https://localhost/v1")))
      .toThrow("本机");
  });

  it("rejects a DNS result set containing any private address", async () => {
    await expect(resolvePublicAddresses("mixed.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "192.168.1.8", family: 4 },
    ])).rejects.toThrow("私有网络");
  });

  it("pins the selected public address through the lookup callback", async () => {
    const lookup = createPublicLookup(async () => [{ address: "8.8.8.8", family: 4 }]);
    await new Promise<void>((resolve, reject) => {
      lookup("provider.example", {}, (error, address, family) => {
        if (error) reject(error);
        else {
          expect(address).toBe("8.8.8.8");
          expect(family).toBe(4);
          resolve();
        }
      });
    });
  });

  it("allows same-origin model redirects but rejects cross-origin redirects", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: "/v1/next" } }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await expect(fetchPublicHttpResponse("https://provider.example/v1", { method: "POST" }, { fetchImpl }))
      .resolves.toMatchObject({ status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const crossOrigin = vi.fn().mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://other.example/" } }),
    );
    await expect(fetchPublicHttpResponse("https://provider.example/v1", { method: "POST" }, { fetchImpl: crossOrigin }))
      .rejects.toThrow("跨来源");
  });

  it("rejects a redirect to a literal private address", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(null, { status: 307, headers: { location: "https://127.0.0.1/admin" } }),
    );
    await expect(fetchPublicHttpResponse("https://provider.example/v1", { method: "POST" }, { fetchImpl, allowCrossOriginRedirect: true }))
      .rejects.toThrow("本机");
  });
});
