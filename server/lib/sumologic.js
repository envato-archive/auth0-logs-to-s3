const _ = require('lodash');
const uuid = require('node-uuid');
const request = require('request');

let config = {};

function sendLogs(logs, callback) {
  if (logs.length === 0) {
    callback();
  }

  try {
    request({
      method: 'POST',
      url: config.endpoint,
      headers: { 'Content-Type': 'application/json' },
      body: logs.concat('\n')
    }, (error, response) => {
      const isError = !!error || response.statusCode < 200 || response.statusCode >= 400;

      if (isError) {
        return callback(error || response.error || response.body);
      }

      return callback();
    });
  } catch (e) {
    return callback(e);
  }
}

function Sumologic (endpoint) {
  if (!endpoint) {
    console.error('Endpoint is required for Sumologic');
    return;
  }

  config = {
    endpoint: endpoint,
    session: `auth0-logs-to-sumologic-${uuid.v4()}`
  };
}

Sumologic.prototype.send = function(logs, callback) {
  if (!logs || !logs.length) {
    return callback();
  }

  const timestamp = new Date().toUTCString();
  const client = { url: config.clientUrl };
  const message = [];

  logs.forEach((log) => {
    const data = {
      sessionId: config.session,
      timestamp: timestamp
    };

    message.push(JSON.stringify(_.extend(data, client, log)));
    message.push('\n');
  });

  return sendLogs(message, callback);
};

module.exports = Sumologic;
