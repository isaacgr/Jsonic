/**
 * Generates a stringified JSON-RPC request object with appended delimiter.
 *
 * @function formatRequest
 * @memberof Utils.format
 * @param {object} request
 * @param {string} request.method
 * @param {array|object} request.params
 * @param {string|number} request.id
 * @param {string|number} request.version
 * @param {string} request.delimiter
 */
const formatRequest = ({
  method, params, id, version, delimiter
}) => {
  if (typeof method !== "string") {
    throw new TypeError(`${method} must be a string`);
  }

  const request = {
    method
  };

  // assume 2.0 request unless otherwise specified
  if (!version || version !== 1) {
    request.jsonrpc = "2.0";
  }

  if (params && typeof params !== "object" && !Array.isArray(params)) {
    throw new TypeError(`${params} must be an object or array`);
  } else if (params) {
    request.params = params;
  }

  // assume notification otherwise
  if (typeof id !== "undefined") {
    request.id = id;
  }

  return JSON.stringify(request) + delimiter;
};

/**
 * Generates a stringified JSON-RPC response object with appended delimiter.
 *
 * @function formatResponse
 * @memberof Utils.format
 * @param {object} response
 * @param {string} response.method
 * @param {string|number} response.id
 * @param {string|number} response.jsonrpc
 * @param {string} response.delimiter
 * @param response.result
 */
const formatResponse = ({
  jsonrpc, id, method, result, params, delimiter
}) => {
  if (params && result) {
    throw new Error("Cannot send response with both params and result");
  }

  if (method && id) {
    throw new Error("Cannot send response with both a method and non-null id");
  }

  if (method && typeof method !== "string") {
    throw new TypeError("Method must be a string");
  }

  if (params && typeof params !== "object" && !Array.isArray(params)) {
    throw new TypeError("Params must be an object or array");
  }

  const response = {};

  if (typeof result !== "undefined") {
    response.result = result;
  }

  if (params) {
    response.params = params;
  }

  if (!jsonrpc || jsonrpc === 1) {
    // 1.0 response
    response.error = null;
    // 1.0 notification
    if (!id) {
      response.id = null;
    }
  } else {
    // assume 2.0 response, dont include null error and include jsonrpc version
    response.jsonrpc = "2.0";
  }

  if (method) {
    response.method = method;
  }

  if (id) {
    response.id = id;
  }

  return JSON.stringify(response) + delimiter;
};

/**
 * Generates a stringified JSON-RPC error object with appended delimiter.
 *
 * @function formatError
 * @memberof Utils.format
 * @param {object} error
 * @param {string} error.message
 * @param {array|object} error.code
 * @param {string|number} error.id
 * @param {string|number} error.jsonrpc
 * @param {string} error.delimiter
 * @param {string|object|array} error.data
 */
const formatError = ({
  jsonrpc, id, code, message, data, delimiter
}) => {
  if (!message) {
    throw new Error("Must include message in error response");
  }
  // we're going to assume a 2.0 response if the version isnt explicitly 1
  const response = jsonrpc && jsonrpc !== 1
    ? {
      jsonrpc: "2.0",
      error: { code, message },
      id
    }
    : {
      result: null,
      error: { code, message },
      id
    };

  if (data) {
    response.error.data = data;
  }
  return JSON.stringify(response) + delimiter;
};

/**
 * @static
 *
 */
module.exports = {
  formatRequest,
  formatResponse,
  formatError
};
