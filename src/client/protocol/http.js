const http = require("http");
const JsonRpcClientProtocol = require("./base");

class HttpClientProtocol extends JsonRpcClientProtocol {
  constructor(factory, version, delimiter) {
    super(factory, version, delimiter);
    this.headers = this.factory.headers;
    this.encoding = this.factory.encoding;
  }

  write(request, cb) {
    const options = {
      ...this.factory.options,
      ...this.headers
    };
    this.headers["Content-Length"] = Buffer.byteLength(request, this.encoding);
    this.connector = http.request(options, (response) => {
      if (cb) {
        response.on("end", cb);
      }
      this.listener = response;
      this.listen();
    });
    this.connector.write(request, this.encoding);
    this.connector.end();
    this.connector.on("close", () => {
      this.factory.emit("serverDisconnected");
    });
    this.connector.on("error", (error) => {
      throw error;
    });
  }

  notify(method, params) {
    return new Promise((resolve, reject) => {
      const request = this.message(method, params, false);
      try {
        this.write(request, () => {
          if (this.listener.statusCode === 204) {
            resolve(this.listener);
          } else {
            reject(new Error("no response receieved for notification"));
          }
        });
      } catch (e) {
        // this.connector is probably undefined
        reject(e);
      }
    });
  }

  getResponse(id) {
    return {
      body: this.responseQueue[id],
      ...this.writer
    };
  }

  rejectPendingCalls(error) {
    const err = {
      body: error,
      ...this.connector
    };
    try {
      this.pendingCalls[err.body.id].reject(err);
      this.factory.cleanUp(err.body.id);
    } catch (e) {
      if (e instanceof TypeError) {
        // probably a parse error, which might not have an id
        console.error(
          `Message has no outstanding calls: ${JSON.stringify(err.body)}`
        );
      }
    }
  }

  _resolveOrRejectBatch(batch, batchIds) {
    const batchResponse = {
      body: batch,
      ...this.connector
    };
    try {
      const invalidBatches = [];
      batch.forEach((message) => {
        if (message.error) {
          // reject the whole message if there are any errors
          this.pendingCalls[batchIds].reject(batchResponse);
          invalidBatches.push(batchIds);
        }
      });
      if (invalidBatches.length !== 0) {
        invalidBatches.forEach((id) => {
          delete this.pendingCalls[id];
        });
      } else {
        this.pendingCalls[batchIds].resolve(batchResponse);
        delete this.pendingCalls[batchIds];
      }
    } catch (e) {
      if (e instanceof TypeError) {
        // no outstanding calls
        console.log(
          `Batch response has no outstanding calls. Response IDs [${batchIds}]`
        );
      }
    }
  }
}

module.exports = HttpClientProtocol;
