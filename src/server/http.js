const http = require("http");
const https = require("https");
const JsonRpcServerFactory = require(".");
const HttpServerProtocol = require("./protocol/http");

/**
 * Creates instance of HttpServerFactory
 * @extends JsonRpcServerFactory
 */
class HttpServerFactory extends JsonRpcServerFactory {
  constructor(options) {
    super(options);
    this.scheme = this.options.scheme || "http";
    this.key = this.options.key;
    this.cert = this.options.cert;
  }

  /** @inheritdoc */
  setServer() {
    if (this.scheme === "http") {
      this.server = new http.Server();
    } else if (this.scheme === "https") {
      this.server = new https.Server({
        key: this.key,
        cert: this.cert
      });
    } else {
      throw Error("Invalid scheme");
    }
  }

  /** @inheritdoc */
  buildProtocol() {
    this.server.on("connection", (client) => {
      this.connectedClients.push(client);
      this.emit("clientConnected", client);
      client.on("close", () => {
        this.emit("clientDisconnected");
      });
      // client.on("end", () => {
      //   this.emit("clientDisconnected");
      // });
    });
    this.server.on("request", (request, response) => {
      this.pcolInstance = new HttpServerProtocol(
        this,
        request,
        response,
        this.options.version,
        this.options.delimiter
      );
      this.pcolInstance.clientConnected();
    });
  }
}

module.exports = HttpServerFactory;
