const net = require("net");
const Client = require(".");
const { formatRequest } = require("../functions");
const { ERR_CODES, ERR_MSGS } = require("../constants");

/**
 * Constructor for Jsonic TCP client
 * @class TCPClient
 * @constructor
 * @extends Client
 * @param {Object} [options] optional settings for client
 * @return TCPClient
 */
class TCPClient extends Client {
  connect() {
    return new Promise((resolve, reject) => {
      if (this.attached) {
        // not having this caused MaxEventListeners error
        return reject(Error("client already connected"));
      }
      this.client = new net.Socket();
      this.client.connect(this.server);
      this.client.setEncoding("utf8");
      this.client.on("connect", () => {
        this.attached = true;
        this.writer = this.client;
        // start listeners, response handlers and error handlers
        this.listen();
        resolve(this.server);
      });
      let { retries } = this.options;
      this.client.on("error", (error) => {
        if (error.code === "ECONNREFUSED" && retries) {
          retries -= 1;
          process.stdout.write(
            `Unable to connect. Retrying. ${retries} attempts left.\n`
          );
          setTimeout(() => {
            this.client.connect(this.server);
          }, 5000);
        } else {
          reject(error);
        }
      });
    });
  }

  request() {
    return {
      message: (method, params, id = true) => {
        const request = formatRequest({
          method,
          params,
          id: id ? this.message_id : undefined,
          options: this.options
        });
        this.message_id += 1;
        return request;
      },

      send: (method, params) => new Promise((resolve, reject) => {
        const requestId = this.message_id;
        this.pendingCalls[requestId] = { resolve, reject };
        try {
          this.client.write(this.request().message(method, params));
        } catch (e) {
          if (e instanceof TypeError) {
            // this.client is probably undefined
            reject(new Error(`Unable to send request. ${e.message}`));
          }
        }
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
          try {
            this.client.write(request, () => {
              resolve("notification sent");
            });
          } catch (e) {
            if (e instanceof TypeError) {
              // this.client is probably undefined
              reject(new Error(`Unable to send request. ${e.message}`));
            }
          }
        });
      }
    };
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
        this.client.write(request + this.options.delimiter);
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
      this.on("batchResponse", (batch) => {
        const batchResponseIds = [];
        batch.forEach((message) => {
          if (message.id) {
            batchResponseIds.push(message.id);
          }
        });
        if (batchResponseIds.length === 0) {
          resolve([]);
        }
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
      });
      this.on("batchError", (error) => {
        reject(error);
      });
    });
  }

  /**
   * @params {String} [method] method to subscribe to
   * @params {Function} [cb] callback function to invoke on notify
   */
  subscribe(method, cb) {
    this.on("notify", (message) => {
      try {
        if (message.method === method) {
          return cb(undefined, message);
        }
      } catch (e) {
        return cb(e);
      }
    });
  }
}

module.exports = TCPClient;
