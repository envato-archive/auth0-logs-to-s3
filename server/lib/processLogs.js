const _ = require('lodash');
const async = require('async');
const Sumologic = require('logs-to-sumologic');
const loggingTools = require('auth0-log-extension-tools');
const config = require('../lib/config');
const logger = require('../lib/logger');

module.exports = (storage) =>
  (req, res, next) => {
    const wtBody = (req.webtaskContext && req.webtaskContext.body) || req.body || {};
    const wtHead = (req.webtaskContext && req.webtaskContext.headers) || {};
    const isCron = (wtBody.schedule && wtBody.state === 'active') || (wtHead.referer === 'https://manage.auth0.com/' && wtHead['if-none-match']);

    if (!isCron) {
      return next();
    }

    const sumologic = Sumologic.createClient({ url: config('SUMOLOGIC_URL') });

    const onLogsReceived = (logs, callback) => {
      if (!logs || !logs.length) {
        return callback();
      }

      logger.info(`Sending ${logs.length} logs to Sumologic.`);

      sumologic.log(logs.map(log => JSON.stringify(log)), (err) => {
        if (err) {
          return callback({ error: err, message: 'Error sending logs to Sumologic' });
        }

        logger.info('Upload complete.');

        return callback();
      });
    };

    const slack = new loggingTools.reporters.SlackReporter({
      hook: config('SLACK_INCOMING_WEBHOOK_URL'),
      username: 'auth0-logs-to-sumologic',
      title: 'Logs To Sumologic'
    });

    const options = {
      domain: config('AUTH0_DOMAIN'),
      clientId: config('AUTH0_CLIENT_ID'),
      clientSecret: config('AUTH0_CLIENT_SECRET'),
      batchSize: config('BATCH_SIZE'),
      startFrom: config('START_FROM'),
      logLevel: config('LOG_LEVEL'),
      logTypes: config('LOG_TYPES')
    };

    const auth0logger = new loggingTools.LogsProcessor(storage, options);

    const sendDailyReport = () => {
      if (!config('DAILY_REPORT_TIME') || !/\d:\d/.test(config('DAILY_REPORT_TIME'))) {
        return null;
      }

      const current = new Date();
      const hour = current.getHours();
      const minute = current.getMinutes();
      const trigger = config('DAILY_REPORT_TIME').split(':');
      const triggerHour = parseInt(trigger[0]);
      const triggerMinute = parseInt(trigger[1]);

      if (hour === triggerHour && (minute >= triggerMinute && minute < triggerMinute + 5)) {
        const end = current.getTime();
        const start = end - 86400000;
        auth0logger.getReport(start, end)
          .then(report => slack.send(report, report.checkpoint));
      }
    };

    return auth0logger
      .run(onLogsReceived)
      .then(result => {
        if (result && result.status && result.status.error) {
          slack.send(result.status, result.checkpoint);
        } else if (config('SLACK_SEND_SUCCESS') === true || config('SLACK_SEND_SUCCESS') === 'true') {
          slack.send(result.status, result.checkpoint);
        }
        sendDailyReport();
        res.json(result);
      })
      .catch(err => {
        slack.send({ error: err, logsProcessed: 0 }, null);
        next(err);
      });
  };
