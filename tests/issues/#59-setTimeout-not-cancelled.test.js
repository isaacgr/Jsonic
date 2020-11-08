const { expect } = require("chai");
const Jaysonic = require("../../src");
const WebSocket = require("../../src/client-ws");

describe("#59 setTimeout not cancelled", () => {
  describe("tcp", () => {
    it("should have no outstanding timeouts", async () => {
      const server = new Jaysonic.server.tcp({ port: 11111 });
      await server.listen();
      server.method("f", () => 0);

      const client = new Jaysonic.client.tcp({ timeout: 10, port: 11111 });
      await client.connect();
      for (let i = 0; i <= 11; i += 1) {
        await client.request().send("f");
      }
      await client.end();
      await server.close();
      expect(Object.keys(client.timeouts).length).to.be.equal(0);
    });
  });
  describe("ws", () => {
    it("should have no outstanding timeouts", async () => {
      const server = new Jaysonic.server.ws({ port: 8601 });
      await server.listen();
      server.method("f", () => 0);

      const client = new Jaysonic.client.ws({
        url: "ws://127.0.0.1:8601",
        timeout: 10
      });
      await client.connect();
      for (let i = 0; i <= 11; i += 1) {
        await client.request().send("f");
      }
      expect(Object.keys(client.timeouts).length).to.be.equal(0);
    });
  });
  describe("ws client", () => {
    it("should have no outstanding timeouts", async () => {
      const server = new Jaysonic.server.ws({ port: 8604 });
      await server.listen();
      server.method("f", () => 0);
      const client = new WebSocket.wsclient({
        url: "ws://127.0.0.1:8604",
        timeout: 10
      });
      await client.connect();
      for (let i = 0; i <= 11; i += 1) {
        await client.request().send("f");
      }
      expect(Object.keys(client.timeouts).length).to.be.equal(0);
    });
  });
  describe("http", () => {
    it("should have no outstanding timeouts", async () => {
      const server = new Jaysonic.server.http({ port: 8602 });
      await server.listen();
      server.method("f", () => 0);
      const client = new Jaysonic.client.http({ port: 8602, timeout: 10 });
      for (let i = 0; i <= 11; i += 1) {
        await client.request().send("f");
      }
      expect(Object.keys(client.timeouts).length).to.be.equal(0);
    });
  });
});
