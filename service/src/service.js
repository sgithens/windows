/* The GPII windows service.
 *
 * Copyright 2017 Raising the Floor - International
 *
 * Licensed under the New BSD license. You may not use this file except in
 * compliance with this License.
 *
 * The R&D leading to these results received funding from the
 * Department of Education - Grant H421A150005 (GPII-APCP). However,
 * these results do not necessarily represent the policy of the
 * Department of Education, and you should not assume endorsement by the
 * Federal Government.
 *
 * You may obtain a copy of the License at
 * https://github.com/GPII/universal/blob/master/LICENSE.txt
 */

"use strict";

var os_service = require("os-service"),
    path = require("path"),
    fs = require("fs"),
    events = require("events"),
    logging = require("./logging.js"),
    windows = require("./windows.js"),
    parseArgs = require("minimist");

// Different parts of the service are isolated, and will communicate by emitting events through this central "service"
// object.
var service = new events.EventEmitter();

service.args = parseArgs(process.argv.slice(2));

// true if the process running as a Windows Service, otherwise a normal user process.
service.isService = !!service.args.service;
// true if the service is an exe file (rather than node)
service.isExe = !!process.versions.pkg;

/** Log something */
service.log = logging.log;
service.logFatal = logging.fatal;
service.logError = logging.error;
service.logWarn = logging.warn;
service.logDebug = logging.debug;

// Change directory to a sane location, allowing relative paths in the config file.
var dir = null;
if (service.isExe) {
    // The path of gpii-app.exe
    dir = path.dirname(process.execPath);
} else {
    // Path of the index.js.
    dir = path.join(__dirname, "..");
}

process.chdir(dir);

// Load the config file.
var configFile = service.args.config;
if (!configFile) {
    if (service.isService) {
        // Check if there's a config file next to the service executable.
        var tryFile = path.join(dir, "service.json");
        if (fs.existsSync(tryFile)) {
            configFile = tryFile;
        }
    }
    if (!configFile) {
        // Use the built-in config file.
        configFile = (service.isService ? "../config/service.json" : "../config/service.dev.json");
    }
}
if ((configFile.indexOf("/") === -1) && (configFile.indexOf("\\") === -1)) {
    configFile = path.join(dir, "config", configFile);
}

service.log("Loading config file", configFile);
service.config = require(configFile);

// Change to the configured log level (if it's not passed via command line)
if (!service.args.loglevel && service.config.logging && service.config.logging.level) {
    logging.setLogLevel(service.config.logging.level);
}

/**
 * Called when the service has just started.
 */
service.start = function () {
    service.isService = os_service.getState() !== "stopped";
    // Control codes are how Windows tells services about certain system events. These are caught in os_service.
    // Register the control codes that the service would be interested in.
    os_service.acceptControl(["start", "stop", "shutdown", "sessionchange"], true);
    // Handle all registered control codes.
    os_service.on("*", service.controlHandler);
    os_service.on("stop", service.stop);

    service.event("start");
    service.log("service start");

    if (windows.isUserLoggedOn) {
        // The service was started while a user is already active; fake a session-change event to get things started.
        service.controlHandler("sessionchange", "session-logon");
    }
};

/**
 * Stop the service.
 */
service.stop = function () {
    service.event("stop");
    os_service.stop();
};

/**
 * Called when the service receives a control code. This is what's used to detect a shutdown, service stop, or Windows
 * user log-in/out.
 *
 * Possible control codes: start, stop, pause, continue, interrogate, shutdown, paramchange, netbindadd, netbindremove,
 * netbindenable, netbinddisable, deviceevent, hardwareprofilechange, powerevent, sessionchange, preshutdown,
 * timechange, triggerevent.
 *
 * For this function to receive a control code, it needs to be added via os_service.acceptControl()
 *
 * See also: https://msdn.microsoft.com/library/ms683241
 *
 * @param controlName Name of the control code.
 * @param eventType Event type.
 */
service.controlHandler = function (controlName, eventType) {
    service.logDebug("Service control: ", controlName, eventType);
    service.event("svc-" + controlName, eventType);
};

/**
 * Creates a new (or returns an existing) module.
 * A module is a piece of the service that can emit events.
 *
 * @param name {String} Module name
 * @param initial {Object} [optional] An existing object to add on to.
 * @return {Object}
 */
service.module = function (name, initial) {
    var mod = service.modules[name];
    if (!mod) {
        mod = initial || {};
        mod.moduleName = name;
        mod.event = function (event, arg1, arg2) {
            var eventName = name === "service" ? event : name + "." + event;
            service.logDebug("EVENT", eventName, arg1, arg2);
            service.emit(eventName, arg1, arg2);
        };
        service.modules[name] = mod;
    }
    return mod;
};
service.modules = { };
service.module("service", service);

module.exports = service;
