'use strict';

const Auth0     = require('auth0');
const async     = require('async');
const moment    = require('moment');
const useragent = require('useragent');
const express   = require('express');
const Webtask   = require('webtask-tools');
const app       = express();

// const Sumologic = require('logs-to-sumologic');
// const Sumologic = require('./lib/sumologic');


function lastLogCheckpoint(req, res) {
  let ctx = req.webtaskContext;
  let required_settings = ['AUTH0_DOMAIN', 'AUTH0_GLOBAL_CLIENT_ID', 'AUTH0_GLOBAL_CLIENT_SECRET', 'SUMOLOGIC_URL'];
  let missing_settings = required_settings.filter((setting) => !ctx.data[setting]);

  if (missing_settings.length) {
    return res.status(400).send({message: 'Missing settings: ' + missing_settings.join(', ')});
  }

  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
  req.webtaskContext.storage.get((err, data) => {
    let startCheckpointId = typeof data === 'undefined' ? null : data.checkpointId;

    // Initialize both clients.
    const auth0 = new Auth0({
      domain: ctx.data.AUTH0_DOMAIN,
      clientID: ctx.data.AUTH0_GLOBAL_CLIENT_ID,
      clientSecret: ctx.data.AUTH0_GLOBAL_CLIENT_SECRET
    });

    // WAS IMPORTED USING UPPER CASE..
    // const logger = Sumologic.createClient({
    //   url: ctx.data.SUMOLOGIC_URL
    // });

    const logger = sumologic.createClient({
      url: ctx.data.SUMOLOGIC_URL
    });

    // Start the process.
    async.waterfall([
      (callback) => {
        auth0.getAccessToken((err) => {
          if (err) {
            console.log('Error authenticating:', err);
          }
          return callback(err);
        });
      },
      (callback) => {
        const getLogs = (context) => {
          console.log(`Downloading logs from: ${context.checkpointId || 'Start'}.`);

          context.logs = context.logs || [];
          auth0.getLogs({take: 200, from: context.checkpointId}, (err, logs) => {
            if (err) {
              return callback(err);
            }

            if (logs && logs.length) {
              logs.forEach((l) => context.logs.push(l));
              context.checkpointId = context.logs[context.logs.length - 1]._id;
              return setImmediate(() => getLogs(context));
            }

            console.log(`Total logs: ${context.logs.length}.`);
            return callback(null, context);
          });
        };

        getLogs({checkpointId: startCheckpointId});
      },
      (context, callback) => {
        const min_log_level = parseInt(ctx.data.LOG_LEVEL) || 0;
        const log_matches_level = (log) => {
          if (logTypes[log.type]) {
            return logTypes[log.type].level >= min_log_level;
          }
          return true;
        };

        const types_filter = (ctx.data.LOG_TYPES && ctx.data.LOG_TYPES.split(',')) || [];
        const log_matches_types = (log) => {
          if (!types_filter || !types_filter.length) return true;
          return log.type && types_filter.indexOf(log.type) >= 0;
        };

        context.logs = context.logs
          .filter(l => l.type !== 'sapi' && l.type !== 'fapi')
          .filter(log_matches_level)
          .filter(log_matches_types);

        console.log(`Filtered logs on log level '${min_log_level}': ${context.logs.length}.`);

        if (ctx.data.LOG_TYPES) {
          console.log(`Filtered logs on '${ctx.data.LOG_TYPES}': ${context.logs.length}.`);
        }

        callback(null, context);
      },
      (context, callback) => {
        console.log('Uploading blobs...');

        async.eachLimit(context.logs, 5, (log, cb) => {
          const date = moment(log.date);
          const url = `${date.format('YYYY/MM/DD')}/${date.format('HH')}/${log._id}.json`;
          console.log(`Uploading ${url}.`);

          // sumologic here...
          logger.log(JSON.stringify(log), cb);

        }, (err) => {
          if (err) {
            return callback(err);
          }

          console.log('Upload complete.');
          return callback(null, context);
        });
      }
    ], function (err, context) {
      if (err) {
        console.log('Job failed.');

        return req.webtaskContext.storage.set({checkpointId: startCheckpointId}, {force: 1}, (error) => {
          if (error) return res.status(500).send(error);

          res.status(500).send({
            error: err
          });
        });
      }

      console.log('Job complete.');

      return req.webtaskContext.storage.set({
        checkpointId: context.checkpointId,
        totalLogsProcessed: context.logs.length
      }, {force: 1}, (error) => {
        if (error) return res.status(500).send(error);

        res.sendStatus(200);
      });
    });

  });
}

