import { createServer } from "node:http";

export interface StubProxy {
  url: string;
  connectTargets: string[];
  authorizationHeaders: Array<string | undefined>;
  close(): Promise<void>;
}

/** 最小 CONNECT 桩代理：记录隧道目标与认证头，并在隧道内返回固定响应。 */
export async function startStubProxy(body = "proxied"): Promise<StubProxy> {
  const connectTargets: string[] = [];
  const authorizationHeaders: Array<string | undefined> = [];
  const server = createServer((_request, response) => {
    response.writeHead(400);
    response.end("stub proxy only supports CONNECT");
  });
  server.on("connect", (request, socket, head) => {
    connectTargets.push(String(request.url));
    authorizationHeaders.push(request.headers["proxy-authorization"]);
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    let answered = false;
    const answer = () => {
      if (answered) return;
      answered = true;
      const payload = Buffer.from(body, "utf8");
      socket.end(
        `HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: ${payload.length}\r\nConnection: close\r\n\r\n${body}`,
      );
    };
    if (head.length) answer();
    else socket.once("data", answer);
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    connectTargets,
    authorizationHeaders,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
