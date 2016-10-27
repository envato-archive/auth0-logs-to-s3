module.exports =
/******/ (function(modules) { // webpackBootstrap
/******/ 	// The module cache
/******/ 	var installedModules = {};

/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {

/******/ 		// Check if module is in cache
/******/ 		if(installedModules[moduleId])
/******/ 			return installedModules[moduleId].exports;

/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = installedModules[moduleId] = {
/******/ 			exports: {},
/******/ 			id: moduleId,
/******/ 			loaded: false
/******/ 		};

/******/ 		// Execute the module function
/******/ 		modules[moduleId].call(module.exports, module, module.exports, __webpack_require__);

/******/ 		// Flag the module as loaded
/******/ 		module.loaded = true;

/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}


/******/ 	// expose the modules object (__webpack_modules__)
/******/ 	__webpack_require__.m = modules;

/******/ 	// expose the module cache
/******/ 	__webpack_require__.c = installedModules;

/******/ 	// __webpack_public_path__
/******/ 	__webpack_require__.p = "/build/";

/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(0);
/******/ })
/************************************************************************/
/******/ ([
/* 0 */
/***/ function(module, exports, __webpack_require__) {

	/* WEBPACK VAR INJECTION */(function(setImmediate) {'use strict';

	var _logTypes;

	function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

	var async = __webpack_require__(3);
	var moment = __webpack_require__(4);
	var useragent = __webpack_require__(5);
	var express = __webpack_require__(6);
	var Webtask = __webpack_require__(7);
	var app = express();
	var Sumologic = __webpack_require__(18);
	var Request = __webpack_require__(17);
	var memoizer = __webpack_require__(27);

	function lastLogCheckpoint(req, res) {
	  var ctx = req.webtaskContext;
	  var required_settings = ['AUTH0_DOMAIN', 'AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET', 'SUMOLOGIC_URL'];
	  var missing_settings = required_settings.filter(function (setting) {
	    return !ctx.data[setting];
	  });

	  if (missing_settings.length) {
	    return res.status(400).send({ message: 'Missing settings: ' + missing_settings.join(', ') });
	  }

	  // If this is a scheduled task, we'll get the last log checkpoint from the previous run and continue from there.
	  req.webtaskContext.storage.get(function (err, data) {
	    var startFromId = ctx.data.START_FROM ? ctx.data.START_FROM : null;
	    var startCheckpointId = typeof data === 'undefined' ? startFromId : data.checkpointId;

	    if (err) {
	      console.log('storage.get', err);
	    }

	    // WAS IMPORTED USING UPPER CASE..
	    var logger = Sumologic.createClient({
	      url: ctx.data.SUMOLOGIC_URL
	    });

	    // Start the process.
	    async.waterfall([function (callback) {
	      var getLogs = function getLogs(context) {
	        console.log('Logs from: ' + (context.checkpointId || 'Start') + '.');

	        var take = Number.parseInt(ctx.data.BATCH_SIZE);

	        take = take ? take : 100;

	        context.logs = context.logs || [];

	        getLogsFromAuth0(req.webtaskContext.data.AUTH0_DOMAIN, req.access_token, take, context.checkpointId, function (logs, err) {
	          if (err) {
	            console.log('Error getting logs from Auth0', err);
	            return callback(err);
	          }

	          if (logs && logs.length && context.logs.length <= 3000) {
	            logs.forEach(function (l) {
	              return context.logs.push(l);
	            });
	            context.checkpointId = context.logs[context.logs.length - 1]._id;
	            return setImmediate(function () {
	              return getLogs(context);
	            });
	          }

	          console.log('Total logs: ' + context.logs.length + '.');
	          return callback(null, context);
	        });
	      };

	      getLogs({ checkpointId: startCheckpointId });
	    }, function (context, callback) {
	      var min_log_level = parseInt(ctx.data.LOG_LEVEL) || 0;
	      var log_matches_level = function log_matches_level(log) {
	        if (logTypes[log.type]) {
	          return logTypes[log.type].level >= min_log_level;
	        }
	        return true;
	      };

	      var types_filter = ctx.data.LOG_TYPES && ctx.data.LOG_TYPES.split(',') || [];
	      var log_matches_types = function log_matches_types(log) {
	        if (!types_filter || !types_filter.length) return true;
	        return log.type && types_filter.indexOf(log.type) >= 0;
	      };

	      context.logs = context.logs.filter(function (l) {
	        return l.type !== 'sapi' && l.type !== 'fapi';
	      }).filter(log_matches_level).filter(log_matches_types);

	      callback(null, context);
	    }, function (context, callback) {
	      console.log('Sending ' + context.logs.length);

	      // sumologic here...
	      context.logs.forEach(function (log, idx) {
	        context.logs[idx] = JSON.stringify(log);
	      });

	      logger.log(context.logs, function (err) {
	        if (err) {
	          console.log('Error sending logs to Sumologic', err);
	          return callback(err);
	        }

	        console.log('Upload complete.');

	        return callback(null, context);
	      });
	    }], function (err, context) {
	      if (err) {
	        console.log('Job failed.', err);

	        return req.webtaskContext.storage.set({ checkpointId: startCheckpointId }, { force: 1 }, function (error) {
	          if (error) {
	            console.log('Error storing startCheckpoint', error);
	            return res.status(500).send({ error: error });
	          }

	          res.status(500).send({
	            error: err
	          });
	        });
	      }

	      console.log('Job complete.');

	      return req.webtaskContext.storage.set({
	        checkpointId: context.checkpointId,
	        totalLogsProcessed: context.logs.length
	      }, { force: 1 }, function (error) {
	        if (error) {
	          console.log('Error storing checkpoint', error);
	          return res.status(500).send({ error: error });
	        }

	        res.sendStatus(200);
	      });
	    });
	  });
	}

	var logTypes = (_logTypes = {
	  's': {
	    event: 'Success Login',
	    level: 1 // Info
	  },
	  'seacft': {
	    event: 'Success Exchange',
	    level: 1 // Info
	  },
	  'seccft': {
	    event: 'Success Exchange (Client Credentials)',
	    level: 1 // Info
	  },
	  'feacft': {
	    event: 'Failed Exchange',
	    level: 3 // Error
	  },
	  'feccft': {
	    event: 'Failed Exchange (Client Credentials)',
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
	}, _defineProperty(_logTypes, 'fapi', {
	  event: 'Failed API Operation',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_wc', {
	  event: 'Blocked Account',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'limit_mu', {
	  event: 'Blocked IP Address',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'slo', {
	  event: 'Success Logout',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'flo', {
	  event: ' Failed Logout',
	  level: 3 // Error
	}), _defineProperty(_logTypes, 'sd', {
	  event: 'Success Delegation',
	  level: 1 // Info
	}), _defineProperty(_logTypes, 'fd', {
	  event: 'Failed Delegation',
	  level: 3 // Error
	}), _logTypes);

	function getLogsFromAuth0(domain, token, take, from, cb) {
	  var url = 'https://' + domain + '/api/v2/logs';

	  Request({
	    method: 'GET',
	    url: url,
	    json: true,
	    qs: {
	      take: take,
	      from: from,
	      sort: 'date:1',
	      per_page: take
	    },
	    headers: {
	      Authorization: 'Bearer ' + token,
	      Accept: 'application/json'
	    }
	  }, function (err, res, body) {
	    if (err) {
	      console.log('Error getting logs', err);
	      cb(null, err);
	    } else {
	      cb(body);
	    }
	  });
	}

	var getTokenCached = memoizer({
	  load: function load(apiUrl, audience, clientId, clientSecret, cb) {
	    Request({
	      method: 'POST',
	      url: apiUrl,
	      json: true,
	      body: {
	        audience: audience,
	        grant_type: 'client_credentials',
	        client_id: clientId,
	        client_secret: clientSecret
	      }
	    }, function (err, res, body) {
	      if (err) {
	        cb(null, err);
	      } else {
	        cb(body.access_token);
	      }
	    });
	  },
	  hash: function hash(apiUrl) {
	    return apiUrl;
	  },
	  max: 100,
	  maxAge: 1000 * 60 * 60
	});

	app.use(function (req, res, next) {
	  var apiUrl = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/oauth/token';
	  var audience = 'https://' + req.webtaskContext.data.AUTH0_DOMAIN + '/api/v2/';
	  var clientId = req.webtaskContext.data.AUTH0_CLIENT_ID;
	  var clientSecret = req.webtaskContext.data.AUTH0_CLIENT_SECRET;

	  getTokenCached(apiUrl, audience, clientId, clientSecret, function (access_token, err) {
	    if (err) {
	      console.log('Error getting access_token', err);
	      return next(err);
	    }

	    req.access_token = access_token;
	    next();
	  });
	});

	app.get('/', lastLogCheckpoint);
	app.post('/', lastLogCheckpoint);

	module.exports = Webtask.fromExpress(app);
	/* WEBPACK VAR INJECTION */}.call(exports, __webpack_require__(1).setImmediate))

/***/ },
/* 1 */
/***/ function(module, exports, __webpack_require__) {

	/* WEBPACK VAR INJECTION */(function(setImmediate, clearImmediate) {var nextTick = __webpack_require__(2).nextTick;
	var apply = Function.prototype.apply;
	var slice = Array.prototype.slice;
	var immediateIds = {};
	var nextImmediateId = 0;

	// DOM APIs, for completeness

	exports.setTimeout = function() {
	  return new Timeout(apply.call(setTimeout, window, arguments), clearTimeout);
	};
	exports.setInterval = function() {
	  return new Timeout(apply.call(setInterval, window, arguments), clearInterval);
	};
	exports.clearTimeout =
	exports.clearInterval = function(timeout) { timeout.close(); };

	function Timeout(id, clearFn) {
	  this._id = id;
	  this._clearFn = clearFn;
	}
	Timeout.prototype.unref = Timeout.prototype.ref = function() {};
	Timeout.prototype.close = function() {
	  this._clearFn.call(window, this._id);
	};

	// Does not start the time, just sets up the members needed.
	exports.enroll = function(item, msecs) {
	  clearTimeout(item._idleTimeoutId);
	  item._idleTimeout = msecs;
	};

	exports.unenroll = function(item) {
	  clearTimeout(item._idleTimeoutId);
	  item._idleTimeout = -1;
	};

	exports._unrefActive = exports.active = function(item) {
	  clearTimeout(item._idleTimeoutId);

	  var msecs = item._idleTimeout;
	  if (msecs >= 0) {
	    item._idleTimeoutId = setTimeout(function onTimeout() {
	      if (item._onTimeout)
	        item._onTimeout();
	    }, msecs);
	  }
	};

	// That's not how node.js implements it but the exposed api is the same.
	exports.setImmediate = typeof setImmediate === "function" ? setImmediate : function(fn) {
	  var id = nextImmediateId++;
	  var args = arguments.length < 2 ? false : slice.call(arguments, 1);

	  immediateIds[id] = true;

	  nextTick(function onNextTick() {
	    if (immediateIds[id]) {
	      // fn.call() is faster so we optimize for the common use-case
	      // @see http://jsperf.com/call-apply-segu
	      if (args) {
	        fn.apply(null, args);
	      } else {
	        fn.call(null);
	      }
	      // Prevent ids from leaking
	      exports.clearImmediate(id);
	    }
	  });

	  return id;
	};

	exports.clearImmediate = typeof clearImmediate === "function" ? clearImmediate : function(id) {
	  delete immediateIds[id];
	};
	/* WEBPACK VAR INJECTION */}.call(exports, __webpack_require__(1).setImmediate, __webpack_require__(1).clearImmediate))

/***/ },
/* 2 */
/***/ function(module, exports) {

	// shim for using process in browser
	var process = module.exports = {};

	// cached from whatever global is present so that test runners that stub it
	// don't break things.  But we need to wrap it in a try catch in case it is
	// wrapped in strict mode code which doesn't define any globals.  It's inside a
	// function because try/catches deoptimize in certain engines.

	var cachedSetTimeout;
	var cachedClearTimeout;

	function defaultSetTimout() {
	    throw new Error('setTimeout has not been defined');
	}
	function defaultClearTimeout () {
	    throw new Error('clearTimeout has not been defined');
	}
	(function () {
	    try {
	        if (typeof setTimeout === 'function') {
	            cachedSetTimeout = setTimeout;
	        } else {
	            cachedSetTimeout = defaultSetTimout;
	        }
	    } catch (e) {
	        cachedSetTimeout = defaultSetTimout;
	    }
	    try {
	        if (typeof clearTimeout === 'function') {
	            cachedClearTimeout = clearTimeout;
	        } else {
	            cachedClearTimeout = defaultClearTimeout;
	        }
	    } catch (e) {
	        cachedClearTimeout = defaultClearTimeout;
	    }
	} ())
	function runTimeout(fun) {
	    if (cachedSetTimeout === setTimeout) {
	        //normal enviroments in sane situations
	        return setTimeout(fun, 0);
	    }
	    // if setTimeout wasn't available but was latter defined
	    if ((cachedSetTimeout === defaultSetTimout || !cachedSetTimeout) && setTimeout) {
	        cachedSetTimeout = setTimeout;
	        return setTimeout(fun, 0);
	    }
	    try {
	        // when when somebody has screwed with setTimeout but no I.E. maddness
	        return cachedSetTimeout(fun, 0);
	    } catch(e){
	        try {
	            // When we are in I.E. but the script has been evaled so I.E. doesn't trust the global object when called normally
	            return cachedSetTimeout.call(null, fun, 0);
	        } catch(e){
	            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error
	            return cachedSetTimeout.call(this, fun, 0);
	        }
	    }


	}
	function runClearTimeout(marker) {
	    if (cachedClearTimeout === clearTimeout) {
	        //normal enviroments in sane situations
	        return clearTimeout(marker);
	    }
	    // if clearTimeout wasn't available but was latter defined
	    if ((cachedClearTimeout === defaultClearTimeout || !cachedClearTimeout) && clearTimeout) {
	        cachedClearTimeout = clearTimeout;
	        return clearTimeout(marker);
	    }
	    try {
	        // when when somebody has screwed with setTimeout but no I.E. maddness
	        return cachedClearTimeout(marker);
	    } catch (e){
	        try {
	            // When we are in I.E. but the script has been evaled so I.E. doesn't  trust the global object when called normally
	            return cachedClearTimeout.call(null, marker);
	        } catch (e){
	            // same as above but when it's a version of I.E. that must have the global object for 'this', hopfully our context correct otherwise it will throw a global error.
	            // Some versions of I.E. have different rules for clearTimeout vs setTimeout
	            return cachedClearTimeout.call(this, marker);
	        }
	    }



	}
	var queue = [];
	var draining = false;
	var currentQueue;
	var queueIndex = -1;

	function cleanUpNextTick() {
	    if (!draining || !currentQueue) {
	        return;
	    }
	    draining = false;
	    if (currentQueue.length) {
	        queue = currentQueue.concat(queue);
	    } else {
	        queueIndex = -1;
	    }
	    if (queue.length) {
	        drainQueue();
	    }
	}

	function drainQueue() {
	    if (draining) {
	        return;
	    }
	    var timeout = runTimeout(cleanUpNextTick);
	    draining = true;

	    var len = queue.length;
	    while(len) {
	        currentQueue = queue;
	        queue = [];
	        while (++queueIndex < len) {
	            if (currentQueue) {
	                currentQueue[queueIndex].run();
	            }
	        }
	        queueIndex = -1;
	        len = queue.length;
	    }
	    currentQueue = null;
	    draining = false;
	    runClearTimeout(timeout);
	}

	process.nextTick = function (fun) {
	    var args = new Array(arguments.length - 1);
	    if (arguments.length > 1) {
	        for (var i = 1; i < arguments.length; i++) {
	            args[i - 1] = arguments[i];
	        }
	    }
	    queue.push(new Item(fun, args));
	    if (queue.length === 1 && !draining) {
	        runTimeout(drainQueue);
	    }
	};

	// v8 likes predictible objects
	function Item(fun, array) {
	    this.fun = fun;
	    this.array = array;
	}
	Item.prototype.run = function () {
	    this.fun.apply(null, this.array);
	};
	process.title = 'browser';
	process.browser = true;
	process.env = {};
	process.argv = [];
	process.version = ''; // empty string to avoid regexp issues
	process.versions = {};

	function noop() {}

	process.on = noop;
	process.addListener = noop;
	process.once = noop;
	process.off = noop;
	process.removeListener = noop;
	process.removeAllListeners = noop;
	process.emit = noop;

	process.binding = function (name) {
	    throw new Error('process.binding is not supported');
	};

	process.cwd = function () { return '/' };
	process.chdir = function (dir) {
	    throw new Error('process.chdir is not supported');
	};
	process.umask = function() { return 0; };


/***/ },
/* 3 */
/***/ function(module, exports) {

	module.exports = require("async");

/***/ },
/* 4 */
/***/ function(module, exports) {

	module.exports = require("moment");

/***/ },
/* 5 */
/***/ function(module, exports) {

	module.exports = require("useragent");

/***/ },
/* 6 */
/***/ function(module, exports) {

	module.exports = require("express");

/***/ },
/* 7 */
/***/ function(module, exports, __webpack_require__) {

	exports.auth0 = __webpack_require__(8);
	exports.fromConnect = exports.fromExpress = fromConnect;
	exports.fromHapi = fromHapi;
	exports.fromServer = exports.fromRestify = fromServer;

	// API functions

	function addAuth0(func) {
	    func.auth0 = function (options) {
	        return exports.auth0(func, options);
	    }

	    return func;
	}

	function fromConnect (connectFn) {
	    return addAuth0(function (context, req, res) {
	        var normalizeRouteRx = createRouteNormalizationRx(req.x_wt.jtn);

	        req.originalUrl = req.url;
	        req.url = req.url.replace(normalizeRouteRx, '/');
	        req.webtaskContext = attachStorageHelpers(context);

	        return connectFn(req, res);
	    });
	}

	function fromHapi(server) {
	    var webtaskContext;

	    server.ext('onRequest', function (request, response) {
	        var normalizeRouteRx = createRouteNormalizationRx(request.x_wt.jtn);

	        request.setUrl(request.url.replace(normalizeRouteRx, '/'));
	        request.webtaskContext = webtaskContext;
	    });

	    return addAuth0(function (context, req, res) {
	        var dispatchFn = server._dispatch();

	        webtaskContext = attachStorageHelpers(context);

	        dispatchFn(req, res);
	    });
	}

	function fromServer(httpServer) {
	    return addAuth0(function (context, req, res) {
	        var normalizeRouteRx = createRouteNormalizationRx(req.x_wt.jtn);

	        req.originalUrl = req.url;
	        req.url = req.url.replace(normalizeRouteRx, '/');
	        req.webtaskContext = attachStorageHelpers(context);

	        return httpServer.emit('request', req, res);
	    });
	}


	// Helper functions

	function createRouteNormalizationRx(jtn) {
	    var normalizeRouteBase = '^\/api\/run\/[^\/]+\/';
	    var normalizeNamedRoute = '(?:[^\/\?#]*\/?)?';

	    return new RegExp(
	        normalizeRouteBase + (
	        jtn
	            ?   normalizeNamedRoute
	            :   ''
	    ));
	}

	function attachStorageHelpers(context) {
	    context.read = context.secrets.EXT_STORAGE_URL
	        ?   readFromPath
	        :   readNotAvailable;
	    context.write = context.secrets.EXT_STORAGE_URL
	        ?   writeToPath
	        :   writeNotAvailable;

	    return context;


	    function readNotAvailable(path, options, cb) {
	        var Boom = __webpack_require__(16);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        cb(Boom.preconditionFailed('Storage is not available in this context'));
	    }

	    function readFromPath(path, options, cb) {
	        var Boom = __webpack_require__(16);
	        var Request = __webpack_require__(17);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        Request({
	            uri: context.secrets.EXT_STORAGE_URL,
	            method: 'GET',
	            headers: options.headers || {},
	            qs: { path: path },
	            json: true,
	        }, function (err, res, body) {
	            if (err) return cb(Boom.wrap(err, 502));
	            if (res.statusCode === 404 && Object.hasOwnProperty.call(options, 'defaultValue')) return cb(null, options.defaultValue);
	            if (res.statusCode >= 400) return cb(Boom.create(res.statusCode, body && body.message));

	            cb(null, body);
	        });
	    }

	    function writeNotAvailable(path, data, options, cb) {
	        var Boom = __webpack_require__(16);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        cb(Boom.preconditionFailed('Storage is not available in this context'));
	    }

	    function writeToPath(path, data, options, cb) {
	        var Boom = __webpack_require__(16);
	        var Request = __webpack_require__(17);

	        if (typeof options === 'function') {
	            cb = options;
	            options = {};
	        }

	        Request({
	            uri: context.secrets.EXT_STORAGE_URL,
	            method: 'PUT',
	            headers: options.headers || {},
	            qs: { path: path },
	            body: data,
	        }, function (err, res, body) {
	            if (err) return cb(Boom.wrap(err, 502));
	            if (res.statusCode >= 400) return cb(Boom.create(res.statusCode, body && body.message));

	            cb(null);
	        });
	    }
	}


/***/ },
/* 8 */
/***/ function(module, exports, __webpack_require__) {

	var url = __webpack_require__(9);
	var error = __webpack_require__(10);
	var handleAppEndpoint = __webpack_require__(11);
	var handleLogin = __webpack_require__(13);
	var handleCallback = __webpack_require__(14);

	module.exports = function (webtask, options) {
	    if (typeof webtask !== 'function' || webtask.length !== 3) {
	        throw new Error('The auth0() function can only be called on webtask functions with the (ctx, req, res) signature.');
	    }
	    if (!options) {
	        options = {};
	    }
	    if (typeof options !== 'object') {
	        throw new Error('The options parameter must be an object.');
	    }
	    if (options.scope && typeof options.scope !== 'string') {
	        throw new Error('The scope option, if specified, must be a string.');
	    }
	    if (options.authorized && ['string','function'].indexOf(typeof options.authorized) < 0 && !Array.isArray(options.authorized)) {
	        throw new Error('The authorized option, if specified, must be a string or array of strings with e-mail or domain names, or a function that accepts (ctx, req) and returns boolean.');
	    }
	    if (options.exclude && ['string','function'].indexOf(typeof options.exclude) < 0 && !Array.isArray(options.exclude)) {
	        throw new Error('The exclude option, if specified, must be a string or array of strings with URL paths that do not require authentication, or a function that accepts (ctx, req, appPath) and returns boolean.');
	    }
	    if (options.clientId && typeof options.clientId !== 'function') {
	        throw new Error('The clientId option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Client ID.');
	    }
	    if (options.clientSecret && typeof options.clientSecret !== 'function') {
	        throw new Error('The clientSecret option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Client Secret.');
	    }
	    if (options.domain && typeof options.domain !== 'function') {
	        throw new Error('The domain option, if specified, must be a function that accepts (ctx, req) and returns an Auth0 Domain.');
	    }
	    if (options.webtaskSecret && typeof options.webtaskSecret !== 'function') {
	        throw new Error('The webtaskSecret option, if specified, must be a function that accepts (ctx, req) and returns a key to be used to sign issued JWT tokens.');
	    }
	    if (options.getApiKey && typeof options.getApiKey !== 'function') {
	        throw new Error('The getApiKey option, if specified, must be a function that accepts (ctx, req) and returns an apiKey associated with the request.');
	    }
	    if (options.loginSuccess && typeof options.loginSuccess !== 'function') {
	        throw new Error('The loginSuccess option, if specified, must be a function that accepts (ctx, req, res, baseUrl) and generates a response.');
	    }
	    if (options.loginError && typeof options.loginError !== 'function') {
	        throw new Error('The loginError option, if specified, must be a function that accepts (error, ctx, req, res, baseUrl) and generates a response.');
	    }

	    options.clientId = options.clientId || function (ctx, req) {
	        return ctx.secrets.AUTH0_CLIENT_ID;
	    };
	    options.clientSecret = options.clientSecret || function (ctx, req) {
	        return ctx.secrets.AUTH0_CLIENT_SECRET;
	    };
	    options.domain = options.domain || function (ctx, req) {
	        return ctx.secrets.AUTH0_DOMAIN;
	    };
	    options.webtaskSecret = options.webtaskSecret || function (ctx, req) {
	        // By default we don't expect developers to specify WEBTASK_SECRET when
	        // creating authenticated webtasks. In this case we will use webtask token
	        // itself as a JWT signing key. The webtask token of a named webtask is secret
	        // and it contains enough entropy (jti, iat, ca) to pass
	        // for a symmetric key. Using webtask token ensures that the JWT signing secret
	        // remains constant for the lifetime of the webtask; however regenerating
	        // the webtask will invalidate previously issued JWTs.
	        return ctx.secrets.WEBTASK_SECRET || req.x_wt.token;
	    };
	    options.getApiKey = options.getApiKey || function (ctx, req) {
	        if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
	            return req.headers.authorization.split(' ')[1];
	        } else if (req.query && req.query.apiKey) {
	            return req.query.apiKey;
	        }
	        return null;
	    };
	    options.loginSuccess = options.loginSuccess || function (ctx, req, res, baseUrl) {
	        res.writeHead(302, { Location: baseUrl + '?apiKey=' + ctx.apiKey });
	        return res.end();
	    };
	    options.loginError = options.loginError || function (error, ctx, req, res, baseUrl) {
	        if (req.method === 'GET') {
	            if (error.redirect) {
	                res.writeHead(302, { Location: error.redirect });
	                return res.end(JSON.stringify(error));
	            }
	            res.writeHead(error.code || 401, {
	                'Content-Type': 'text/html',
	                'Cache-Control': 'no-cache'
	            });
	            return res.end(getNotAuthorizedHtml(baseUrl + '/login'));
	        }
	        else {
	            // Reject all other requests
	            return error(error, res);
	        }
	    };
	    if (typeof options.authorized === 'string') {
	        options.authorized = [ options.authorized ];
	    }
	    if (Array.isArray(options.authorized)) {
	        var authorized = [];
	        options.authorized.forEach(function (a) {
	            authorized.push(a.toLowerCase());
	        });
	        options.authorized = function (ctx, res) {
	            if (ctx.user.email_verified) {
	                for (var i = 0; i < authorized.length; i++) {
	                    var email = ctx.user.email.toLowerCase();
	                    if (email === authorized[i] || authorized[i][0] === '@' && email.indexOf(authorized[i]) > 1) {
	                        return true;
	                    }
	                }
	            }
	            return false;
	        }
	    }
	    if (typeof options.exclude === 'string') {
	        options.exclude = [ options.exclude ];
	    }
	    if (Array.isArray(options.exclude)) {
	        var exclude = options.exclude;
	        options.exclude = function (ctx, res, appPath) {
	            return exclude.indexOf(appPath) > -1;
	        }
	    }

	    return createAuthenticatedWebtask(webtask, options);
	};

	function createAuthenticatedWebtask(webtask, options) {

	    // Inject middleware into the HTTP pipeline before the webtask handler
	    // to implement authentication endpoints and perform authentication
	    // and authorization.

	    return function (ctx, req, res) {
	        if (!req.x_wt.jtn || !req.x_wt.container) {
	            return error({
	                code: 400,
	                message: 'Auth0 authentication can only be used with named webtasks.'
	            }, res);
	        }

	        var routingInfo = getRoutingInfo(req);
	        if (!routingInfo) {
	            return error({
	                code: 400,
	                message: 'Error processing request URL path.'
	            }, res);
	        }
	        switch (req.method === 'GET' && routingInfo.appPath) {
	            case '/login': handleLogin(options, ctx, req, res, routingInfo); break;
	            case '/callback': handleCallback(options, ctx, req, res, routingInfo); break;
	            default: handleAppEndpoint(webtask, options, ctx, req, res, routingInfo); break;
	        };
	        return;
	    };
	}

	function getRoutingInfo(req) {
	    var routingInfo = url.parse(req.url, true);
	    var segments = routingInfo.pathname.split('/');
	    if (segments[1] === 'api' && segments[2] === 'run' && segments[3] === req.x_wt.container && segments[4] === req.x_wt.jtn) {
	        // Shared domain case: /api/run/{container}/{jtn}
	        routingInfo.basePath = segments.splice(0, 5).join('/');
	    }
	    else if (segments[1] === req.x_wt.container && segments[2] === req.x_wt.jtn) {
	        // Custom domain case: /{container}/{jtn}
	        routingInfo.basePath = segments.splice(0, 3).join('/');
	    }
	    else {
	        return null;
	    }
	    routingInfo.appPath = '/' + segments.join('/');
	    routingInfo.baseUrl = [
	        req.headers['x-forwarded-proto'] || 'https',
	        '://',
	        req.headers.host,
	        routingInfo.basePath
	    ].join('');
	    return routingInfo;
	}

	var notAuthorizedTemplate = function () {/*
	<!DOCTYPE html5>
	<html>
	  <head>
	    <meta charset="utf-8"/>
	    <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
	    <meta name="viewport" content="width=device-width, initial-scale=1"/>
	    <link href="https://cdn.auth0.com/styleguide/latest/index.css" rel="stylesheet" />
	    <title>Access denied</title>
	  </head>
	  <body>
	    <div class="container">
	      <div class="row text-center">
	        <h1><a href="https://auth0.com" title="Go to Auth0!"><img src="https://cdn.auth0.com/styleguide/1.0.0/img/badge.svg" alt="Auth0 badge" /></a></h1>
	        <h1>Not authorized</h1>
	        <p><a href="##">Try again</a></p>
	      </div>
	    </div>
	  </body>
	</html>
	*/}.toString().match(/[^]*\/\*([^]*)\*\/\s*\}$/)[1];

	function getNotAuthorizedHtml(loginUrl) {
	    return notAuthorizedTemplate.replace('##', loginUrl);
	}


/***/ },
/* 9 */
/***/ function(module, exports) {

	module.exports = require("url");

/***/ },
/* 10 */
/***/ function(module, exports) {

	module.exports = function (err, res) {
	    res.writeHead(err.code || 500, {
	        'Content-Type': 'application/json',
	        'Cache-Control': 'no-cache'
	    });
	    res.end(JSON.stringify(err));
	};


/***/ },
/* 11 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(10);

	module.exports = function (webtask, options, ctx, req, res, routingInfo) {
	    return options.exclude && options.exclude(ctx, req, routingInfo.appPath)
	        ? run()
	        : authenticate();

	    function authenticate() {
	        var apiKey = options.getApiKey(ctx, req);
	        if (!apiKey) {
	            return options.loginError({
	                code: 401,
	                message: 'Unauthorized.',
	                error: 'Missing apiKey.',
	                redirect: routingInfo.baseUrl + '/login'
	            }, ctx, req, res, routingInfo.baseUrl);
	        }

	        // Authenticate

	        var secret = options.webtaskSecret(ctx, req);
	        if (!secret) {
	            return error({
	                code: 400,
	                message: 'The webtask secret must be provided to allow for validating apiKeys.'
	            }, res);
	        }

	        try {
	            ctx.user = req.user = __webpack_require__(12).verify(apiKey, secret);
	        }
	        catch (e) {
	            return options.loginError({
	                code: 401,
	                message: 'Unauthorized.',
	                error: e.message
	            }, ctx, req, res, routingInfo.baseUrl);
	        }

	        ctx.apiKey = apiKey;

	        // Authorize

	        if  (options.authorized && !options.authorized(ctx, req)) {
	            return options.loginError({
	                code: 403,
	                message: 'Forbidden.'
	            }, ctx, req, res, routingInfo.baseUrl);
	        }

	        return run();
	    }

	    function run() {
	        // Route request to webtask code
	        return webtask(ctx, req, res);
	    }
	};


/***/ },
/* 12 */
/***/ function(module, exports) {

	module.exports = require("jsonwebtoken");

/***/ },
/* 13 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(10);

	module.exports = function(options, ctx, req, res, routingInfo) {
	    var authParams = {
	        clientId: options.clientId(ctx, req),
	        domain: options.domain(ctx, req)
	    };
	    var count = !!authParams.clientId + !!authParams.domain;
	    var scope = 'openid name email email_verified ' + (options.scope || '');
	    if (count ===  0) {
	        // TODO, tjanczuk, support the shared Auth0 application case
	        return error({
	            code: 501,
	            message: 'Not implemented.'
	        }, res);
	        // Neither client id or domain are specified; use shared Auth0 settings
	        // var authUrl = 'https://auth0.auth0.com/i/oauth2/authorize'
	        //     + '?response_type=code'
	        //     + '&audience=https://auth0.auth0.com/userinfo'
	        //     + '&scope=' + encodeURIComponent(scope)
	        //     + '&client_id=' + encodeURIComponent(routingInfo.baseUrl)
	        //     + '&redirect_uri=' + encodeURIComponent(routingInfo.baseUrl + '/callback');
	        // res.writeHead(302, { Location: authUrl });
	        // return res.end();
	    }
	    else if (count === 2) {
	        // Use custom Auth0 account
	        var authUrl = 'https://' + authParams.domain + '/authorize'
	            + '?response_type=code'
	            + '&scope=' + encodeURIComponent(scope)
	            + '&client_id=' + encodeURIComponent(authParams.clientId)
	            + '&redirect_uri=' + encodeURIComponent(routingInfo.baseUrl + '/callback');
	        res.writeHead(302, { Location: authUrl });
	        return res.end();
	    }
	    else {
	        return error({
	            code: 400,
	            message: 'Both or neither Auth0 Client ID and Auth0 domain must be specified.'
	        }, res);
	    }
	};


/***/ },
/* 14 */
/***/ function(module, exports, __webpack_require__) {

	var error = __webpack_require__(10);

	module.exports = function (options, ctx, req, res, routingInfo) {
	    if (!ctx.query.code) {
	        return options.loginError({
	            code: 401,
	            message: 'Authentication error.',
	            callbackQuery: ctx.query
	        }, ctx, req, res, routingInfo.baseUrl);
	    }

	    var authParams = {
	        clientId: options.clientId(ctx, req),
	        domain: options.domain(ctx, req),
	        clientSecret: options.clientSecret(ctx, req)
	    };
	    var count = !!authParams.clientId + !!authParams.domain + !!authParams.clientSecret;
	    if (count !== 3) {
	        return error({
	            code: 400,
	            message: 'Auth0 Client ID, Client Secret, and Auth0 Domain must be specified.'
	        }, res);
	    }

	    return __webpack_require__(15)
	        .post('https://' + authParams.domain + '/oauth/token')
	        .type('form')
	        .send({
	            client_id: authParams.clientId,
	            client_secret: authParams.clientSecret,
	            redirect_uri: routingInfo.baseUrl + '/callback',
	            code: ctx.query.code,
	            grant_type: 'authorization_code'
	        })
	        .timeout(15000)
	        .end(function (err, ares) {
	            if (err || !ares.ok) {
	                return options.loginError({
	                    code: 502,
	                    message: 'OAuth code exchange completed with error.',
	                    error: err && err.message,
	                    auth0Status: ares && ares.status,
	                    auth0Response: ares && (ares.body || ares.text)
	                }, ctx, req, res, routingInfo.baseUrl);
	            }

	            return issueApiKey(ares.body.id_token);
	        });

	    function issueApiKey(id_token) {
	        var jwt = __webpack_require__(12);
	        var claims;
	        try {
	            claims = jwt.decode(id_token);
	        }
	        catch (e) {
	            return options.loginError({
	                code: 502,
	                message: 'Cannot parse id_token returned from Auth0.',
	                id_token: id_token,
	                error: e.message
	            }, ctx, req, res, routingInfo.baseUrl);
	        }

	        // Issue apiKey by re-signing the id_token claims
	        // with configured secret (webtask token by default).

	        var secret = options.webtaskSecret(ctx, req);
	        if (!secret) {
	            return error({
	                code: 400,
	                message: 'The webtask secret must be be provided to allow for issuing apiKeys.'
	            }, res);
	        }

	        claims.iss = routingInfo.baseUrl;
	        req.user = ctx.user = claims;
	        ctx.apiKey = jwt.sign(claims, secret);

	        // Perform post-login action (redirect to /?apiKey=... by default)
	        return options.loginSuccess(ctx, req, res, routingInfo.baseUrl);
	    }
	};


/***/ },
/* 15 */
/***/ function(module, exports) {

	module.exports = require("superagent");

/***/ },
/* 16 */
/***/ function(module, exports) {

	module.exports = require("boom");

/***/ },
/* 17 */
/***/ function(module, exports) {

	module.exports = require("request");

/***/ },
/* 18 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var sumologic = exports;

	sumologic.version       = __webpack_require__(19).version;
	sumologic.createClient  = __webpack_require__(20).createClient;



/***/ },
/* 19 */
/***/ function(module, exports) {

	module.exports = {
		"name": "logs-to-sumologic",
		"description": "A simple sumologic log client tool",
		"version": "1.0.2",
		"author": {
			"name": "Richard Seldon",
			"email": "arcseldon@gmail.com"
		},
		"repository": {
			"type": "git",
			"url": "git+ssh://git@github.com/tawawa/logs-to-sumologic.git"
		},
		"keywords": [
			"logging",
			"sumologic"
		],
		"dependencies": {
			"request": "2.67.x",
			"json-stringify-safe": "5.0.x"
		},
		"main": "./lib/sumologic",
		"license": "MIT",
		"engines": {
			"node": ">= 0.8.0"
		},
		"gitHead": "1e067d9e01090d394ef388e24fe6c957acb48722",
		"bugs": {
			"url": "https://github.com/tawawa/logs-to-sumologic/issues"
		},
		"homepage": "https://github.com/tawawa/logs-to-sumologic#readme",
		"_id": "logs-to-sumologic@1.0.2",
		"scripts": {},
		"_shasum": "ade4853f9e2e7d6211887ebf71386fda34d253d2",
		"_from": "logs-to-sumologic@>=1.0.2 <2.0.0",
		"_npmVersion": "3.8.3",
		"_nodeVersion": "5.10.0",
		"_npmUser": {
			"name": "arcseldon",
			"email": "arcseldon@hotmail.com"
		},
		"dist": {
			"shasum": "ade4853f9e2e7d6211887ebf71386fda34d253d2",
			"tarball": "https://registry.npmjs.org/logs-to-sumologic/-/logs-to-sumologic-1.0.2.tgz"
		},
		"maintainers": [
			{
				"name": "arcseldon",
				"email": "arcseldon@hotmail.com"
			}
		],
		"_npmOperationalInternal": {
			"host": "packages-12-west.internal.npmjs.com",
			"tmp": "tmp/logs-to-sumologic-1.0.2.tgz_1460736560119_0.3139945878647268"
		},
		"directories": {},
		"_resolved": "https://registry.npmjs.org/logs-to-sumologic/-/logs-to-sumologic-1.0.2.tgz",
		"readme": "ERROR: No README data found!"
	};

/***/ },
/* 20 */
/***/ function(module, exports, __webpack_require__) {

	'use strict';

	var events = __webpack_require__(21),
	  util = __webpack_require__(22),
	  qs = __webpack_require__(23),
	  common = __webpack_require__(24),
	  sumologic = __webpack_require__(18),
	  stringifySafe = __webpack_require__(26);

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

	exports.createClient = function (options) {
	  return new Sumologic(options);
	};

	var Sumologic = exports.Sumologic = function (options) {

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




/***/ },
/* 21 */
/***/ function(module, exports) {

	module.exports = require("events");

/***/ },
/* 22 */
/***/ function(module, exports) {

	module.exports = require("util");

/***/ },
/* 23 */
/***/ function(module, exports) {

	module.exports = require("querystring");

/***/ },
/* 24 */
/***/ function(module, exports, __webpack_require__) {


	var https = __webpack_require__(25),
	    util = __webpack_require__(22),
	    request = __webpack_require__(17),
	    sumologic = __webpack_require__(18);

	var common = exports;

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
	      uri    = args[0];
	    }
	    else {
	      method      = args[0].method || 'GET';
	      uri         = args[0].uri;
	      requestBody = args[0].body;
	      auth        = args[0].auth;
	      headers     = args[0].headers;
	      proxy       = args[0].proxy;
	    }
	  }
	  else if (args.length === 2) {
	    method = 'GET';
	    uri    = args[0];
	    auth   = args[1];
	  }
	  else {
	    method = args[0];
	    uri    = args[1];
	    auth   = args[2];
	  }

	  function onError(err) {
	    if (!responded) {
	      responded = true;
	      if (callback) { callback(err) }
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


/***/ },
/* 25 */
/***/ function(module, exports) {

	module.exports = require("https");

/***/ },
/* 26 */
/***/ function(module, exports) {

	module.exports = require("json-stringify-safe");

/***/ },
/* 27 */
/***/ function(module, exports, __webpack_require__) {

	const LRU        = __webpack_require__(28);
	const _          = __webpack_require__(29);
	const lru_params = [ 'max', 'maxAge', 'length', 'dispose', 'stale' ];

	module.exports = function (options) {
	  const cache      = new LRU(_.pick(options, lru_params));
	  const load       = options.load;
	  const hash       = options.hash;
	  const bypass     = options.bypass;
	  const itemMaxAge = options.itemMaxAge;
	  const loading    = new Map();

	  if (options.disable) {
	    return load;
	  }

	  const result = function () {
	    const args       = _.toArray(arguments);
	    const parameters = args.slice(0, -1);
	    const callback   = args.slice(-1).pop();
	    const self       = this;

	    var key;

	    if (bypass && bypass.apply(self, parameters)) {
	      return load.apply(self, args);
	    }

	    if (parameters.length === 0 && !hash) {
	      //the load function only receives callback.
	      key = '_';
	    } else {
	      key = hash.apply(self, parameters);
	    }

	    var fromCache = cache.get(key);

	    if (fromCache) {
	      return callback.apply(null, [null].concat(fromCache));
	    }

	    if (!loading.get(key)) {
	      loading.set(key, []);

	      load.apply(self, parameters.concat(function (err) {
	        const args = _.toArray(arguments);

	        //we store the result only if the load didn't fail.
	        if (!err) {
	          const result = args.slice(1);
	          if (itemMaxAge) {
	            cache.set(key, result, itemMaxAge.apply(self, parameters.concat(result)));
	          } else {
	            cache.set(key, result);
	          }
	        }

	        //immediately call every other callback waiting
	        loading.get(key).forEach(function (callback) {
	          callback.apply(null, args);
	        });

	        loading.delete(key);
	        /////////

	        callback.apply(null, args);
	      }));
	    } else {
	      loading.get(key).push(callback);
	    }
	  };

	  result.keys = cache.keys.bind(cache);

	  return result;
	};


	module.exports.sync = function (options) {
	  const cache = new LRU(_.pick(options, lru_params));
	  const load = options.load;
	  const hash = options.hash;
	  const disable = options.disable;
	  const bypass = options.bypass;
	  const self = this;
	  const itemMaxAge = options.itemMaxAge;

	  if (disable) {
	    return load;
	  }

	  const result = function () {
	    var args = _.toArray(arguments);

	    if (bypass && bypass.apply(self, arguments)) {
	      return load.apply(self, arguments);
	    }

	    var key = hash.apply(self, args);

	    var fromCache = cache.get(key);

	    if (fromCache) {
	      return fromCache;
	    }

	    const result = load.apply(self, args);
	    if (itemMaxAge) {
	      cache.set(key, result, itemMaxAge.apply(self, args.concat([ result ])));
	    } else {
	      cache.set(key, result);
	    }

	    return result;
	  };

	  result.keys = cache.keys.bind(cache);

	  return result;
	};


/***/ },
/* 28 */
/***/ function(module, exports) {

	module.exports = require("lru-cache");

/***/ },
/* 29 */
/***/ function(module, exports) {

	module.exports = require('lodash');

/***/ }
/******/ ]);