const logTypes = {
  's': {
    event: 'Success Login',
    level: 1 // Info
  },
  'seacft': {
    event: 'Success Exchange',
    level: 1 // Info
  },
  'feacft': {
    event: 'Failed Exchange',
    level: 3 // Error
  },
  'f': {
    event: 'Failed Login',
    level: 3 // Error
  },
  'w': {
    event: 'Warnings During Login',
    level: 2 // Warning
  },
  'du': {
    event: 'Deleted User',
    level: 1 // Info
  },
  'fu': {
    event: 'Failed Login (invalid email/username)',
    level: 3 // Error
  },
  'fp': {
    event: 'Failed Login (wrong password)',
    level: 3 // Error
  },
  'fc': {
    event: 'Failed by Connector',
    level: 3 // Error
  },
  'fco': {
    event: 'Failed by CORS',
    level: 3 // Error
  },
  'con': {
    event: 'Connector Online',
    level: 1 // Info
  },
  'coff': {
    event: 'Connector Offline',
    level: 3 // Error
  },
  'fcpro': {
    event: 'Failed Connector Provisioning',
    level: 4 // Critical
  },
  'ss': {
    event: 'Success Signup',
    level: 1 // Info
  },
  'fs': {
    event: 'Failed Signup',
    level: 3 // Error
  },
  'cs': {
    event: 'Code Sent',
    level: 0 // Debug
  },
  'cls': {
    event: 'Code/Link Sent',
    level: 0 // Debug
  },
  'sv': {
    event: 'Success Verification Email',
    level: 0 // Debug
  },
  'fv': {
    event: 'Failed Verification Email',
    level: 0 // Debug
  },
  'scp': {
    event: 'Success Change Password',
    level: 1 // Info
  },
  'fcp': {
    event: 'Failed Change Password',
    level: 3 // Error
  },
  'sce': {
    event: 'Success Change Email',
    level: 1 // Info
  },
  'fce': {
    event: 'Failed Change Email',
    level: 3 // Error
  },
  'scu': {
    event: 'Success Change Username',
    level: 1 // Info
  },
  'fcu': {
    event: 'Failed Change Username',
    level: 3 // Error
  },
  'scpn': {
    event: 'Success Change Phone Number',
    level: 1 // Info
  },
  'fcpn': {
    event: 'Failed Change Phone Number',
    level: 3 // Error
  },
  'svr': {
    event: 'Success Verification Email Request',
    level: 0 // Debug
  },
  'fvr': {
    event: 'Failed Verification Email Request',
    level: 3 // Error
  },
  'scpr': {
    event: 'Success Change Password Request',
    level: 0 // Debug
  },
  'fcpr': {
    event: 'Failed Change Password Request',
    level: 3 // Error
  },
  'fn': {
    event: 'Failed Sending Notification',
    level: 3 // Error
  },
  'sapi': {
    event: 'API Operation'
  },
  'fapi': {
    event: 'Failed API Operation'
  },
  'limit_wc': {
    event: 'Blocked Account',
    level: 4 // Critical
  },
  'limit_ui': {
    event: 'Too Many Calls to /userinfo',
    level: 4 // Critical
  },
  'api_limit': {
    event: 'Rate Limit On API',
    level: 4 // Critical
  },
  'sdu': {
    event: 'Successful User Deletion',
    level: 1 // Info
  },
  'fdu': {
    event: 'Failed User Deletion',
    level: 3 // Error
  }
};


//  START TACTICAL - Dump of NPM Module - logs-to-sumologic

var https = require('https'),
  util = require('util'),
  request = require('request'),
  events = require('events'),
  stringifySafe = require('json-stringify-safe');

// basic holder
var sumologic = {};
sumologic.version = require('./package.json').version;


var common = {};

var failCodes = common.failCodes = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict / Duplicate',
  410: 'Gone',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  503: 'Throttled'
};

