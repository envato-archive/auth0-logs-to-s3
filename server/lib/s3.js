const _ = require('lodash');
const uuid = require('node-uuid');
// const request = require('request');
const logger = require('./logger');

let config = {};

function sendLogs(logs, callback) {
  if (logs.length === 0) {
    return callback();
  }

  try {
    logger.info('--------');
    logger.info(logs.concat('\n'));
    logger.info('--------');

    return callback();
    //   request({
    //     method: 'POST',
    //     url: config.endpoint,
    //     headers: { 'Content-Type': 'application/json' },
    //     body: logs.concat('\n')
    //   }, (error, response) => {
    //     const isError = !!error || response.statusCode < 200 || response.statusCode >= 400;
    //
    //     if (isError) {
    //       return callback(error || response.error || response.body);
    //     }
    //
    //     return callback();
    //   });
  } catch (e) {
    return callback(e);
  }
}

function S3(bucket_name) {
  if (!bucket_name) {
    throw new Error('bucket_name is required for S3');
  }

  config = {
    bucket_name: bucket_name,
    session: `auth0-logs-to-s3-${uuid.v4()}`
  };
}

S3.prototype.send = function (logs, callback) {
  if (!logs || !logs.length) {
    return callback();
  }

  const timestamp = new Date().toUTCString();
  const client = {url: config.clientUrl};
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

module.exports = S3;
