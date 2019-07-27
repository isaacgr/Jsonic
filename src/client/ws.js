const WebSocket = require("ws");
const Client = require(".");
const { formatRequest } = require("../functions");
const { ERR_CODES, ERR_MSGS } = require("../constants");
const { MessageBuffer } = require("../buffer");

class WSClient extends Client {
  constructor(options) {
    super();
    if (!(this instanceof WSClient)) {
      return new WSClient(options);
    }

    const defaults = {
      url: "ws://127.0.0.1:8100",
      version: "2.0",
      delimiter: "\n",
      timeout: 30,
      retries: 2
    };

    this.message_id = 1;
    this.serving_message_id = 1;
    this.pendingCalls = {};
    this.pendingBatches = {};
    this.attached = false;

    this.responseQueue = {};
    this.options = {
      ...defaults,
      ...(options || {})
    };
    this.options.timeout = this.options.timeout * 1000;
    /**
     * we can receive whole messages, or parital so we need to buffer
     *
     * whole message: {"jsonrpc": 2.0, "params": ["hello"], id: 1}
     *
     * partial message: {"jsonrpc": 2.0, "params"
     */
    this.messageBuffer = new MessageBuffer(this.options.delimiter);
    const { retries } = this.options;
    this.remainingRetries = retries;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const { url, perMessageDeflate } = this.options;
      this.client = new WebSocket(url, perMessageDeflate);
      this.close();
      this.listen();
      this.client.onopen = (event) => {
        resolve(event);
      };
      this.client.onerror = (error) => {
        reject(error);
      };
    });
  }

  close() {
    this.client.onclose = () => {
      if (this.remainingRetries) {
        this.remainingRetries -= 1;
        process.stdout.write(
          `Connection failed. ${this.remainingRetries} attempts left.\n`
        );
        setTimeout(() => {
          this.connect().catch(() => {});
        }, this.options.timeout);
      }
    };
  }

  request() {
    return {
      message: (method, params) => {
        const request = formatRequest({
          method,
          params,
          id: this.message_id,
          options: this.options
        });
        this.message_id += 1;
        return request;
      },
      send: (method, params) => new Promise((resolve, reject) => {
        const requestId = this.message_id;
        this.pendingCalls[requestId] = { resolve, reject };
        this.client.send(this.request().message(method, params));
        setTimeout(() => {
          if (this.pendingCalls[requestId]) {
            const error = this.sendError({
              id: requestId,
              code: ERR_CODES.timeout,
              message: ERR_MSGS.timeout
            });
            delete this.pendingCalls[requestId];
            reject(error);
          }
        }, this.options.timeout);
      }),
      notify: (method, params) => {
        const request = formatRequest({
          method,
          params,
          options: this.options
        });
        return new Promise((resolve, reject) => {
          this.client.send(request);
          resolve("notification sent");
          this.client.onerror = (error) => {
            reject(error);
          };
        });
      }
    };
  }

  verifyData(chunk) {
    try {
      // will throw an error if not valid json
      const message = JSON.parse(chunk);
      if (Array.isArray(message)) {
        // possible batch request
        this.handleBatchResponse(message);
      } else if (!(message === Object(message))) {
        // error out if it cant be parsed
        const error = this.sendError({
          id: null,
          code: ERR_CODES.parseError,
          message: ERR_MSGS.parseError
        });
        this.handleError(error);
      } else if (!message.id) {
        // no id, so assume notification
        this.handleNotification(message);
      } else if (message.error) {
        // got an error back so reject the message
        const error = this.sendError({
          jsonrpc: message.jsonrpc,
          id: message.id,
          code: message.error.code,
          message: message.error.message
        });
        this.handleError(error);
      } else if (!message.method) {
        // no method, so assume response
        this.serving_message_id = message.id;
        this.responseQueue[this.serving_message_id] = message;
        this.handleResponse(message);
      } else {
        throw new Error();
      }
    } catch (e) {
      if (e instanceof SyntaxError) {
        const error = this.sendError({
          id: this.serving_message_id,
          code: ERR_CODES.parseError,
          message: `Unable to parse message: '${chunk}'`
        });
        this.handleError(error);
      } else {
        const error = this.sendError({
          id: this.serving_message_id,
          code: ERR_CODES.internal,
          message: `Unable to parse message: '${chunk}'`
        });
        this.handleError(error);
      }
    }
  }

  batch(requests) {
    /**
     * should receive a list of request objects
     * [client.request.message(), client.request.message()]
     * send a single request with that, server should handle it
     *
     * We want to store the IDs for the requests in the batch in an array
     * Use this to reference the batch response
     * The spec has no explaination on how to do that, so this is the solution
     */

    return new Promise((resolve, reject) => {
      const batchIds = [];
      const batchRequests = [];
      for (const request of requests) {
        const json = JSON.parse(request);
        batchRequests.push(json);
        if (json.id) {
          batchIds.push(json.id);
        }
      }
      this.pendingBatches[String(batchIds)] = { resolve, reject };
      const request = JSON.stringify(batchRequests);
      try {
        this.client.send(request + this.options.delimiter);
      } catch (e) {
        if (e instanceof TypeError) {
          // this.client is probably undefined
          reject(new Error(`Unable to send request. ${e.message}`));
        }
      }
      setTimeout(() => {
        if (this.pendingBatches[String(batchIds)]) {
          const error = this.sendError({
            id: null,
            code: ERR_CODES.timeout,
            message: ERR_MSGS.timeout
          });
          delete this.pendingBatches[String(batchIds)];
          reject(error);
        }
      }, this.options.timeout);
    });
  }

  handleBatchResponse(batch) {
    const batchResponseIds = [];
    batch.forEach((message) => {
      if (message.id) {
        batchResponseIds.push(message.id);
      }
    });
    for (const ids of Object.keys(this.pendingBatches)) {
      const arrays = [JSON.parse(`[${ids}]`), batchResponseIds];
      const difference = arrays.reduce((a, b) => a.filter(c => !b.includes(c)));
      if (difference.length === 0) {
        batch.forEach((message) => {
          if (message.error) {
            // reject the whole message if there are any errors
            if (this.pendingBatches[ids] !== undefined) {
              this.pendingBatches[ids].reject(batch);
              delete this.pendingBatches[ids];
            }
          }
        });
        if (this.pendingBatches[ids] !== undefined) {
          this.pendingBatches[ids].resolve(batch);
          delete this.pendingBatches[ids];
        }
      }
    }
  }

  handleNotification(message) {
    this.emit("notify", { detail: message });
  }

  /**
   * @params {String} [method] method to subscribe to
   * @params {Function} [cb] callback function to invoke on notify
   */
  subscribe(method, cb) {
    this.on("notify", ({ detail }) => {
      try {
        if (detail.method === method) {
          return cb(null, detail);
        }
      } catch (e) {
        return cb(e);
      }
    });
  }

  listen() {
    this.client.onmessage = (message) => {
      this.handleData(message.data);
    };
  }

  handleData(data) {
    this.messageBuffer.push(data);
    while (!this.messageBuffer.isFinished()) {
      const message = this.messageBuffer.handleData();
      this.verifyData(message);
    }
  }

  handleResponse(message) {
    if (!(this.pendingCalls[message.id] === undefined)) {
      const response = this.responseQueue[message.id];
      this.pendingCalls[message.id].resolve(response);
      delete this.responseQueue[message.id];
    }
  }

  handleError(error) {
    const response = error;
    try {
      this.pendingCalls[error.id].reject(response);
    } catch (e) {
      if (e instanceof TypeError) {
        // probably a parse error, which might not have an id
        process.stdout.write(
          `Message has no outstanding calls: ${JSON.stringify(error)}\n`
        );
      }
    }
  }

  sendError({
    jsonrpc, id, code, message
  }) {
    let response;
    if (this.options.version === "2.0") {
      response = {
        jsonrpc: jsonrpc || this.options.version,
        error: { code, message: message || "Unknown Error" },
        id
      };
    } else {
      response = {
        result: null,
        error: { code, message: message || "Unknown Error" },
        id
      };
    }
    return response;
  }
}

module.exports = WSClient;