common.sumologic = function () {
  var args = Array.prototype.slice.call(arguments),
    success = args.pop(),
    callback = args.pop(),
    responded,
    requestBody,
    headers,
    method,
    auth,
    proxy,
    uri;

  if (args.length === 1) {
    if (typeof args[0] === 'string') {
      //
      // If we got a string assume that it's the URI
      //
      method = 'GET';
      uri = args[0];
    }
    else {
      method = args[0].method || 'GET';
      uri = args[0].uri;
      requestBody = args[0].body;
      auth = args[0].auth;
      headers = args[0].headers;
      proxy = args[0].proxy;
    }
  }
  else if (args.length === 2) {
    method = 'GET';
    uri = args[0];
    auth = args[1];
  }
  else {
    method = args[0];
    uri = args[1];
    auth = args[2];
  }

  function onError(err) {
    if (!responded) {
      responded = true;
      if (callback) {
        callback(err)
      }
    }
  }

  var requestOptions = {
    uri: uri,
    method: method,
    headers: headers || {},
    proxy: proxy
  };

  if (auth) {
    requestOptions.headers.authorization = 'Basic ' + new Buffer(auth.username + ':' + auth.password).toString('base64');
  }

  if (requestBody) {
    requestOptions.body = requestBody;
  }

  try {
    request(requestOptions, function (err, res, body) {
      if (err) {
        return onError(err);
      }
      var statusCode = res.statusCode.toString();
      if (Object.keys(failCodes).indexOf(statusCode) !== -1) {
        return onError((new Error('Sumologic Error (' + statusCode + ')')));
      }
      success(res, body);
    });
  }
  catch (ex) {
    onError(ex);
  }
};

common.serialize = function (obj, key) {
  if (obj === null) {
    obj = 'null';
  }
  else if (obj === undefined) {
    obj = 'undefined';
  }
  else if (obj === false) {
    obj = 'false';
  }

  if (typeof obj !== 'object') {
    return key ? key + '=' + obj : obj;
  }

  var msg = '',
    keys = Object.keys(obj),
    length = keys.length;

  for (var i = 0; i < length; i++) {
    if (Array.isArray(obj[keys[i]])) {
      msg += keys[i] + '=[';

      for (var j = 0, l = obj[keys[i]].length; j < l; j++) {
        msg += common.serialize(obj[keys[i]][j]);
        if (j < l - 1) {
          msg += ', ';
        }
      }

      msg += ']';
    }
    else {
      msg += common.serialize(obj[keys[i]], keys[i]);
    }

    if (i < length - 1) {
      msg += ', ';
    }
  }
  return msg;
};

common.clone = function (obj) {
  var clone = {};
  for (var i in obj) {
    clone[i] = obj[i] instanceof Object ? common.clone(obj[i]) : obj[i];
  }
  return clone;
};

function stringify(msg) {
  var payload;

  try {
    payload = JSON.stringify(msg)
  }
  catch (ex) {
    payload = stringifySafe(msg, null, null, noop)
  }

  return payload;
}

// hide the details from global scope

var createClient = (function (common) {

  var createClient = function (options) {
    return new Sumologic(options);
  };

  var Sumologic = function (options) {

    if (!options || !options.url) {
      throw new Error('options.url is required.');
    }

    events.EventEmitter.call(this);

    this.url = options.url;
    this.json = options.json || null;
    this.auth = options.auth || null;
    this.proxy = options.proxy || null;
    this.userAgent = 'logs-to-sumologic ' + sumologic.version;

  };

  util.inherits(Sumologic, events.EventEmitter);

  Sumologic.prototype.log = function (msg, callback) {

    var self = this,
      logOptions;

    var isBulk = Array.isArray(msg);

    function serialize(msg) {
      if (msg instanceof Object) {
        return self.json ? stringify(msg) : common.serialize(msg);
      }
      else {
        return self.json ? stringify({message: msg}) : msg;
      }
    }

    msg = isBulk ? msg.map(serialize).join('\n') : serialize(msg);
    msg = serialize(msg);

    logOptions = {
      uri: this.url,
      method: 'POST',
      body: msg,
      proxy: this.proxy,
      headers: {
        host: this.host,
        accept: '*/*',
        'user-agent': this.userAgent,
        'content-type': this.json ? 'application/json' : 'text/plain',
        'content-length': Buffer.byteLength(msg)
      }
    };

    common.sumologic(logOptions, callback, function (res, body) {
      try {
        var result = '';
        try {
          result = JSON.parse(body);
        } catch (e) {
          // do nothing
        }
        self.emit('log', result);
        if (callback) {
          callback(null, result);
        }
      } catch (ex) {
        if (callback) {
          callback(new Error('Unspecified error from Sumologic: ' + ex));
        }
      }
    });

    return this;
  };

  return createClient;

}(common));


sumologic.createClient = createClient;

// END TACTICAL



app.get('/', lastLogCheckpoint);
app.post('/', lastLogCheckpoint);

module.exports = Webtask.fromExpress(app);




